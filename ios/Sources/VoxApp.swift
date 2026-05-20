import SwiftUI
import UIKit

extension Notification.Name {
    static let voxDeepLink = Notification.Name("vox.deepLink")
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        for ctx in connectionOptions.urlContexts {
            VoxRuntimeConfig.applyDeepLink(ctx.url)
            NotificationCenter.default.post(name: .voxDeepLink, object: ctx.url)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for ctx in URLContexts {
            VoxRuntimeConfig.applyDeepLink(ctx.url)
            NotificationCenter.default.post(name: .voxDeepLink, object: ctx.url)
        }
    }
}

@main
struct VoxApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    init() {
        // Polling-based control: iPhone polls bridge for commands. Avoids iOS
        // sandbox RSTing inbound LAN connections to the in-app NWListener.
        Task { @MainActor in PollClient.shared.start() }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
