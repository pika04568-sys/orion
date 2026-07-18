import Foundation

struct InspectedExtensionManifest: Equatable, Sendable {
    var name: String
    var version: String
    var manifestVersion: Int
    var permissions: [String]
    var hostPermissions: [String]
    var unsupportedAPIs: [String]
}

enum ExtensionInspectionError: LocalizedError, Equatable {
    case missingManifest
    case invalidManifest
    case unsupportedManifestVersion(Int)
    case symbolicLink(URL)
    case pathEscapesRoot(URL)

    var errorDescription: String? {
        switch self {
        case .missingManifest:
            "The extension does not contain manifest.json."
        case .invalidManifest:
            "The extension manifest is invalid."
        case let .unsupportedManifestVersion(version):
            "Manifest version \(version) is unsupported."
        case let .symbolicLink(url):
            "Symbolic links are not allowed: \(url.lastPathComponent)."
        case let .pathEscapesRoot(url):
            "An extension resource escapes its installation directory: \(url.lastPathComponent)."
        }
    }
}

enum ExtensionManifestInspector {
    private static let unsupportedPermissionPrefixes = [
        "debugger",
        "desktopCapture",
        "enterprise.",
        "nativeMessaging",
        "offscreen",
        "system.",
        "vpnProvider"
    ]

    static func inspect(directory: URL) throws -> InspectedExtensionManifest {
        let root = directory.standardizedFileURL.resolvingSymlinksInPath()
        let manifestURL = directory.appendingPathComponent("manifest.json")
        guard FileManager.default.fileExists(atPath: manifestURL.path) else {
            throw ExtensionInspectionError.missingManifest
        }
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isSymbolicLinkKey],
            options: [.skipsHiddenFiles]
        ) else {
            throw ExtensionInspectionError.invalidManifest
        }
        for case let resourceURL as URL in enumerator {
            let values = try resourceURL.resourceValues(forKeys: [.isSymbolicLinkKey])
            if values.isSymbolicLink == true {
                throw ExtensionInspectionError.symbolicLink(resourceURL)
            }
            let resolved = resourceURL.standardizedFileURL.resolvingSymlinksInPath()
            guard resolved.path == root.path || resolved.path.hasPrefix(root.path + "/") else {
                throw ExtensionInspectionError.pathEscapesRoot(resourceURL)
            }
        }

        let data = try Data(contentsOf: manifestURL)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let name = json["name"] as? String,
              let version = json["version"] as? String,
              let manifestVersion = json["manifest_version"] as? Int
        else {
            throw ExtensionInspectionError.invalidManifest
        }
        guard [2, 3].contains(manifestVersion) else {
            throw ExtensionInspectionError.unsupportedManifestVersion(manifestVersion)
        }

        let permissions = json["permissions"] as? [String] ?? []
        let hostPermissions = json["host_permissions"] as? [String] ?? []
        let unsupported = permissions.filter { permission in
            unsupportedPermissionPrefixes.contains {
                permission == $0 || permission.hasPrefix($0)
            }
        }
        return InspectedExtensionManifest(
            name: name,
            version: version,
            manifestVersion: manifestVersion,
            permissions: permissions.sorted(),
            hostPermissions: hostPermissions.sorted(),
            unsupportedAPIs: unsupported.sorted()
        )
    }
}
