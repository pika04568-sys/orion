import Foundation

enum ApplicationDirectories {
    static var root: URL {
        let fileManager = FileManager.default
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support", isDirectory: true)
        return base.appendingPathComponent("Orion", isDirectory: true)
    }

    static var profiles: URL {
        root.appendingPathComponent("Profiles", isDirectory: true)
    }

    static func profile(_ id: UUID) -> URL {
        profiles.appendingPathComponent(id.uuidString.lowercased(), isDirectory: true)
    }

    static func extensions(for profileID: UUID) -> URL {
        profile(profileID).appendingPathComponent("Extensions", isDirectory: true)
    }
}
