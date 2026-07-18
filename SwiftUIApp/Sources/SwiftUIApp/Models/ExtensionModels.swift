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
    var grantedPermissions: [String]
    var deniedPermissions: [String]
    var grantedHosts: [String]
    var deniedHosts: [String]
    var grantedMatchPatterns: [String]
    var deniedMatchPatterns: [String]

    init(
        id: String,
        name: String,
        version: String,
        source: Source,
        rootPath: String,
        permissions: [String],
        isEnabled: Bool,
        isPinned: Bool,
        installedAt: Date,
        grantedPermissions: [String] = [],
        deniedPermissions: [String] = [],
        grantedHosts: [String] = [],
        deniedHosts: [String] = [],
        grantedMatchPatterns: [String] = [],
        deniedMatchPatterns: [String] = []
    ) {
        self.id = id
        self.name = name
        self.version = version
        self.source = source
        self.rootPath = rootPath
        self.permissions = permissions
        self.isEnabled = isEnabled
        self.isPinned = isPinned
        self.installedAt = installedAt
        self.grantedPermissions = grantedPermissions
        self.deniedPermissions = deniedPermissions
        self.grantedHosts = grantedHosts
        self.deniedHosts = deniedHosts
        self.grantedMatchPatterns = grantedMatchPatterns
        self.deniedMatchPatterns = deniedMatchPatterns
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case version
        case source
        case rootPath
        case permissions
        case isEnabled
        case isPinned
        case installedAt
        case grantedPermissions
        case deniedPermissions
        case grantedHosts
        case deniedHosts
        case grantedMatchPatterns
        case deniedMatchPatterns
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        version = try container.decode(String.self, forKey: .version)
        source = try container.decode(Source.self, forKey: .source)
        rootPath = try container.decode(String.self, forKey: .rootPath)
        permissions = try container.decodeIfPresent(
            [String].self,
            forKey: .permissions
        ) ?? []
        isEnabled = try container.decodeIfPresent(
            Bool.self,
            forKey: .isEnabled
        ) ?? true
        isPinned = try container.decodeIfPresent(
            Bool.self,
            forKey: .isPinned
        ) ?? false
        installedAt = try container.decodeIfPresent(
            Date.self,
            forKey: .installedAt
        ) ?? .distantPast
        grantedPermissions = try container.decodeIfPresent(
            [String].self,
            forKey: .grantedPermissions
        ) ?? []
        deniedPermissions = try container.decodeIfPresent(
            [String].self,
            forKey: .deniedPermissions
        ) ?? []
        grantedHosts = try container.decodeIfPresent(
            [String].self,
            forKey: .grantedHosts
        ) ?? []
        deniedHosts = try container.decodeIfPresent(
            [String].self,
            forKey: .deniedHosts
        ) ?? []
        grantedMatchPatterns = try container.decodeIfPresent(
            [String].self,
            forKey: .grantedMatchPatterns
        ) ?? []
        deniedMatchPatterns = try container.decodeIfPresent(
            [String].self,
            forKey: .deniedMatchPatterns
        ) ?? []
    }
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

struct WebsitePermissionDecision: Codable, Hashable, Sendable {
    enum Value: String, Codable, CaseIterable, Identifiable, Sendable {
        case ask
        case allow
        case deny

        var id: String { rawValue }

        var title: String {
            switch self {
            case .ask: "Ask"
            case .allow: "Allow"
            case .deny: "Deny"
            }
        }
    }

    var origin: String
    var permission: String
    var value: Value
    var updatedAt: Date
}
