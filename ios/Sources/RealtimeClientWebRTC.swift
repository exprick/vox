import AVFoundation
import Foundation
import WebRTC

/// WebRTC-based client for OpenAI Realtime API. This is the production path.
///
/// Why WebRTC vs raw WebSocket: OpenAI's official guidance (platform.openai.com/
/// docs/guides/realtime-webrtc) recommends WebRTC for browser/mobile clients —
/// the iOS WebRTC framework handles audio capture, AEC (Google AEC3), AGC,
/// noise suppression, jitter buffering, and codec negotiation. The raw-WS path
/// requires reimplementing all of that and produces self-interrupting feedback
/// loops on speakerphone (which we hit on 2026-04-26).
///
/// Reference: PallavAg/VoiceModeWebRTCSwift (2024), m1guelpf/swift-realtime-openai.
@MainActor
final class RealtimeClientWebRTC: NSObject, ObservableObject {
    enum ConnectionState: String {
        case idle, connecting, connected, error, closed
    }

    enum MicPermission: String {
        case undetermined, denied, granted
    }

    // Mirrors the WS-based RealtimeClient's @Published surface so VoiceCallView
    // and PollClient.state can read either implementation interchangeably.
    @Published var state: ConnectionState = .idle { didSet { reportState(reason: "state_change") } }
    @Published var lastError: String? { didSet { reportState(reason: "error") } }
    @Published var lastUserUtterance: String = "" { didSet { reportState(reason: "user_transcript") } }
    @Published var lastAssistantText: String = "" { didSet { reportState(reason: "assistant_text") } }
    @Published var isAssistantSpeaking: Bool = false { didSet { reportState(reason: "speaking") } }
    @Published var micPermission: MicPermission = .undetermined
    @Published var dataChannelOpen: Bool = false
    @Published var iceConnectionState: String = "new"

    private let model = "gpt-realtime"

    private var bridgeBase: String {
        if let override = UserDefaults.standard.string(forKey: "bridgeBase") { return override }
        #if targetEnvironment(simulator)
        return "http://127.0.0.1:3205"
        #else
        return "http://127.0.0.1:3205"
        #endif
    }

    /// Single shared factory — RTCPeerConnectionFactory is heavy and meant to
    /// outlive individual peer connections.
    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory()
    }()

    private var peerConnection: RTCPeerConnection?
    private var dataChannel: RTCDataChannel?
    private var audioTrack: RTCAudioTrack?
    private var assistantBuffer: String = ""

    /// Bumped on disconnect / new connect attempt. Lets a connect() resumed
    /// from suspension see that the user has moved on, and abort instead of
    /// resurrecting a closed session. Codex review caught this race.
    private var connectGeneration: Int = 0
    /// True from the moment disconnect() is entered until the next connect()
    /// starts. Used to suppress ICE .closed → .error transitions that fire
    /// as a side-effect of intentional peerConnection.close().
    private var disconnecting: Bool = false

    override init() {
        super.init()
        refreshMicPermission()
    }

    // MARK: - public

    func connect() async {
        guard state == .idle || state == .closed || state == .error else { return }
        log("connect: starting")

        connectGeneration &+= 1
        let myGen = connectGeneration
        disconnecting = false

        if !(await ensureMicPermission()) {
            lastError = "Microphone access denied. Open Settings → Vox → Microphone to enable."
            state = .error
            return
        }
        // disconnect() may have run while we awaited the permission prompt.
        guard myGen == connectGeneration else { log("connect aborted: superseded after permission prompt"); return }

        state = .connecting
        lastError = nil

        do {
            configureAudioSession()
            let token = try await fetchEphemeralKey()
            guard myGen == connectGeneration else { log("connect aborted: superseded after fetchEphemeralKey"); return }
            try await setupPeerConnection(ephemeralKey: token)
            guard myGen == connectGeneration else {
                log("connect aborted: superseded after setupPeerConnection — tearing down")
                cleanup()
                return
            }
        } catch {
            log("connect failed: \(error.localizedDescription)")
            lastError = error.localizedDescription
            state = .error
            cleanup()
        }
    }

    func disconnect() {
        log("disconnect")
        // Bump generation FIRST so any in-flight connect() suspended on an
        // await sees myGen != current and aborts on resume. Without this, a
        // user-initiated disconnect mid-connect can be undone by the older
        // task installing a new peerConnection.
        connectGeneration &+= 1
        disconnecting = true
        cleanup()
        state = .closed
    }

    func ensureMicPermission() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: micPermission = .granted; return true
        case .denied: micPermission = .denied; return false
        case .undetermined:
            let granted = await AVAudioApplication.requestRecordPermission()
            micPermission = granted ? .granted : .denied
            return granted
        @unknown default:
            micPermission = .denied; return false
        }
    }

    func snapshot() -> [String: Any] {
        let route = AVAudioSession.sharedInstance().currentRoute
        let inDesc = route.inputs.map { "\($0.portType.rawValue):\($0.portName)" }.joined(separator: ",")
        let outDesc = route.outputs.map { "\($0.portType.rawValue):\($0.portName)" }.joined(separator: ",")
        return [
            "transport": "webrtc",
            "state": state.rawValue,
            "lastError": lastError ?? "",
            "lastUserUtterance": lastUserUtterance,
            "lastAssistantText": lastAssistantText,
            "isAssistantSpeaking": isAssistantSpeaking,
            "ts": Date().timeIntervalSince1970,
            "micPermission": micPermission.rawValue,
            "audioRouteIn": inDesc,
            "audioRouteOut": outDesc,
            "dataChannelOpen": dataChannelOpen,
            "iceConnectionState": iceConnectionState,
        ]
    }

    // MARK: - WebRTC setup

    private func configureAudioSession() {
        // .videoChat enables Voice Processing IO (AEC + AGC + noise suppression).
        // .defaultToSpeaker is honored at category level but VPIO overrides it
        // and routes to the earpiece (Receiver) — unless we explicitly call
        // overrideOutputAudioPort(.speaker) AFTER setActive. Without the
        // override the assistant audio plays through the receiver and the user
        // can't hear it across the table.
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setMode(.videoChat)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            try session.overrideOutputAudioPort(.speaker)
            log("audio session: cat=\(session.category.rawValue) mode=\(session.mode.rawValue) routedToSpeaker=true")
        } catch {
            log("audio session config failed: \(error)")
        }
    }

    private func fetchEphemeralKey() async throws -> String {
        var req = URLRequest(url: URL(string: "\(bridgeBase)/voice/session")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = "{}".data(using: .utf8)
        req.timeoutInterval = 10
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            throw NSError(domain: "Vox", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "bridge /voice/session HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1)",
            ])
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let secret = json["client_secret"] as? [String: Any],
              let value = secret["value"] as? String else {
            throw NSError(domain: "Vox", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "client_secret missing in bridge response",
            ])
        }
        return value
    }

    private func setupPeerConnection(ephemeralKey: String) async throws {
        let config = RTCConfiguration()
        config.sdpSemantics = .unifiedPlan
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)

        guard let pc = Self.factory.peerConnection(with: config, constraints: constraints, delegate: self) else {
            throw NSError(domain: "Vox", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "failed to create RTCPeerConnection",
            ])
        }
        self.peerConnection = pc

        // Local audio track with AEC + AGC + noise suppression — these flags map
        // to libwebrtc's AEC3 + AGC1 + NS pipeline. Standard reference settings.
        let audioConstraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "googEchoCancellation": "true",
                "googAutoGainControl": "true",
                "googNoiseSuppression": "true",
                "googHighpassFilter": "true",
            ],
            optionalConstraints: nil
        )
        let audioSource = Self.factory.audioSource(with: audioConstraints)
        let track = Self.factory.audioTrack(with: audioSource, trackId: "vox-mic")
        pc.add(track, streamIds: ["vox-stream"])
        self.audioTrack = track

        // Data channel for OpenAI events. Must be created BEFORE offer so it
        // gets included in SDP.
        let dcConfig = RTCDataChannelConfiguration()
        if let dc = pc.dataChannel(forLabel: "oai-events", configuration: dcConfig) {
            dc.delegate = self
            self.dataChannel = dc
        }

        // Create + post offer.
        let offerConstraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let offer: RTCSessionDescription = try await withCheckedThrowingContinuation { cont in
            pc.offer(for: offerConstraints) { sdp, err in
                if let err { cont.resume(throwing: err); return }
                guard let sdp else {
                    cont.resume(throwing: NSError(domain: "Vox", code: 4, userInfo: [
                        NSLocalizedDescriptionKey: "no SDP from offer",
                    ]))
                    return
                }
                cont.resume(returning: sdp)
            }
        }
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            pc.setLocalDescription(offer) { err in
                if let err { cont.resume(throwing: err) } else { cont.resume() }
            }
        }

        let answerSdp = try await postOffer(sdp: offer.sdp, ephemeralKey: ephemeralKey)
        let answer = RTCSessionDescription(type: .answer, sdp: answerSdp)
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            pc.setRemoteDescription(answer) { err in
                if let err { cont.resume(throwing: err) } else { cont.resume() }
            }
        }
        log("setRemoteDescription ok — waiting for ICE/data channel")
    }

    private func postOffer(sdp: String, ephemeralKey: String) async throws -> String {
        let url = URL(string: "https://api.openai.com/v1/realtime?model=\(model)")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/sdp", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(ephemeralKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = sdp.data(using: .utf8)
        req.timeoutInterval = 15
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            let body = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "Vox", code: 5, userInfo: [
                NSLocalizedDescriptionKey: "OpenAI SDP exchange HTTP \(code): \(body.prefix(200))",
            ])
        }
        guard let answer = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "Vox", code: 6, userInfo: [
                NSLocalizedDescriptionKey: "OpenAI SDP answer not utf8",
            ])
        }
        return answer
    }

    private func cleanup() {
        peerConnection?.close()
        peerConnection = nil
        dataChannel = nil
        audioTrack = nil
        dataChannelOpen = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - data channel events

    private func handleDataChannelMessage(_ data: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        switch type {
        case "response.created":
            isAssistantSpeaking = true
            assistantBuffer = ""
            lastAssistantText = ""
        case "response.audio_transcript.delta":
            if let delta = json["delta"] as? String {
                assistantBuffer += delta
                lastAssistantText = assistantBuffer
            }
        case "response.audio_transcript.done":
            // Final assistant text — push to bridge so get_app_state can see it.
            postTranscriptToBridge(role: "assistant", text: assistantBuffer)
        case "response.audio.done", "response.done":
            isAssistantSpeaking = false
        case "conversation.item.input_audio_transcription.completed":
            if let t = json["transcript"] as? String {
                lastUserUtterance = t
                postTranscriptToBridge(role: "user", text: t)
            }
        case "response.output_item.done":
            // Function-calling: when the model decides to call a tool the item
            // arrives here with type=function_call. Run the tool against the
            // bridge and post the output back via conversation.item.create.
            if let item = json["item"] as? [String: Any],
               let itemType = item["type"] as? String,
               itemType == "function_call",
               let name = item["name"] as? String,
               let callId = item["call_id"] as? String {
                let argsString = (item["arguments"] as? String) ?? "{}"
                Task { await self.handleFunctionCall(name: name, callId: callId, argsString: argsString) }
            }
        case "error":
            if let err = json["error"] as? [String: Any], let msg = err["message"] as? String {
                lastError = msg
                log("server error: \(msg)")
            }
        default:
            break
        }
    }

    // MARK: - tools (function calling)

    private func handleFunctionCall(name: String, callId: String, argsString: String) async {
        log("function_call → \(name) call_id=\(callId)")
        let started = Date()
        var output = "tool returned no output"
        do {
            let body: [String: Any] = ["name": name, "arguments": argsString, "call_id": callId]
            var req = URLRequest(url: URL(string: "\(bridgeBase)/tool/call")!)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            req.timeoutInterval = 30
            let (data, _) = try await URLSession.shared.data(for: req)
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let s = json["output"] as? String {
                output = s
            } else {
                output = String(data: data, encoding: .utf8) ?? "(non-utf8 tool response)"
            }
        } catch {
            output = "tool error: \(error.localizedDescription)"
            log("function_call \(name) error: \(error.localizedDescription)")
        }
        let elapsed = Int(Date().timeIntervalSince(started) * 1000)
        log("function_call ← \(name) \(elapsed)ms output.len=\(output.count)")
        sendFunctionCallOutput(callId: callId, output: output)
    }

    private func sendFunctionCallOutput(callId: String, output: String) {
        sendDataChannelJSON([
            "type": "conversation.item.create",
            "item": [
                "type": "function_call_output",
                "call_id": callId,
                "output": output,
            ],
        ])
        // Tell the model to continue (it now has a tool result to react to).
        sendDataChannelJSON(["type": "response.create"])
    }

    // MARK: - external triggers (bridge → iPhone push patterns)

    /// Bridge calls this via PollClient `inject_realtime_message` after an
    /// async tool (codex) finishes. We push a user-style message into the
    /// conversation and request a response so the model voice-reports it.
    ///
    /// If a response is already in progress (model is mid-turn), only enqueue
    /// the item — `response.create` would error with
    /// "Conversation already has an active response in progress". The model
    /// will pick up the queued item on its next response cycle automatically.
    func injectUserMessage(_ text: String) {
        log("injectUserMessage len=\(text.count) speaking=\(isAssistantSpeaking)")
        sendDataChannelJSON([
            "type": "conversation.item.create",
            "item": [
                "type": "message",
                "role": "user",
                "content": [["type": "input_text", "text": text]],
            ],
        ])
        if !isAssistantSpeaking {
            sendDataChannelJSON(["type": "response.create"])
        }
    }

    /// Bridge calls this via PollClient `update_session_instructions` after
    /// update_system_prompt tool runs. Live session config swap, no reconnect.
    func updateSessionInstructions(_ instructions: String) {
        log("updateSessionInstructions len=\(instructions.count)")
        sendDataChannelJSON([
            "type": "session.update",
            "session": ["instructions": instructions],
        ])
    }

    private func sendDataChannelJSON(_ obj: [String: Any]) {
        guard let dc = dataChannel else { log("sendDataChannelJSON: no data channel"); return }
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        let buf = RTCDataBuffer(data: data, isBinary: false)
        dc.sendData(buf)
    }

    private func postTranscriptToBridge(role: String, text: String) {
        guard !text.isEmpty else { return }
        let body: [String: Any] = [
            "transcript_append": [["role": role, "text": text, "ts": Int(Date().timeIntervalSince1970 * 1000)]],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let url = URL(string: "\(bridgeBase)/test/app-state") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        URLSession.shared.dataTask(with: req).resume()
    }

    // MARK: - permission + diagnostics

    private func refreshMicPermission() {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: micPermission = .granted
        case .denied: micPermission = .denied
        case .undetermined: micPermission = .undetermined
        @unknown default: micPermission = .undetermined
        }
    }

    private func reportState(reason: String) {
        let body: [String: Any] = [
            "state": state.rawValue,
            "reason": reason,
            "user_transcript": lastUserUtterance,
            "assistant_transcript": lastAssistantText,
            "is_assistant_speaking": isAssistantSpeaking,
            "error": lastError ?? "",
            "ts": Date().timeIntervalSince1970,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let url = URL(string: "\(bridgeBase)/test/state") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        URLSession.shared.dataTask(with: req).resume()
    }

    private func log(_ msg: String) {
        let line = "[RealtimeClientWebRTC] \(msg)"
        print(line)
        guard let url = URL(string: "\(bridgeBase)/upload/log"),
              let body = try? JSONSerialization.data(withJSONObject: ["lines": [line]]) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        URLSession.shared.dataTask(with: req).resume()
    }
}

// MARK: - RTCPeerConnectionDelegate

extension RealtimeClientWebRTC: RTCPeerConnectionDelegate {
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCSignalingState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        let label: String
        switch newState {
        case .new: label = "new"
        case .checking: label = "checking"
        case .connected: label = "connected"
        case .completed: label = "completed"
        case .failed: label = "failed"
        case .disconnected: label = "disconnected"
        case .closed: label = "closed"
        case .count: label = "count"
        @unknown default: label = "unknown"
        }
        Task { @MainActor in
            self.iceConnectionState = label
            self.log("ICE: \(label)")
            // If user just called disconnect(), peerConnection.close() will fire
            // a .closed callback as a side effect. Don't promote that to .error
            // — the state is already .closed and meant to stay there.
            if self.disconnecting { return }
            switch newState {
            case .connected, .completed:
                self.state = .connected
            case .failed:
                self.state = .error
            case .closed:
                // Genuine remote-side close (not user-initiated): treat as closed.
                self.state = .closed
            case .disconnected:
                // Often transient — leave .connected and let WebRTC heal, only
                // demote if it stays disconnected. (No timer for now; observable.)
                break
            default: break
            }
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        Task { @MainActor in
            self.dataChannel = dataChannel
            dataChannel.delegate = self
            self.log("remote-opened data channel: \(dataChannel.label)")
        }
    }
}

// MARK: - RTCDataChannelDelegate

extension RealtimeClientWebRTC: RTCDataChannelDelegate {
    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        let isOpen = dataChannel.readyState == .open
        Task { @MainActor in
            self.dataChannelOpen = isOpen
            self.log("data channel state: \(dataChannel.readyState.rawValue) open=\(isOpen)")
        }
    }

    nonisolated func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        let data = buffer.data
        Task { @MainActor in self.handleDataChannelMessage(data) }
    }
}
