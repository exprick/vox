import Foundation

enum VoxRuntimeConfig {
    private static let bridgeBaseKey = "bridgeBase"
    private static var bridgeBaseOverride: String?

    static var bridgeBase: String {
        if let value = ProcessInfo.processInfo.environment["VOX_BRIDGE_BASE"], !value.isEmpty {
            return value
        }
        if let value = bridgeBaseOverride, !value.isEmpty {
            return value
        }
        if let value = UserDefaults.standard.string(forKey: bridgeBaseKey), !value.isEmpty {
            return value
        }
        return "http://127.0.0.1:3203"
    }

    @discardableResult
    static func setBridgeBase(_ value: String, persist: Bool = true) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              (scheme == "http" || scheme == "https"),
              url.host?.isEmpty == false else {
            return false
        }
        if persist {
            UserDefaults.standard.set(trimmed, forKey: bridgeBaseKey)
            bridgeBaseOverride = nil
        } else {
            bridgeBaseOverride = trimmed
        }
        return true
    }

    @discardableResult
    static func applyDeepLink(_ url: URL) -> Bool {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        guard comps.scheme == "vox", comps.host == "config" else { return false }
        let bridge = comps.queryItems?.first(where: { $0.name == "bridge" })?.value ?? ""
        let persistValue = comps.queryItems?.first(where: { $0.name == "persist" })?.value?.lowercased() ?? "1"
        let persist = !["0", "false", "no"].contains(persistValue)
        return setBridgeBase(bridge, persist: persist)
    }
}
