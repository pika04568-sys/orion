import Combine
import Foundation

@MainActor
final class BrowserLibraryStore: ObservableObject {
    @Published private(set) var history: [NavigationEntry] = []
    @Published private(set) var bookmarks: [NavigationEntry] = []
    @Published private(set) var isReady = false

    private enum Mutation {
        case addHistory(title: String, urlString: String)
        case clearHistory
        case toggleBookmark(title: String, urlString: String)
        case removeBookmark(UUID)

        var writesHistory: Bool {
            switch self {
            case .addHistory, .clearHistory:
                true
            case .toggleBookmark, .removeBookmark:
                false
            }
        }

        var writesBookmarks: Bool { !writesHistory }
    }

    private let historyStore: JSONFileStore<[NavigationEntry]>
    private let bookmarkStore: JSONFileStore<[NavigationEntry]>
    private let writeDebounce: Duration
    private var bookmarkedURLStrings: Set<String> = []
    private var pendingMutations: [Mutation] = []
    private var loadStarted = false
    private var readinessWaiters: [CheckedContinuation<Void, Never>] = []
    private var historyWriteTask: Task<Void, Never>?
    private var bookmarkWriteTask: Task<Void, Never>?

    init(storageDirectory: URL? = nil, writeDebounce: Duration = .milliseconds(250)) {
        historyStore = JSONFileStore(filename: "history.json", storageDirectory: storageDirectory)
        bookmarkStore = JSONFileStore(filename: "bookmarks.json", storageDirectory: storageDirectory)
        self.writeDebounce = writeDebounce
    }

    func load() async {
        if isReady { return }
        if loadStarted {
            await withCheckedContinuation { continuation in
                readinessWaiters.append(continuation)
            }
            return
        }

        loadStarted = true
        async let storedHistory = historyStore.load(defaultValue: [])
        async let storedBookmarks = bookmarkStore.load(defaultValue: [])
        let (loadedHistory, loadedBookmarks) = await (storedHistory, storedBookmarks)

        let queuedMutations = pendingMutations
        pendingMutations.removeAll(keepingCapacity: false)
        history = loadedHistory
        bookmarks = loadedBookmarks
        rebuildBookmarkIndex()

        for mutation in queuedMutations {
            apply(mutation)
        }

        isReady = true
        if queuedMutations.contains(where: \.writesHistory) {
            scheduleHistoryWrite()
        }
        if queuedMutations.contains(where: \.writesBookmarks) {
            scheduleBookmarkWrite()
        }

        let waiters = readinessWaiters
        readinessWaiters.removeAll(keepingCapacity: false)
        waiters.forEach { $0.resume() }
    }

    func addHistory(title: String, urlString: String) {
        guard BrowserPreferences.recordHistory,
              let normalizedURL = normalizedURLString(urlString)
        else {
            return
        }

        record(.addHistory(title: title, urlString: normalizedURL))
    }

    func clearHistory() {
        record(.clearHistory)
    }

    func toggleBookmark(title: String, urlString: String) -> Bool {
        guard let normalizedURL = normalizedURLString(urlString) else { return false }

        record(.toggleBookmark(title: title, urlString: normalizedURL))
        return bookmarkedURLStrings.contains(normalizedURL)
    }

    func removeBookmark(_ entry: NavigationEntry) {
        record(.removeBookmark(entry.id))
    }

    func isBookmarked(urlString: String) -> Bool {
        guard let normalizedURL = normalizedURLString(urlString) else { return false }
        return bookmarkedURLStrings.contains(normalizedURL)
    }

    func flush() async {
        await load()
        historyWriteTask?.cancel()
        bookmarkWriteTask?.cancel()
        historyWriteTask = nil
        bookmarkWriteTask = nil

        let historySnapshot = history
        let bookmarkSnapshot = bookmarks
        async let historySave: Void = save(historySnapshot, to: historyStore)
        async let bookmarkSave: Void = save(bookmarkSnapshot, to: bookmarkStore)
        _ = await (historySave, bookmarkSave)
    }

    private func record(_ mutation: Mutation) {
        apply(mutation)

        guard isReady else {
            pendingMutations.append(mutation)
            return
        }

        if mutation.writesHistory {
            scheduleHistoryWrite()
        } else {
            scheduleBookmarkWrite()
        }
    }

    private func apply(_ mutation: Mutation) {
        switch mutation {
        case let .addHistory(title, urlString):
            history.removeAll { $0.urlString == urlString }
            history.insert(NavigationEntry(title: title, urlString: urlString), at: 0)
            if history.count > 500 {
                history.removeLast(history.count - 500)
            }
        case .clearHistory:
            history.removeAll()
        case let .toggleBookmark(title, urlString):
            if let index = bookmarks.firstIndex(where: { $0.urlString == urlString }) {
                bookmarks.remove(at: index)
            } else {
                bookmarks.insert(NavigationEntry(title: title, urlString: urlString), at: 0)
            }
            rebuildBookmarkIndex()
        case let .removeBookmark(id):
            bookmarks.removeAll { $0.id == id }
            rebuildBookmarkIndex()
        }
    }

    private func rebuildBookmarkIndex() {
        bookmarkedURLStrings = Set(bookmarks.map(\.urlString))
    }

    private func scheduleHistoryWrite() {
        historyWriteTask?.cancel()
        let snapshot = history
        let store = historyStore
        let delay = writeDebounce
        historyWriteTask = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            try? await store.save(snapshot)
        }
    }

    private func scheduleBookmarkWrite() {
        bookmarkWriteTask?.cancel()
        let snapshot = bookmarks
        let store = bookmarkStore
        let delay = writeDebounce
        bookmarkWriteTask = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            try? await store.save(snapshot)
        }
    }

    private func save(_ value: [NavigationEntry], to store: JSONFileStore<[NavigationEntry]>) async {
        try? await store.save(value)
    }

    private func normalizedURLString(_ urlString: String) -> String? {
        guard let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme)
        else {
            return nil
        }

        return url.absoluteString
    }
}
