import SwiftUI
import Foundation

/// Two-tab shell: Voice (live WebRTC tutor) + Drill (fill-in-the-blank quiz).
///
/// PollClient watches `selection` so an E2E driver can switch tabs from Mac
/// via the new `switch_tab` action; otherwise it's a regular SwiftUI TabView.
struct RootView: View {
    @State private var selection: Int = 0

    var body: some View {
        TabView(selection: $selection) {
            VoiceCallView()
                .tabItem { Label("Voice", systemImage: "waveform") }
                .tag(0)
            DrillView()
                .tabItem { Label("Drill", systemImage: "rectangle.grid.2x2") }
                .tag(1)
        }
        .preferredColorScheme(.dark)
        .onAppear {
            TabSelectionRegistry.shared.bind { selection = $0 }
            postTabToBridge(selection)
        }
        .onChange(of: selection) { _, new in postTabToBridge(new) }
    }

    private func postTabToBridge(_ idx: Int) {
        // Tells the agent (via get_app_state tool) which tab the user is on.
        let tab = idx == 0 ? "voice" : (idx == 1 ? "drill" : "unknown")
        // Match RealtimeClientWebRTC's bridgeBase logic so simulator builds
        // hit the loopback bridge instead of the physical-device LAN IP.
        // Codex review P2.
        let bridgeBase: String = {
            if let v = UserDefaults.standard.string(forKey: "bridgeBase") { return v }
            #if targetEnvironment(simulator)
            return "http://127.0.0.1:3205"
            #else
            return "http://127.0.0.1:3205"
            #endif
        }()
        guard let url = URL(string: "\(bridgeBase)/test/app-state"),
              let body = try? JSONSerialization.data(withJSONObject: ["tab": tab]) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        URLSession.shared.dataTask(with: req).resume()
    }
}

@MainActor
final class TabSelectionRegistry {
    static let shared = TabSelectionRegistry()
    private var setter: ((Int) -> Void)?
    func bind(_ s: @escaping (Int) -> Void) { setter = s }
    func switchTo(_ idx: Int) { setter?(idx) }
}
