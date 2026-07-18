import Combine
import Foundation

@MainActor
final class BrowserLibraryStore: ObservableObject {
    @Published private(set) var history: [NavigationEntry] = []
    @Published private(set) var bookmarks: [BrowserBookmark] = []
    @Published private(set) var isReady = false

    private enum Mutation {
        case addHistory(title: String, urlString: String)
        case clearHistory
        case clearHistorySince(Date)
        case removeHistory(UUID)
        case addBookmark(BrowserBookmark)
        case removeBookmark(UUID)

        var writesHistory: Bool {
            switch self {
            case .addHistory, .clearHistory, .clearHistorySince, .removeHistory:
                true
            case .addBookmark, .removeBookmark:
                false
            }
        }

        var writesBookmarks: Bool { !writesHistory }
    }

    private let historyStore: JSONFileStore<[NavigationEntry]>
    private let bookmarkStore: JSONFileStore<[BrowserBookmark]>
    private let writeDebounce: Duration
    private let isPersistent: Bool
    private var bookmarkedURLStrings: Set<String> = []
    private var pendingMutations: [Mutation] = []
    private var loadStarted = false
    private var readinessWaiters: [CheckedContinuation<Void, Never>] = []
    private var historyWriteTask: Task<Void, Never>?
    private var bookmarkWriteTask: Task<Void, Never>?

    init(
        storageDirectory: URL? = nil,
        writeDebounce: Duration = .milliseconds(250),
        isPersistent: Bool = true
    ) {
        historyStore = JSONFileStore(filename: "history.json", storageDirectory: storageDirectory)
        bookmarkStore = JSONFileStore(filename: "bookmarks.json", storageDirectory: storageDirectory)
        self.writeDebounce = writeDebounce
        self.isPersistent = isPersistent
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
        guard isPersistent else {
            history = []
            bookmarks = []
            bookmarkedURLStrings = []
            pendingMutations.removeAll()
            isReady = true
            let waiters = readinessWaiters
            readinessWaiters.removeAll()
            waiters.forEach { $0.resume() }
            return
        }

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

    func clearHistory(since date: Date) {
        record(.clearHistorySince(date))
    }

    func removeHistory(_ entry: NavigationEntry) {
        record(.removeHistory(entry.id))
    }

    func toggleBookmark(
        title: String,
        urlString: String,
        destinations: Set<BookmarkDestination> = [.bar]
    ) -> Bool {
        guard let normalizedURL = normalizedURLString(urlString) else { return false }

        if let index = bookmarks.firstIndex(where: { $0.urlString == normalizedURL }) {
            record(.removeBookmark(bookmarks[index].id))
        } else {
            addBookmark(
                title: title,
                urlString: normalizedURL,
                destinations: destinations
            )
        }
        return bookmarkedURLStrings.contains(normalizedURL)
    }

    func addBookmark(
        title: String,
        urlString: String,
        destinations: Set<BookmarkDestination>
    ) {
        guard let normalizedURL = normalizedURLString(urlString) else { return }
        if let index = bookmarks.firstIndex(where: { $0.urlString == normalizedURL }) {
            bookmarks[index].title = title
            bookmarks[index].destinations = destinations.isEmpty ? [.bar] : destinations
            rebuildBookmarkIndex()
            guard isReady, isPersistent else { return }
            scheduleBookmarkWrite()
            return
        }
        record(
            .addBookmark(
                BrowserBookmark(
                    title: title,
                    urlString: normalizedURL,
                    destinations: destinations
                )
            )
        )
    }

    func removeBookmark(_ bookmark: BrowserBookmark) {
        record(.removeBookmark(bookmark.id))
    }

    func removeBookmark(_ entry: NavigationEntry) {
        record(.removeBookmark(entry.id))
    }

    func isBookmarked(urlString: String) -> Bool {
        guard let normalizedURL = normalizedURLString(urlString) else { return false }
        return bookmarkedURLStrings.contains(normalizedURL)
    }

    func flush() async {
        guard isPersistent else { return }
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

        guard isPersistent else { return }
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
        case let .clearHistorySince(date):
            history.removeAll { $0.date >= date }
        case let .removeHistory(id):
            history.removeAll { $0.id == id }
        case let .addBookmark(bookmark):
            if let index = bookmarks.firstIndex(where: { $0.urlString == bookmark.urlString }) {
                bookmarks[index] = bookmark
            } else {
                bookmarks.insert(bookmark, at: 0)
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

    private func save<Value: Codable & Sendable>(
        _ value: Value,
        to store: JSONFileStore<Value>
    ) async {
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
