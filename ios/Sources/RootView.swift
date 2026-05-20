import SwiftUI
import Foundation

/// Native shell for the same Vox voice app shipped on the web.
struct RootView: View {
    var body: some View {
        VoiceCallView()
        .onAppear {
            postAppSurfaceToBridge()
        }
    }

    private func postAppSurfaceToBridge() {
        // Tells the agent (via get_app_state tool) that the user is in Vox Voice.
        let bridgeBase = VoxRuntimeConfig.bridgeBase
        guard let url = URL(string: "\(bridgeBase)/test/app-state"),
              let body = try? JSONSerialization.data(withJSONObject: ["surface": "voice"]) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        URLSession.shared.dataTask(with: req).resume()
    }
}
