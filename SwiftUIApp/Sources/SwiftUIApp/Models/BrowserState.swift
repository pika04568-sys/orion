import Combine
import Foundation

@MainActor
final class BrowserState: ObservableObject {
    @Published var tabs: [BrowserTab] = []
    @Published var activeTabID: BrowserTab.ID?
    @Published var sidebarMode: LibrarySidebarMode?

    private let library: BrowserLibraryStore

    init(library: BrowserLibraryStore) {
        self.library = library
        newTab(initial: BrowserPreferences.homepageURL, activate: true)
    }

    var activeTab: BrowserTab? {
        tabs.first { $0.id == activeTabID } ?? tabs.first
    }

    func newTab(initial: String? = nil, activate: Bool = true) {
        let tab = BrowserTab()
        tabs.append(tab)

        if activate {
            activeTabID = tab.id
        }

        let target = initial ?? (BrowserPreferences.openNewTabsWithHomepage ? BrowserPreferences.homepageURL : nil)
        if let target, !target.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            load(target, in: tab)
        }
    }

    func activateTab(_ id: BrowserTab.ID) {
        activeTabID = id
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
            activeTabID = tabs[nextIndex].id
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

        tab.errorMessage = nil
        tab.addressText = request.url?.absoluteString ?? input
        tab.webView.load(request)
    }

    func load(entry: NavigationEntry) {
        load(entry.urlString)
    }

    func goBack() {
        guard let tab = activeTab, tab.webView.canGoBack else { return }
        tab.webView.goBack()
    }

    func goForward() {
        guard let tab = activeTab, tab.webView.canGoForward else { return }
        tab.webView.goForward()
    }

    func reload() {
        guard let tab = activeTab else { return }
        if tab.webView.url == nil {
            submitAddress(for: tab)
        } else {
            tab.webView.reload()
        }
    }

    func loadHomepage() {
        load(BrowserPreferences.homepageURL)
    }

    func stopLoading() {
        activeTab?.webView.stopLoading()
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
