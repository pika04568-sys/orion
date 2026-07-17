import Combine
import Foundation

@MainActor
final class BrowserState: ObservableObject {
    @Published var tabs: [BrowserTab] = []
    @Published var activeTabID: BrowserTab.ID?
    @Published var sidebarMode: LibrarySidebarMode?

    private let library: BrowserLibraryStore

    init(library: BrowserLibraryStore, initialURL: String? = BrowserPreferences.homepageURL) {
        self.library = library
        createTab(initial: initialURL, activate: true)
    }

    var activeTab: BrowserTab? {
        tabs.first { $0.id == activeTabID } ?? tabs.first
    }

    func newTab(initial: String? = nil, activate: Bool = true) {
        let target = initial ?? (BrowserPreferences.openNewTabsWithHomepage ? BrowserPreferences.homepageURL : nil)
        createTab(initial: target, activate: activate)
    }

    private func createTab(initial: String?, activate: Bool) {
        let tab = BrowserTab()
        tab.onNavigationFinished = { [weak self] finishedTab in
            self?.recordNavigation(for: finishedTab)
        }
        tabs.append(tab)

        if let initial, !initial.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            load(initial, in: tab)
        }

        if activate {
            activateTab(tab.id)
        }
    }

    func activateTab(_ id: BrowserTab.ID) {
        guard let tab = tabs.first(where: { $0.id == id }) else { return }
        activeTabID = id
        tab.activate()
    }

    func closeTab(_ id: BrowserTab.ID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        let closingActiveTab = activeTabID == id
        tabs.remove(at: index)

        if tabs.isEmpty {
            newTab(initial: BrowserPreferences.homepageURL, activate: true)
            return
        }

        if closingActiveTab {
            let nextIndex = min(index, tabs.count - 1)
            activateTab(tabs[nextIndex].id)
        }
    }

    func closeActiveTab() {
        guard let activeTab else { return }
        closeTab(activeTab.id)
    }

    func submitAddress(for tab: BrowserTab) {
        load(tab.addressText, in: tab)
    }

    func load(_ input: String, in tab: BrowserTab? = nil) {
        guard let tab = tab ?? activeTab,
              let request = NavigationResolver.request(for: input)
        else {
            return
        }

        tab.addressText = request.url?.absoluteString ?? input
        tab.load(request)
    }

    func load(entry: NavigationEntry) {
        load(entry.urlString)
    }

    func goBack() {
        guard let webView = activeTab?.webView, webView.canGoBack else { return }
        webView.goBack()
    }

    func goForward() {
        guard let webView = activeTab?.webView, webView.canGoForward else { return }
        webView.goForward()
    }

    func reload() {
        guard let tab = activeTab else { return }
        guard let webView = tab.webView else {
            submitAddress(for: tab)
            return
        }

        if webView.url == nil {
            submitAddress(for: tab)
        } else {
            webView.reload()
        }
    }

    func loadHomepage() {
        load(BrowserPreferences.homepageURL)
    }

    func stopLoading() {
        activeTab?.webView?.stopLoading()
    }

    func toggleBookmarkForActiveTab() {
        guard let entry = activeTab?.navigationEntry else { return }
        _ = library.toggleBookmark(title: entry.displayTitle, urlString: entry.urlString)
    }

    func isBookmarked(_ tab: BrowserTab) -> Bool {
        guard let entry = tab.navigationEntry else { return false }
        return library.isBookmarked(urlString: entry.urlString)
    }

    func recordNavigation(for tab: BrowserTab) {
        guard let entry = tab.navigationEntry else { return }
        library.addHistory(title: entry.displayTitle, urlString: entry.urlString)
    }

    func measurePerformanceInteractions() async -> (newTabMs: Double, tabSwitchMs: Double) {
        guard let originalTabID = activeTabID else { return (0, 0) }

        let newTabStartedAt = OrionPerformance.now
        createTab(initial: nil, activate: true)
        let probeTabID = activeTabID
        await Task.yield()
        let newTabMs = OrionPerformance.milliseconds(since: newTabStartedAt)

        let switchStartedAt = OrionPerformance.now
        activateTab(originalTabID)
        await Task.yield()
        let tabSwitchMs = OrionPerformance.milliseconds(since: switchStartedAt)

        if let probeTabID, probeTabID != originalTabID {
            tabs.removeAll { $0.id == probeTabID }
        }

        return (newTabMs, tabSwitchMs)
    }

    func handle(_ command: BrowserCommand) {
        switch command {
        case .newTab:
            newTab()
        case .closeTab:
            closeActiveTab()
        case .goBack:
            goBack()
        case .goForward:
            goForward()
        case .reload:
            reload()
        case .showHistory:
            sidebarMode = sidebarMode == .history ? nil : .history
        case .showBookmarks:
            sidebarMode = sidebarMode == .bookmarks ? nil : .bookmarks
        }
    }
}
