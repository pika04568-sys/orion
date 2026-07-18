import Combine
import Foundation

@MainActor
final class ProfileStore: ObservableObject {
    @Published private(set) var profiles: [BrowserProfile] = [.defaultProfile]
    @Published private(set) var isReady = false

    private let store: JSONFileStore<[BrowserProfile]>

    init(storageDirectory: URL? = nil) {
        store = JSONFileStore(
            filename: "profiles.json",
            storageDirectory: storageDirectory ?? ApplicationDirectories.root
        )
    }

    func load() async {
        guard !isReady else { return }
        var loaded = await store.load(defaultValue: [.defaultProfile])
        if !loaded.contains(where: { $0.id == BrowserProfile.defaultID }) {
            loaded.insert(.defaultProfile, at: 0)
        }
        profiles = loaded.sorted { $0.createdAt < $1.createdAt }
        isReady = true
    }

    @discardableResult
    func addProfile(name: String? = nil) -> BrowserProfile {
        let profile = BrowserProfile(
            name: resolvedName(name, fallbackIndex: profiles.count)
        )
        profiles.append(profile)
        persist()
        return profile
    }

    func renameProfile(_ id: BrowserProfile.ID, to proposedName: String) {
        guard let index = profiles.firstIndex(where: { $0.id == id }) else { return }
        let name = proposedName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        profiles[index].name = name
        persist()
    }

    func deleteProfile(_ id: BrowserProfile.ID) {
        guard id != BrowserProfile.defaultID,
              profiles.contains(where: { $0.id == id })
        else {
            return
        }
        profiles.removeAll { $0.id == id }
        try? FileManager.default.removeItem(at: ApplicationDirectories.profile(id))
        persist()
    }

    func profile(id: BrowserProfile.ID?) -> BrowserProfile {
        guard let id, let profile = profiles.first(where: { $0.id == id }) else {
            return .defaultProfile
        }
        return profile
    }

    func flush() async {
        try? await store.save(profiles)
    }

    private func resolvedName(_ proposedName: String?, fallbackIndex: Int) -> String {
        let trimmed = proposedName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "Profile \(fallbackIndex)" : trimmed
    }

    private func persist() {
        let snapshot = profiles
        Task {
            try? await store.save(snapshot)
        }
    }
}
