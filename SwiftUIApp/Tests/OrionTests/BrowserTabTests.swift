import WebKit
import Testing
@testable import Orion

@Suite(.serialized)
@MainActor
final class BrowserTabTests {
    @Test
    func testWebViewIsLazyRetainedAndDelegatedBeforeQueuedLoad() {
        var delegateStateObservedBeforeLoad = false
        let tab = BrowserTab(
            makeWebView: { WebViewEnvironment.makeWebView() },
            onWillLoad: { webView in
                XCTAssertNotNil(webView.navigationDelegate)
                XCTAssertNotNil(webView.uiDelegate)
                delegateStateObservedBeforeLoad = true
            }
        )

        tab.load(URLRequest(url: URL(string: "about:blank")!))
        XCTAssertNil(tab.webView)
        let materialized = tab.activate()
        XCTAssertTrue(delegateStateObservedBeforeLoad)
        XCTAssertIdentical(materialized, tab.webView)
        XCTAssertIdentical(materialized, tab.activate())
    }

    @Test
    func testConfigurationsSharePersistentWebKitResources() {
        let first = WebViewEnvironment.makeWebView()
        let second = WebViewEnvironment.makeWebView()
        XCTAssertIdentical(first.configuration.websiteDataStore, second.configuration.websiteDataStore)
        XCTAssertFalse(first.configuration.websiteDataStore === WKWebsiteDataStore.default())
    }

    @Test
    func testFiftyBackgroundTabsRemainUnmaterialized() {
        let browser = BrowserState(library: BrowserLibraryStore(), initialURL: nil)
        for _ in 0..<50 {
            browser.newTab(initial: "about:blank", activate: false)
        }
        XCTAssertEqual(browser.tabs.count, 51)
        XCTAssertEqual(browser.tabs.compactMap(\.webView).count, 0)
    }

    @Test
    func testClosingActiveTabActivatesPendingSuccessor() throws {
        let browser = BrowserState(library: BrowserLibraryStore(), initialURL: nil)
        let closingID = try XCTUnwrap(browser.activeTabID)
        browser.newTab(initial: "about:blank", activate: false)
        let pendingTab = browser.tabs[1]
        XCTAssertNil(pendingTab.webView)

        browser.closeTab(closingID)

        XCTAssertEqual(browser.activeTabID, pendingTab.id)
        XCTAssertNotNil(pendingTab.webView)
        XCTAssertNotNil(pendingTab.webView?.navigationDelegate)
        XCTAssertNotNil(pendingTab.webView?.uiDelegate)
    }

    @Test
    func testPrivateTabsAreNotPersistedByANormalWindow() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("OrionPrivateSession-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let sessionStore = BrowserSessionStore(storageDirectory: directory)
        let browser = BrowserState(
            library: BrowserLibraryStore(storageDirectory: directory),
            initialURL: nil,
            sessionStore: sessionStore
        )
        browser.newPrivateTab(initial: "https://private.example")
        await browser.flushSession()

        let snapshot = await sessionStore.load()
        XCTAssertEqual(snapshot.tabs.count, 1)
        XCTAssertEqual(snapshot.tabs.first?.urlString, "chrome://newtab")
    }
}
