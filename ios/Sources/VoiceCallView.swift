import SwiftUI

struct VoiceCallView: View {
    @StateObject private var client = SharedClient.shared.client
    @Environment(\.scenePhase) private var scenePhase

    // The orb's pulse used to read RealtimeClient.inputLevel (RMS from our own
    // mic tap). The WebRTC client doesn't expose that — libwebrtc owns the
    // audio pipeline. Surface the talking-state (assistantSpeaking) instead.
    private var pulseScale: CGFloat { client.isAssistantSpeaking ? 30 : 0 }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 6) {
                Text("Vox")
                    .font(.system(size: 32, weight: .bold))
                Text("Real-time voice practice · 中英混说")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            ZStack {
                Circle()
                    .fill(orbColor.opacity(0.15))
                    .frame(width: 240 + pulseScale, height: 240 + pulseScale)
                    .animation(.easeOut(duration: 0.2), value: pulseScale)
                Circle()
                    .fill(orbColor)
                    .frame(width: 200, height: 200)
                Image(systemName: micIcon)
                    .font(.system(size: 80))
                    .foregroundStyle(.white)
            }

            Text(statusText)
                .font(.headline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            if !client.lastUserUtterance.isEmpty || !client.lastAssistantText.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    if !client.lastUserUtterance.isEmpty {
                        Text("you: \(client.lastUserUtterance)")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    if !client.lastAssistantText.isEmpty {
                        Text(client.lastAssistantText)
                            .font(.body)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal)
            }

            Spacer()

            Button(action: toggleConnection) {
                Text(buttonText)
                    .font(.title3.bold())
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(buttonColor)
                    .clipShape(Capsule())
            }
            .padding(.horizontal, 32)

            if client.micPermission == .denied {
                Text("Microphone is off. Open Settings → Vox → Microphone to enable.")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .padding(.horizontal)
                    .padding(.bottom, 4)
            } else if let err = client.lastError, !err.isEmpty {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal)
                    .padding(.bottom, 8)
            }
        }
        .padding(.vertical, 32)
        .onAppear {
            // Auto-connect on cold launch so the learner can speak immediately. The
            // RealtimeClient handles permission prompt + bounded retry on transient
            // network failure, so we don't need to gate this on anything.
            autoConnectIfNeeded(reason: "onAppear")
        }
        .onChange(of: scenePhase) { _, phase in
            // Returning from background after WS dropped: re-attempt so the
            // user sees a usable session without tapping Start.
            if phase == .active {
                autoConnectIfNeeded(reason: "scenePhase=active")
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .voxDeepLink)) { note in
            if let url = note.object as? URL {
                Task { await SharedClient.shared.handleDeepLink(url) }
            }
        }
    }

    private func autoConnectIfNeeded(reason: String) {
        switch client.state {
        case .idle, .closed, .error:
            Task { await client.connect() }
        case .connecting, .connected:
            break
        }
    }

    private func toggleConnection() {
        switch client.state {
        case .idle, .closed, .error:
            Task { await client.connect() }
        case .connecting, .connected:
            client.disconnect()
        }
    }

    private var statusText: String {
        if client.micPermission == .denied {
            return "Microphone disabled"
        }
        switch client.state {
        case .idle: return "Starting…"
        case .connecting: return "Connecting…"
        case .connected: return client.isAssistantSpeaking ? "Vox is speaking" : "Listening — say something"
        case .error: return "Reconnecting…"
        case .closed: return "Call ended"
        }
    }

    private var buttonText: String {
        switch client.state {
        case .idle: return "Start"
        case .closed: return "Start"
        case .error: return "Retry"
        case .connecting: return "Connecting…"
        case .connected: return "End"
        }
    }

    private var buttonColor: Color {
        switch client.state {
        case .connected: return .red
        case .connecting: return .gray
        default: return .blue
        }
    }

    private var orbColor: Color {
        switch client.state {
        case .connected: return client.isAssistantSpeaking ? .green : .blue
        case .connecting: return .gray
        case .error: return .red
        default: return Color(.systemGray3)
        }
    }

    private var micIcon: String {
        client.state == .connected ? "waveform" : "mic.fill"
    }
}

@MainActor
final class SharedClient {
    static let shared = SharedClient()
    let client = RealtimeClientWebRTC()

    func handleDeepLink(_ url: URL) async {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let host = comps.host ?? ""
        let qs = comps.queryItems ?? []
        let params: [String: String] = Dictionary(qs.compactMap { item -> (String, String)? in
            guard let value = item.value else { return nil }
            return (item.name, value)
        }, uniquingKeysWith: { first, _ in first })

        switch host {
        case "config":
            if let bridge = params["bridge"], !bridge.isEmpty {
                UserDefaults.standard.set(bridge, forKey: "bridgeBase")
                NSLog("[Vox] bridge URL set to \(bridge)")
            }
        default:
            break
        }
    }
}
