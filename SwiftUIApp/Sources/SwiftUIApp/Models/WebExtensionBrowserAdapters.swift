import Foundation
import WebKit

@MainActor
final class WebExtensionTabAdapter: NSObject, WKWebExtensionTab {
    weak var tab: BrowserTab?
    weak var window: WebExtensionWindowAdapter?

    init(tab: BrowserTab, window: WebExtensionWindowAdapter?) {
        self.tab = tab
        self.window = window
    }

    func window(for context: WKWebExtensionContext) -> (any WKWebExtensionWindow)? {
        window
    }

    func indexInWindow(for context: WKWebExtensionContext) -> Int {
        guard let window, let tab else { return NSNotFound }
        return window.tabAdapters.firstIndex { $0.tab?.id == tab.id } ?? NSNotFound
    }

    func webView(for context: WKWebExtensionContext) -> WKWebView? {
        tab?.webView
    }

    func title(for context: WKWebExtensionContext) -> String? {
        tab?.displayTitle
    }

    func url(for context: WKWebExtensionContext) -> URL? {
        tab?.webView?.url ?? tab.flatMap { URL(string: $0.navigationState.urlString) }
    }

    func isReaderModeActive(for context: WKWebExtensionContext) -> Bool {
        tab?.surface == .reader
    }

    func isPlayingAudio(for context: WKWebExtensionContext) -> Bool {
        tab?.isAudible == true
    }

    func isLoadingComplete(for context: WKWebExtensionContext) -> Bool {
        tab?.navigationState.isLoading != true
    }
}

@MainActor
final class WebExtensionWindowAdapter: NSObject, WKWebExtensionWindow {
    weak var browser: BrowserState?
    var tabAdapters: [WebExtensionTabAdapter] = []

    init(browser: BrowserState) {
        self.browser = browser
    }

    func tabs(for context: WKWebExtensionContext) -> [any WKWebExtensionTab] {
        tabAdapters
    }

    func activeTab(for context: WKWebExtensionContext) -> (any WKWebExtensionTab)? {
        guard let id = browser?.activeTabID else { return nil }
        return tabAdapters.first { $0.tab?.id == id }
    }

    func windowType(for context: WKWebExtensionContext) -> WKWebExtension.WindowType {
        .normal
    }

    func isPrivate(for context: WKWebExtensionContext) -> Bool {
        browser?.isPrivateSession == true
    }
}
