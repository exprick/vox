import SwiftUI

struct VoiceCallView: View {
    @StateObject private var client = SharedClient.shared.client
    @Environment(\.scenePhase) private var scenePhase
    @State private var showChineseSubtitles = true

    var body: some View {
        ZStack {
            VoxPalette.pageBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                transcript
                controls
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(VoxPalette.shellBackground)
        }
        .onAppear {
            autoConnectIfNeeded(reason: "onAppear")
        }
        .onChange(of: scenePhase) { _, phase in
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

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("Vox")
                .font(.custom("Georgia", size: 30).italic())
                .foregroundStyle(VoxPalette.ink)
            Spacer(minLength: 12)
            statusBadge
        }
        .padding(.horizontal, 24)
        .padding(.top, 28)
        .padding(.bottom, 8)
    }

    private var statusBadge: some View {
        Text(statusLabel)
            .font(.system(size: 12, weight: .semibold))
            .tracking(1.1)
            .textCase(.uppercase)
            .foregroundStyle(statusColor)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(VoxPalette.cream.opacity(0.36))
            .clipShape(Capsule())
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 23) {
                    ForEach(displayTurns) { turn in
                        transcriptTurn(turn)
                            .id(turn.id)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 28)
                .padding(.top, 44)
                .padding(.bottom, 42)
            }
            .scrollIndicators(.hidden)
            .onChange(of: displayTurns.map(\.text).joined(separator: "|")) { _, _ in
                if let id = displayTurns.last?.id {
                    withAnimation(.easeOut(duration: 0.22)) {
                        proxy.scrollTo(id, anchor: .bottom)
                    }
                }
            }
        }
    }

    private func transcriptTurn(_ turn: VoxTranscriptTurn) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(turn.label)
                .font(.custom("Georgia", size: 14).italic())
                .foregroundStyle(turn.role == .user ? VoxPalette.coral.opacity(0.64) : VoxPalette.muted)

            Text(turn.text)
                .font(.custom("Georgia", size: turn.isCurrent ? currentTextSize(for: turn.text) : 23))
                .lineSpacing(2)
                .foregroundStyle(turnTextColor(turn))
                .fixedSize(horizontal: false, vertical: true)

            if showChineseSubtitles, let subtitle = turn.subtitle {
                Text(subtitle)
                    .font(.system(size: turn.text.count > 130 ? 14 : 15))
                    .lineSpacing(1)
                    .foregroundStyle(VoxPalette.ink.opacity(0.52))
            }
        }
    }

    private var controls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button(action: { showChineseSubtitles.toggle() }) {
                    HStack(spacing: 7) {
                        Circle()
                            .fill(showChineseSubtitles ? VoxPalette.coral.opacity(0.78) : VoxPalette.ink.opacity(0.28))
                            .frame(width: 7, height: 7)
                        Text("中")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(VoxPalette.ink.opacity(0.58))
                    .frame(height: 28)
                    .padding(.horizontal, 10)
                    .background(VoxPalette.cream.opacity(0.32))
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showChineseSubtitles ? "中文字幕开" : "中文字幕关")

                Spacer(minLength: 12)

                Text(subtitleStatusText)
                    .font(.system(size: 12))
                    .foregroundStyle(VoxPalette.ink.opacity(0.46))
                    .lineLimit(1)
            }

            Button(action: primaryButtonAction) {
                HStack(spacing: 10) {
                    if primaryButtonIsLive {
                        Circle()
                            .fill(Color.white.opacity(0.88))
                            .frame(width: 12, height: 12)
                    }
                    Text(primaryButtonText)
                        .font(.system(size: 15, weight: .semibold))
                        .tracking(0.2)
                }
                .foregroundStyle(VoxPalette.cream)
                .frame(maxWidth: .infinity)
                .frame(height: 58)
                .background(primaryButtonColor)
                .clipShape(Capsule())
                .shadow(color: VoxPalette.ink.opacity(0.18), radius: 22, y: 12)
            }
            .buttonStyle(.plain)
            .disabled(primaryButtonDisabled)
            .opacity(primaryButtonDisabled ? 0.55 : 1)

            HStack(spacing: 10) {
                if showsEndButton {
                    Button(action: { client.disconnect() }) {
                        Text("End")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(VoxPalette.ink.opacity(0.56))
                            .frame(height: 30)
                            .padding(.horizontal, 14)
                            .background(VoxPalette.cream.opacity(0.28))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }

                Text(transportText)
                    .font(.system(size: 12))
                    .foregroundStyle(VoxPalette.ink.opacity(0.50))
                    .lineLimit(1)

                Spacer(minLength: 0)
            }

            if client.micPermission == .denied {
                Text("Microphone is off. Open Settings -> Vox -> Microphone to enable.")
                    .font(.caption)
                    .foregroundStyle(VoxPalette.coral)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if let err = client.lastError, !err.isEmpty {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(VoxPalette.coral)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .padding(.bottom, 18)
    }

    private var displayTurns: [VoxTranscriptTurn] {
        if !client.transcriptTurns.isEmpty {
            return client.transcriptTurns.map { turn in
                let role: VoxTranscriptTurn.Role = turn.role == .user ? .user : .assistant
                return .init(
                    id: turn.id,
                    role: role,
                    label: role == .user ? "You" : "Vox",
                    text: turn.text,
                    subtitle: nil,
                    isCurrent: turn.isCurrent || turn.id == client.transcriptTurns.last?.id
                )
            }
        }

        return previewTurns
    }

    private var previewTurns: [VoxTranscriptTurn] {
        [
            .init(
                id: "preview-vox-1",
                role: .assistant,
                label: "Vox · Preview",
                text: "Let's start with one easy question.",
                subtitle: "先从一个简单问题开始。",
                isCurrent: false
            ),
            .init(
                id: "preview-user-1",
                role: .user,
                label: "Learner · Preview",
                text: "I want to practice ordering food.",
                subtitle: nil,
                isCurrent: false
            ),
            .init(
                id: "preview-vox-2",
                role: .assistant,
                label: "Vox · Preview",
                text: "Good. What would you like to order?",
                subtitle: "很好。你想点什么？",
                isCurrent: true
            ),
        ]
    }

    private func autoConnectIfNeeded(reason: String) {
        switch client.state {
        case .idle, .closed, .error:
            Task { await client.connect() }
        case .connecting, .connected:
            break
        }
    }

    private func primaryButtonAction() {
        switch client.state {
        case .idle, .closed, .error:
            Task { await client.connect() }
        case .connecting:
            break
        case .connected:
            if client.isListeningPaused {
                client.resumeListening()
            } else {
                client.pauseListening()
            }
        }
    }

    private var statusLabel: String {
        switch client.state {
        case .idle, .closed: return "Ready"
        case .connecting: return "Connecting"
        case .connected: return client.isListeningPaused ? "Paused" : "Live"
        case .error: return "Error"
        }
    }

    private var statusColor: Color {
        switch client.state {
        case .connected: return VoxPalette.coral
        case .error: return VoxPalette.coral
        default: return VoxPalette.muted
        }
    }

    private var subtitleStatusText: String {
        showChineseSubtitles ? "Vox English shows Chinese subtitle" : "Chinese subtitles hidden"
    }

    private var primaryButtonText: String {
        switch client.state {
        case .idle, .closed, .error:
            return "Start"
        case .connecting:
            return "Connecting"
        case .connected:
            return client.isListeningPaused ? "Resume" : "Pause"
        }
    }

    private var primaryButtonColor: Color {
        client.isListeningPaused ? VoxPalette.ink : VoxPalette.coral
    }

    private var primaryButtonIsLive: Bool {
        client.state == .connected && !client.isListeningPaused
    }

    private var primaryButtonDisabled: Bool {
        switch client.state {
        case .connecting:
            return true
        default:
            return false
        }
    }

    private var showsEndButton: Bool {
        switch client.state {
        case .connecting, .connected: return true
        default: return false
        }
    }

    private var transportText: String {
        switch client.state {
        case .connected:
            if client.isListeningPaused { return "Paused" }
            if client.isAssistantSpeaking { return "Vox speaking" }
            if client.isMicrophoneOpen { return "Listening" }
            return client.dataChannelOpen ? "WebRTC connected" : "WebRTC connecting"
        case .connecting:
            return "WebRTC connecting"
        case .error:
            return "WebRTC error"
        default:
            return "WebRTC idle"
        }
    }

    private func currentTextSize(for text: String) -> CGFloat {
        if text.count > 260 { return 20 }
        if text.count > 130 { return 23 }
        return 30
    }

    private func turnTextColor(_ turn: VoxTranscriptTurn) -> Color {
        if turn.role == .user {
            return turn.isCurrent ? VoxPalette.coral.opacity(0.92) : VoxPalette.coral.opacity(0.72)
        }
        return turn.isCurrent ? VoxPalette.ink : VoxPalette.ink.opacity(0.58)
    }
}

private struct VoxTranscriptTurn: Identifiable {
    enum Role {
        case user
        case assistant
    }

    let id: String
    let role: Role
    let label: String
    let text: String
    let subtitle: String?
    let isCurrent: Bool
}

private enum VoxPalette {
    static let pageBackground = Color(red: 0.10, green: 0.08, blue: 0.06)
    static let shellBackground = Color(red: 0.89, green: 0.66, blue: 0.55)
    static let cream = Color(red: 1.00, green: 0.96, blue: 0.91)
    static let ink = Color(red: 0.15, green: 0.08, blue: 0.06)
    static let muted = Color(red: 0.15, green: 0.08, blue: 0.06).opacity(0.62)
    static let coral = Color(red: 0.71, green: 0.26, blue: 0.21)
}

@MainActor
final class SharedClient {
    static let shared = SharedClient()
    let client = RealtimeClientWebRTC()

    func handleDeepLink(_ url: URL) async {
        if VoxRuntimeConfig.applyDeepLink(url) {
            NSLog("[Vox] bridge URL set to \(VoxRuntimeConfig.bridgeBase)")
        }
    }
}
