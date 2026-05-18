// Reverse the control flow: iPhone polls bridge for pending commands and POSTs results.
// Avoids the iOS sandbox limitation that RSTs inbound LAN TCP connections.
//
// Flow:
//   Mac driver  → POST /cmd/push {action: "screenshot"}              → bridge queues
//   iPhone      → GET  /cmd/next  every 1s                            → dequeues
//   iPhone      → executes (capture screenshot, get state, etc.)
//   iPhone      → POST /upload/screenshot (bytes)
//   iPhone      → POST /cmd/result {id, result: {ok: true, size}}
//   Mac driver  → GET  /cmd/result/<id>                               → reads when ready
//   Mac driver  → GET  /upload/screenshot                             → fetches PNG

import Foundation
import UIKit

@MainActor
final class PollClient {
    static let shared = PollClient()

    private var bridgeBase: String {
        if let v = UserDefaults.standard.string(forKey: "bridgeBase") { return v }
        return "http://127.0.0.1:3203"
    }

    private var pollTask: Task<Void, Never>?

    func start() {
        guard pollTask == nil else { return }
        log("[PollClient] starting; bridge=\(bridgeBase)")
        pollTask = Task { @MainActor in await self.runLoop() }
    }

    func log(_ msg: String) {
        print(msg)
        Task { await self.uploadLogLines([msg]) }
    }

    private func runLoop() async {
        while !Task.isCancelled {
            do {
                let cmd = try await fetchNextCommand()
                if let cmd { await handle(cmd) }
                else { try? await Task.sleep(nanoseconds: 1_000_000_000) }
            } catch {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func fetchNextCommand() async throws -> Command? {
        guard let url = URL(string: "\(bridgeBase)/cmd/next") else { return nil }
        let (data, _) = try await URLSession.shared.data(from: url)
        let env = try JSONDecoder().decode(CommandEnvelope.self, from: data)
        return env.cmd
    }

    private func handle(_ cmd: Command) async {
        do {
            let result = try await execute(cmd)
            await postResult(id: cmd.id, result: result, error: nil)
        } catch {
            await postResult(id: cmd.id, result: nil, error: error.localizedDescription)
        }
    }

    private func execute(_ cmd: Command) async throws -> [String: Any] {
        let client = SharedClient.shared.client
        // Production transport is WebRTC (RealtimeClientWebRTC). The
        // fixture-feed / received_audio / set_mic_send_muted actions from the
        // earlier WS-based client are intentionally gone — WebRTC owns the
        // audio pipeline and doesn't expose accumulated PCM. The proper E2E
        // pattern now is Mac-as-user (Mac plays fixture via afplay, records
        // assistant playback via ffmpeg, Whisper transcribes). See
        // tests/voice-e2e-mac-user.mjs.
        switch cmd.action {
        case "ping":
            return ["pong": true]
        case "state":
            return client.snapshot()
        case "screenshot":
            let png = try await captureScreenshotPNG()
            try await uploadBytes(png, to: "/upload/screenshot", contentType: "image/png")
            return ["uploaded": true, "size": png.count]
        case "connect":
            await client.connect()
            return ["state": client.state.rawValue]
        case "disconnect":
            client.disconnect()
            return ["state": client.state.rawValue]
        case "request_mic_permission":
            let granted = await client.ensureMicPermission()
            return ["granted": granted, "permission": client.micPermission.rawValue]
        case "switch_tab":
            // E2E hook: drive the TabView from Mac. tab=0 voice, tab=1 drill.
            let tab = (cmd.args?["tab"] as? Double).map { Int($0) } ?? (cmd.args?["tab"] as? Int) ?? 0
            TabSelectionRegistry.shared.switchTo(tab)
            // Give SwiftUI a beat to actually swap.
            try? await Task.sleep(nanoseconds: 300_000_000)
            return ["tab": tab]
        case "reload_drill":
            // Bridge generate_drill tool just wrote a new artifact; force the
            // already-instantiated WKWebView to reload so the user sees the
            // new game without leaving Tab 2 (codex review P2 fix).
            if let view = DrillWebViewRegistry.shared.current() {
                view.reloadFromOrigin()
                return ["reloaded": true]
            }
            return ["reloaded": false, "reason": "no drill webview registered"]
        case "inject_realtime_message":
            // Bridge tool (codex) finished async → pushes a user-style message
            // into the live Realtime session so the model voice-reports it.
            let text = (cmd.args?["text"] as? String) ?? ""
            client.injectUserMessage(text)
            return ["sent": true, "len": text.count]
        case "update_session_instructions":
            // Bridge tool (update_system_prompt) → live session.update with
            // new instructions, no reconnect.
            let instructions = (cmd.args?["instructions"] as? String) ?? ""
            client.updateSessionInstructions(instructions)
            return ["sent": true, "len": instructions.count]
        case "eval_artifact":
            // E2E hook: evaluate JS inside the drill WKWebView. Returns the
            // result as String (or error message). Used to assert
            // window.voxArtifact contracts (kind/topic/questions/getState).
            let js = (cmd.args?["js"] as? String) ?? "JSON.stringify(window.voxArtifact?.getState?.() || null)"
            guard let webView = DrillWebViewRegistry.shared.current() else {
                throw NSError(domain: "Vox", code: 10, userInfo: [NSLocalizedDescriptionKey: "drill webview not loaded — switch to tab 1 first"])
            }
            let result: Any
            do {
                result = try await webView.evaluateJavaScript(js)
            } catch {
                throw NSError(domain: "Vox", code: 11, userInfo: [NSLocalizedDescriptionKey: "JS error: \(error.localizedDescription)"])
            }
            let asString: String
            if let s = result as? String { asString = s }
            else if let n = result as? NSNumber { asString = n.stringValue }
            else if let r = result as? NSObject { asString = "\(r)" }
            else { asString = "null" }
            return ["js": js, "result": asString]
        default:
            throw NSError(domain: "Vox", code: 3, userInfo: [NSLocalizedDescriptionKey: "unknown action: \(cmd.action)"])
        }
    }

    private func captureScreenshotPNG() async throws -> Data {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.windows.first(where: \.isKeyWindow) ?? scene.windows.first else {
            throw NSError(domain: "Vox", code: 4, userInfo: [NSLocalizedDescriptionKey: "no window"])
        }
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
        let image = renderer.image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
        }
        guard let png = image.pngData() else {
            throw NSError(domain: "Vox", code: 5, userInfo: [NSLocalizedDescriptionKey: "png encode failed"])
        }
        return png
    }

    private func uploadBytes(_ bytes: Data, to path: String, contentType: String) async throws {
        guard let url = URL(string: bridgeBase + path) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        req.httpBody = bytes
        _ = try await URLSession.shared.data(for: req)
    }

    private func uploadLogLines(_ lines: [String]) async {
        guard let url = URL(string: bridgeBase + "/upload/log") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["lines": lines])
        _ = try? await URLSession.shared.data(for: req)
    }

    private func postResult(id: String, result: [String: Any]?, error: String?) async {
        guard let url = URL(string: bridgeBase + "/cmd/result") else { return }
        var body: [String: Any] = ["id": id]
        if let result { body["result"] = result }
        if let error { body["error"] = error }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: req)
    }

    private func wrapWav(pcm: Data, sampleRate: UInt32) -> Data {
        var data = Data()
        let dataSize = UInt32(pcm.count)
        let totalSize = 36 + dataSize
        data.append("RIFF".data(using: .ascii)!)
        data.append(le32(totalSize))
        data.append("WAVEfmt ".data(using: .ascii)!)
        data.append(le32(16)); data.append(le16(1)); data.append(le16(1))
        data.append(le32(sampleRate))
        data.append(le32(sampleRate * 2))
        data.append(le16(2)); data.append(le16(16))
        data.append("data".data(using: .ascii)!)
        data.append(le32(dataSize))
        data.append(pcm)
        return data
    }
    private func le16(_ v: UInt16) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
    private func le32(_ v: UInt32) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
}

private struct CommandEnvelope: Decodable { let cmd: Command? }
private struct Command: Decodable {
    let id: String
    let action: String
    let args: [String: Any]?

    enum CodingKeys: String, CodingKey { case id, action, args }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        action = try c.decode(String.self, forKey: .action)
        // decode args as [String: Any] from raw JSON
        if let raw = try? c.decode([String: AnyCodable].self, forKey: .args) {
            args = raw.mapValues { $0.value }
        } else { args = nil }
    }
}

private struct AnyCodable: Decodable {
    let value: Any
    init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if let s = try? c.decode(String.self) { value = s; return }
        if let n = try? c.decode(Double.self) { value = n; return }
        if let b = try? c.decode(Bool.self) { value = b; return }
        value = NSNull()
    }
}
