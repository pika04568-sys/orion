import Foundation

actor BrowserSessionStore {
    private let store: JSONFileStore<BrowserSessionSnapshot>

    init(storageDirectory: URL) {
        store = JSONFileStore(filename: "session.json", storageDirectory: storageDirectory)
    }

    func load() async -> BrowserSessionSnapshot {
        await store.load(defaultValue: .empty)
    }

    func save(_ snapshot: BrowserSessionSnapshot) async {
        try? await store.save(snapshot)
    }
}
