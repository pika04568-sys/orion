import Foundation
import Testing
@testable import Orion

@Suite(.serialized)
@MainActor
final class BrowserLibraryStoreTests {
    @Test
    func testQueuedMutationPersistsAfterAsynchronousLoad() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let store = BrowserLibraryStore(storageDirectory: directory, writeDebounce: .zero)
        XCTAssertTrue(store.toggleBookmark(title: "Example", urlString: "https://example.com"))
        XCTAssertFalse(store.isReady)
        await store.load()
        await store.flush()

        let reloaded = BrowserLibraryStore(storageDirectory: directory, writeDebounce: .zero)
        await reloaded.load()
        XCTAssertTrue(reloaded.isReady)
        XCTAssertTrue(reloaded.isBookmarked(urlString: "https://example.com"))
        XCTAssertEqual(reloaded.bookmarks.count, 1)
    }

    @Test
    func testExistingJSONEncodingRemainsCompatible() async throws {
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
        XCTAssertEqual(store.bookmarks.map(\.navigationEntry), [expected])
        XCTAssertEqual(store.bookmarks.first?.destinations, [.bar])
        XCTAssertTrue(store.isBookmarked(urlString: expected.urlString))
    }

    @Test
    func testBookmarkDestinationsSurviveQueuedLoadAndPersistence() async throws {
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
        XCTAssertEqual(reloaded.bookmarks.first?.destinations, [.newTab])
    }

    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("OrionTests-\(UUID().uuidString)", isDirectory: true)
    }
}
