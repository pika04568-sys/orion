import Combine
import Foundation
import WebKit

@MainActor
final class AppCoordinator: ObservableObject {
    let profileStore: ProfileStore
    let updates = UpdateRuntime()

    private var profileRuntimes: [UUID: ProfileRuntime] = [:]
    private var didScheduleUpdateCheck = false

    init(profileStore: ProfileStore = ProfileStore()) {
        self.profileStore = profileStore
        migrateLegacyDefaultProfileDataIfNeeded()
    }

    func load() async {
        await profileStore.load()
        scheduleUpdateCheck()
    }

    private func scheduleUpdateCheck() {
        guard !didScheduleUpdateCheck else { return }
        didScheduleUpdateCheck = true
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard let self, !Task.isCancelled else { return }
            await updates.check()
        }
    }

    func profile(for route: BrowserWindowRoute) -> BrowserProfile {
        profileStore.profile(id: route.profileID)
    }

    func libraryStore(for route: BrowserWindowRoute) -> BrowserLibraryStore {
        guard !route.isPrivate else {
            return BrowserLibraryStore(isPersistent: false)
        }
        return runtime(for: route).library
    }

    func sessionStore(for route: BrowserWindowRoute) -> BrowserSessionStore? {
        guard !route.isPrivate else { return nil }
        return runtime(for: route).sessionStore
    }

    func runtime(for route: BrowserWindowRoute) -> ProfileRuntime {
        let profile = profile(for: route)
        if let existing = profileRuntimes[profile.id] {
            return existing
        }
        let created = ProfileRuntime(profile: profile)
        profileRuntimes[profile.id] = created
        return created
    }

    func makeWebView(for route: BrowserWindowRoute, isPrivate: Bool) -> WKWebView {
        if isPrivate {
            return WebViewEnvironment.makeWebView(
                profile: profile(for: route),
                isPrivate: true
            )
        }
        return runtime(for: route).makeWebView(isPrivate: false)
    }

    func deleteProfile(_ id: BrowserProfile.ID) {
        profileRuntimes.removeValue(forKey: id)?.shutdown()
        profileStore.deleteProfile(id)
    }

    func flush() async {
        await profileStore.flush()
        for runtime in profileRuntimes.values {
            await runtime.library.flush()
        }
    }

    private func migrateLegacyDefaultProfileDataIfNeeded() {
        let fileManager = FileManager.default
        let destination = ApplicationDirectories.profile(BrowserProfile.defaultID)
        let marker = destination.appendingPathComponent(".swift-profile-migrated")
        guard !fileManager.fileExists(atPath: marker.path) else { return }

        try? fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
        for filename in ["history.json", "bookmarks.json"] {
            let source = ApplicationDirectories.root.appendingPathComponent(filename)
            let target = destination.appendingPathComponent(filename)
            if fileManager.fileExists(atPath: source.path),
               !fileManager.fileExists(atPath: target.path) {
                try? fileManager.copyItem(at: source, to: target)
            }
        }
        fileManager.createFile(atPath: marker.path, contents: Data())
    }
}
