import WebKit
import Testing
@testable import Orion

@MainActor
struct BrowserTabTests {
    @Test
    func webViewIsLazyRetainedAndDelegatedBeforeQueuedLoad() {
        var delegateStateObservedBeforeLoad = false
        let tab = BrowserTab(
            makeWebView: WebViewEnvironment.makeWebView,
            onWillLoad: { webView in
                #expect(webView.navigationDelegate != nil)
                #expect(webView.uiDelegate != nil)
                delegateStateObservedBeforeLoad = true
            }
        )

        tab.load(URLRequest(url: URL(string: "about:blank")!))
        #expect(tab.webView == nil)
        let materialized = tab.activate()
        #expect(delegateStateObservedBeforeLoad)
        #expect(materialized === tab.webView)
        #expect(materialized === tab.activate())
    }

    @Test
    func configurationsSharePersistentWebKitResources() {
        let first = WebViewEnvironment.makeWebView()
        let second = WebViewEnvironment.makeWebView()
        #expect(first.configuration.websiteDataStore === WKWebsiteDataStore.default())
        #expect(second.configuration.websiteDataStore === WKWebsiteDataStore.default())
        #expect(first.configuration.processPool === second.configuration.processPool)
    }

    @Test
    func fiftyBackgroundTabsRemainUnmaterialized() {
        let browser = BrowserState(library: BrowserLibraryStore(), initialURL: nil)
        for _ in 0..<50 {
            browser.newTab(initial: "about:blank", activate: false)
        }
        #expect(browser.tabs.count == 51)
        #expect(browser.tabs.compactMap(\.webView).count == 1)
    }

    @Test
    func closingActiveTabActivatesPendingSuccessor() throws {
        let browser = BrowserState(library: BrowserLibraryStore(), initialURL: nil)
        let closingID = try #require(browser.activeTabID)
        browser.newTab(initial: "about:blank", activate: false)
        let pendingTab = browser.tabs[1]
        #expect(pendingTab.webView == nil)

        browser.closeTab(closingID)

        #expect(browser.activeTabID == pendingTab.id)
        #expect(pendingTab.webView != nil)
        #expect(pendingTab.webView?.navigationDelegate != nil)
        #expect(pendingTab.webView?.uiDelegate != nil)
    }
}
