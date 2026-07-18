import Foundation
import Testing
@testable import Orion

@MainActor
struct BrowserLibraryStoreTests {
    @Test
    func queuedMutationPersistsAfterAsynchronousLoad() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let store = BrowserLibraryStore(storageDirectory: directory, writeDebounce: .zero)
        #expect(store.toggleBookmark(title: "Example", urlString: "https://example.com"))
        #expect(!store.isReady)
        await store.load()
        await store.flush()

        let reloaded = BrowserLibraryStore(storageDirectory: directory, writeDebounce: .zero)
        await reloaded.load()
        #expect(reloaded.isReady)
        #expect(reloaded.isBookmarked(urlString: "https://example.com"))
        #expect(reloaded.bookmarks.count == 1)
    }

    @Test
    func existingJSONEncodingRemainsCompatible() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let expected = NavigationEntry(
            id: UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!,
            title: "Existing bookmark",
            urlString: "https://example.org",
            date: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode([expected]).write(to: directory.appendingPathComponent("bookmarks.json"), options: .atomic)

        let store = BrowserLibraryStore(storageDirectory: directory)
        await store.load()
        #expect(store.bookmarks.map(\.navigationEntry) == [expected])
        #expect(store.bookmarks.first?.destinations == [.bar])
        #expect(store.isBookmarked(urlString: expected.urlString))
    }

    @Test
    func bookmarkDestinationsSurviveQueuedLoadAndPersistence() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let store = BrowserLibraryStore(storageDirectory: directory, writeDebounce: .zero)
        store.addBookmark(
            title: "Start page",
            urlString: "https://example.com",
            destinations: [.newTab]
        )
        await store.load()
        await store.flush()

        let reloaded = BrowserLibraryStore(storageDirectory: directory)
        await reloaded.load()
        #expect(reloaded.bookmarks.first?.destinations == [.newTab])
    }

    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("OrionTests-\(UUID().uuidString)", isDirectory: true)
    }
}
