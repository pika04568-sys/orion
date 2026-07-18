import Foundation

enum RemoteNavigationPolicy {
    static func requiresManagedProtection(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let host = url.host?.lowercased()
        else {
            return false
        }
        if host == "localhost"
            || host == "::1"
            || host == "[::1]"
            || host.hasSuffix(".local")
            || isIPv4Loopback(host) {
            return false
        }
        return true
    }

    private static func isIPv4Loopback(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        return parts.count == 4
            && parts.first == "127"
            && parts.allSatisfy { UInt8($0) != nil }
    }
}
