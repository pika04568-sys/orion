import Combine
import Foundation

@MainActor
final class BrowserLibraryStore: ObservableObject {
    @Published private(set) var history: [NavigationEntry]
    @Published private(set) var bookmarks: [NavigationEntry]

    private let historyStore = JSONFileStore<[NavigationEntry]>(filename: "history.json")
    private let bookmarkStore = JSONFileStore<[NavigationEntry]>(filename: "bookmarks.json")

    init() {
        history = historyStore.load(defaultValue: [])
        bookmarks = bookmarkStore.load(defaultValue: [])
    }

    func addHistory(title: String, urlString: String) {
        guard BrowserPreferences.recordHistory,
              let normalizedURL = normalizedURLString(urlString)
        else {
            return
        }

        history.removeAll { $0.urlString == normalizedURL }
        history.insert(NavigationEntry(title: title, urlString: normalizedURL), at: 0)

        if history.count > 500 {
            history.removeLast(history.count - 500)
        }

        historyStore.save(history)
    }

    func clearHistory() {
        history.removeAll()
        historyStore.save(history)
    }

    func toggleBookmark(title: String, urlString: String) -> Bool {
        guard let normalizedURL = normalizedURLString(urlString) else { return false }

        if let index = bookmarks.firstIndex(where: { $0.urlString == normalizedURL }) {
            bookmarks.remove(at: index)
            bookmarkStore.save(bookmarks)
            return false
        }

        bookmarks.insert(NavigationEntry(title: title, urlString: normalizedURL), at: 0)
        bookmarkStore.save(bookmarks)
        return true
    }

    func removeBookmark(_ entry: NavigationEntry) {
        bookmarks.removeAll { $0.id == entry.id }
        bookmarkStore.save(bookmarks)
    }

    func isBookmarked(urlString: String) -> Bool {
        guard let normalizedURL = normalizedURLString(urlString) else { return false }
        return bookmarks.contains { $0.urlString == normalizedURL }
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
