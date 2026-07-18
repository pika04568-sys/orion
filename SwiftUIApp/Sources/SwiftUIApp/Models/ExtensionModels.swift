import Foundation

struct ExtensionRecord: Identifiable, Codable, Equatable, Sendable {
    enum Source: String, Codable, Sendable {
        case chromeWebStore
        case unpacked
        case managed
    }

    let id: String
    var name: String
    var version: String
    var source: Source
    var rootPath: String
    var permissions: [String]
    var isEnabled: Bool
    var isPinned: Bool
    var installedAt: Date
}

enum ManagedExtensionState: Equatable, Sendable {
    static let uBlockOriginLiteID = "ddkjiahejlhfcafbddmgiahcphecmpfh"

    case idle
    case installing
    case ready(version: String)
    case failed(message: String)

    var permitsRemoteNavigation: Bool {
        if case .ready = self {
            return true
        }
        return false
    }
}

struct WebsitePermissionDecision: Codable, Equatable, Sendable {
    enum Value: String, Codable, Sendable {
        case ask
        case allow
        case deny
    }

    var origin: String
    var permission: String
    var value: Value
    var updatedAt: Date
}
