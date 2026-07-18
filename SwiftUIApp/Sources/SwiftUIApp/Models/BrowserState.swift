import Combine
import Darwin
import Foundation
import WebKit

@MainActor
final class BrowserState: ObservableObject {
    @Published var tabs: [BrowserTab] = []
    @Published var activeTabID: BrowserTab.ID?
    @Published var tabGroups: [TabGroup] = []
    @Published var sidebarMode: LibrarySidebarMode?
    @Published var downloads: [BrowserDownload] = []
    @Published var pageSummary: PageSummary?
    @Published var isSummarizing = false
    @Published var isFindBarVisible = false
    @Published var findQuery = ""
    @Published var findStatus = ""
    @Published private(set) var memoryStatus: MemoryStatus = .idle
    @Published var protectionGateMessage: String?
    var onOpenWindow: ((BrowserWindowRoute) -> Void)?
    var remoteNavigationAllowed: () -> Bool = { true }
    var onRetryProtection: (() async -> Bool)?

    private let library: BrowserLibraryStore
    let profile: BrowserProfile
    let isPrivateSession: Bool
    private let sessionStore: BrowserSessionStore?
    private let makeWebView: @MainActor (Bool) -> WKWebView
    private let permissionStore: WebsitePermissionStore?
    private var extensionController: WKWebExtensionController?
    private var extensionDelegate: WebExtensionControllerCoordinator?
    @Published private(set) var extensionRuntime: ExtensionRuntime?
    private var extensionWindowAdapter: WebExtensionWindowAdapter?
    private var extensionTabAdapters: [UUID: WebExtensionTabAdapter] = [:]
    private var recentlyClosed: [BrowserTabSnapshot] = []
    private var sessionSaveTask: Task<Void, Never>?
    private var didRestoreSession = false
    private var pendingRemoteNavigation: (input: String, tabID: UUID)?

    init(
        library: BrowserLibraryStore,
        initialURL: String? = BrowserPreferences.homepageURL,
        profile: BrowserProfile = .defaultProfile,
        isPrivateSession: Bool = false,
        sessionStore: BrowserSessionStore? = nil,
        permissionStore: WebsitePermissionStore? = nil,
        extensionController: WKWebExtensionController? = nil,
        extensionRuntime: ExtensionRuntime? = nil,
        extensionDelegate: WebExtensionControllerCoordinator? = nil,
        makeWebView: (@MainActor (Bool) -> WKWebView)? = nil
    ) {
        self.library = library
        self.profile = profile
        self.isPrivateSession = isPrivateSession
        self.sessionStore = sessionStore
        self.permissionStore = permissionStore
        self.extensionController = extensionController
        self.extensionRuntime = extensionRuntime
        self.extensionDelegate = extensionDelegate
        self.makeWebView = makeWebView ?? { isPrivate in
            WebViewEnvironment.makeWebView(profile: profile, isPrivate: isPrivate)
        }
        registerExtensionWindowAndTabsIfNeeded()
        createTab(initial: initialURL, activate: true, isPrivate: isPrivateSession)
    }

    var activeTab: BrowserTab? {
        tabs.first { $0.id == activeTabID } ?? tabs.first
    }

    func newTab(initial: String? = nil, activate: Bool = true) {
        let target = initial ?? (BrowserPreferences.openNewTabsWithHomepage ? BrowserPreferences.homepageURL : nil)
        createTab(initial: target, activate: activate, isPrivate: isPrivateSession)
    }

    func newPrivateTab(initial: String? = nil) {
        createTab(initial: initial, activate: true, isPrivate: true)
    }

    @discardableResult
    private func createTab(
        id: UUID = UUID(),
        title: String = "New Tab",
        initial: String?,
        activate: Bool,
        isPrivate: Bool = false,
        groupID: UUID? = nil,
        webViewFactory: (@MainActor () -> WKWebView)? = nil
    ) -> BrowserTab {
        let tab = BrowserTab(
            id: id,
            title: title,
            isPrivate: isPrivate,
            groupID: groupID,
            makeWebView: webViewFactory ?? { [makeWebView] in makeWebView(isPrivate) },
            permissionStore: isPrivate ? nil : permissionStore
        )
        tab.onNavigationFinished = { [weak self] finishedTab in
            self?.recordNavigation(for: finishedTab)
            self?.scheduleSessionSave()
        }
        tab.onDownloadStarted = { [weak self] download in
            self?.downloads.insert(download, at: 0)
            self?.sidebarMode = .downloads
        }
        tab.onDownloadUpdated = { [weak self] id, state, destination, progress in
            guard let self, let index = downloads.firstIndex(where: { $0.id == id }) else { return }
            downloads[index].state = state
            if let destination {
                downloads[index].destinationURL = destination
            }
            if let progress {
                downloads[index].fractionCompleted = progress
            }
        }
        tab.onPopupRequested = { [weak self] request in
            guard let self, let urlString = request.url?.absoluteString else { return }
            onOpenWindow?(
                BrowserWindowRoute(
                    kind: .popup,
                    profileID: profile.id,
                    initialURL: urlString
                )
            )
        }
        tabs.append(tab)
        registerExtensionTabIfNeeded(tab)

        if let initial, !initial.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            load(initial, in: tab)
        }

        if activate {
            activateTab(tab.id)
        }
        enforceBackgroundTabBudget()
        scheduleSessionSave()
        return tab
    }

    func activateTab(_ id: BrowserTab.ID) {
        guard let tab = tabs.first(where: { $0.id == id }) else { return }
        let previousAdapter = activeTabID.flatMap { extensionTabAdapters[$0] }
        activeTabID = id
        let webView = tab.activate()
        if let webView = webView as? OrionWebView,
           let runtime = extensionRuntime,
           let adapter = extensionTabAdapters[id] {
            configureExtensionContextMenu(
                webView: webView,
                runtime: runtime,
                adapter: adapter
            )
        }
        if let adapter = extensionTabAdapters[id] {
            extensionController?.didActivateTab(
                adapter,
                previousActiveTab: previousAdapter
            )
        }
        enforceBackgroundTabBudget()
        scheduleSessionSave()
    }

    func closeTab(_ id: BrowserTab.ID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        let closingActiveTab = activeTabID == id
        let closingTab = tabs[index]
        detachExtensionTab(id)
        if !closingTab.isPrivate, closingTab.navigationEntry != nil {
            recentlyClosed.insert(closingTab.sessionSnapshot, at: 0)
            if recentlyClosed.count > 10 {
                recentlyClosed.removeLast(recentlyClosed.count - 10)
            }
        }
        tabs.remove(at: index)

        if tabs.isEmpty {
            newTab(activate: true)
            return
        }

        if closingActiveTab {
            let nextIndex = min(index, tabs.count - 1)
            activateTab(tabs[nextIndex].id)
        } else {
            scheduleSessionSave()
        }
    }

    func closeActiveTab() {
        guard let activeTab else { return }
        closeTab(activeTab.id)
    }

    func closeOtherTabs(keeping id: BrowserTab.ID) {
        let closingTabs = tabs.filter { $0.id != id }
        for tab in closingTabs {
            if !tab.isPrivate, tab.navigationEntry != nil {
                recentlyClosed.append(tab.sessionSnapshot)
            }
            detachExtensionTab(tab.id)
        }
        tabs.removeAll { $0.id != id }
        activateTab(id)
        scheduleSessionSave()
    }

    func reopenClosedTab() {
        guard !recentlyClosed.isEmpty else { return }
        let closed = recentlyClosed.removeFirst()
        createTab(
            id: closed.id,
            title: closed.title,
            initial: closed.urlString,
            activate: true,
            isPrivate: isPrivateSession,
            groupID: closed.groupID
        )
    }

    func submitAddress(for tab: BrowserTab) {
        load(tab.addressText, in: tab)
    }

    func load(_ input: String, in tab: BrowserTab? = nil) {
        guard let tab = tab ?? activeTab else { return }
        let normalized = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch normalized {
        case "", "chrome://newtab", "chrome://new-tab-page", "about:newtab", "orion://newtab":
            tab.showNewTab()
            scheduleSessionSave()
            return
        case "chrome://extensions", "orion://extensions":
            tab.showExtensions()
            scheduleSessionSave()
            return
        case "chrome://reader", "orion://reader":
            if tab.surface != .reader {
                Task { await tab.toggleReaderMode() }
            }
            return
        default:
            break
        }

        guard let request = NavigationResolver.request(for: input) else { return }
        if let url = request.url,
           RemoteNavigationPolicy.requiresManagedProtection(url),
           !remoteNavigationAllowed() {
            pendingRemoteNavigation = (input, tab.id)
            protectionGateMessage = "Orion is preparing managed content protection before opening remote pages."
            return
        }
        tab.addressText = request.url?.absoluteString ?? input
        tab.load(request)
        if tab.id == activeTabID {
            _ = tab.activate()
        }
        scheduleSessionSave()
    }

    func load(entry: NavigationEntry) {
        load(entry.urlString)
    }

    func retryProtectionAndNavigation() async {
        guard let onRetryProtection else { return }
        let ready = await onRetryProtection()
        guard ready else {
            protectionGateMessage = "Managed content protection could not be installed. Check your connection and try again."
            return
        }
        protectionGateMessage = nil
        guard let pendingRemoteNavigation else { return }
        self.pendingRemoteNavigation = nil
        let tab = tabs.first { $0.id == pendingRemoteNavigation.tabID }
        load(pendingRemoteNavigation.input, in: tab)
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
        if case let .offline(targetURLString, _) = tab.surface {
            load(targetURLString, in: tab)
            return
        }
        guard tab.surface == .web else { return }
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

    func hardReload() {
        activeTab?.hardReload()
    }

    func selectAdjacentTab(offset: Int) {
        guard tabs.count > 1,
              let activeTabID,
              let index = tabs.firstIndex(where: { $0.id == activeTabID })
        else {
            return
        }
        let nextIndex = (index + offset + tabs.count) % tabs.count
        activateTab(tabs[nextIndex].id)
    }

    func loadHomepage() {
        load(BrowserPreferences.homepageURL)
    }

    func stopLoading() {
        activeTab?.webView?.stopLoading()
    }

    func toggleReaderMode() {
        guard let activeTab else { return }
        Task {
            await activeTab.toggleReaderMode()
        }
    }

    func summarizeActivePage() {
        guard let activeTab else { return }
        sidebarMode = .summary
        isSummarizing = true
        pageSummary = nil
        Task {
            pageSummary = await activeTab.summarizePage()
            isSummarizing = false
        }
    }

    func showFind() {
        isFindBarVisible = true
    }

    func closeFind() {
        isFindBarVisible = false
        findStatus = ""
    }

    func find(backwards: Bool = false) {
        guard let activeTab else { return }
        activeTab.find(findQuery, backwards: backwards) { [weak self] ordinal, count in
            self?.findStatus = count > 0 ? "\(ordinal) of \(count)" : "No matches"
        }
    }

    func toggleBookmarkForActiveTab() {
        guard !isPrivateSession,
              let activeTab,
              !activeTab.isPrivate,
              let entry = activeTab.navigationEntry
        else { return }
        _ = library.toggleBookmark(title: entry.displayTitle, urlString: entry.urlString)
    }

    func bookmarkActiveTab(destinations: Set<BookmarkDestination>) {
        guard !isPrivateSession,
              let activeTab,
              !activeTab.isPrivate,
              let entry = activeTab.navigationEntry
        else { return }
        library.addBookmark(
            title: entry.displayTitle,
            urlString: entry.urlString,
            destinations: destinations
        )
    }

    func isBookmarked(_ tab: BrowserTab) -> Bool {
        guard !isPrivateSession, !tab.isPrivate else { return false }
        guard let entry = tab.navigationEntry else { return false }
        return library.isBookmarked(urlString: entry.urlString)
    }

    func extensionTabAdapter(for tabID: BrowserTab.ID) -> WebExtensionTabAdapter? {
        extensionTabAdapters[tabID]
    }

    func configureExtensions(
        controller: WKWebExtensionController,
        runtime: ExtensionRuntime,
        delegate: WebExtensionControllerCoordinator
    ) {
        guard !isPrivateSession, extensionController == nil else { return }
        extensionController = controller
        extensionRuntime = runtime
        extensionDelegate = delegate
        registerExtensionWindowAndTabsIfNeeded()
        if let activeTabID,
           let webView = activeTab?.webView as? OrionWebView,
           let adapter = extensionTabAdapters[activeTabID] {
            configureExtensionContextMenu(
                webView: webView,
                runtime: runtime,
                adapter: adapter
            )
        }
    }

    func resumePendingNavigationIfProtectionReady() {
        guard remoteNavigationAllowed(),
              let pendingRemoteNavigation
        else {
            return
        }
        protectionGateMessage = nil
        self.pendingRemoteNavigation = nil
        load(
            pendingRemoteNavigation.input,
            in: tabs.first { $0.id == pendingRemoteNavigation.tabID }
        )
    }

    @discardableResult
    func openExtensionPage(
        _ url: URL,
        context: WKWebExtensionContext,
        activate: Bool = true
    ) -> WebExtensionTabAdapter? {
        guard !isPrivateSession,
              let configuration = context.webViewConfiguration
        else {
            return nil
        }
        let tab = createTab(
            initial: nil,
            activate: false,
            webViewFactory: {
                WKWebView(frame: .zero, configuration: configuration)
            }
        )
        load(url.absoluteString, in: tab)
        if activate {
            activateTab(tab.id)
        }
        return extensionTabAdapters[tab.id]
    }

    @discardableResult
    func openExtensionRequestedTab(
        url: URL?,
        context: WKWebExtensionContext,
        activate: Bool
    ) -> WebExtensionTabAdapter? {
        guard let url else {
            newTab(activate: activate)
            return activeTabID.flatMap { extensionTabAdapters[$0] }
        }
        if url.scheme == context.baseURL.scheme {
            return openExtensionPage(url, context: context, activate: activate)
        }
        let tab = createTab(initial: url.absoluteString, activate: activate)
        return extensionTabAdapters[tab.id]
    }

    func recordNavigation(for tab: BrowserTab) {
        guard !tab.isPrivate else { return }
        guard let entry = tab.navigationEntry else { return }
        library.addHistory(title: entry.displayTitle, urlString: entry.urlString)
    }

    func evaluateMemoryPressure() {
        enforceBackgroundTabBudget()
    }

    private func enforceBackgroundTabBudget() {
        let mode = BrowserPreferences.ramLimitMode
        let budget = ProcessInfo.processInfo.physicalMemory / 2
        let resident = Self.residentMemoryBytes
        let samples = tabs.map { tab in
            MemoryTabSample(
                id: tab.id,
                estimatedBytes: tab.estimatedResourceBytes,
                historicalPeakBytes: tab.historicalPeakBytes,
                lastActivatedAt: tab.lastActivatedAt,
                isActive: tab.id == activeTabID,
                isAudible: tab.isAudible,
                isPrivate: tab.isPrivate,
                isUnloaded: tab.webView == nil || tab.navigationState.isUnloaded
            )
        }
        let estimated = samples
            .filter { !$0.isUnloaded }
            .reduce(UInt64.zero) {
                $0 + max($1.estimatedBytes, $1.historicalPeakBytes)
            }
        guard mode == .automatic else {
            memoryStatus = MemoryStatus(
                mode: mode,
                residentBytes: resident,
                estimatedWebKitBytes: estimated,
                budgetBytes: budget,
                lastUnloadedTabID: nil
            )
            return
        }
        let candidate = AutomaticMemoryController.candidate(
            from: samples,
            residentBytes: resident,
            budgetBytes: budget
        )
        if let candidate {
            tabs.first(where: { $0.id == candidate.id })?.unload()
        }
        memoryStatus = MemoryStatus(
            mode: mode,
            residentBytes: resident,
            estimatedWebKitBytes: estimated,
            budgetBytes: budget,
            lastUnloadedTabID: candidate?.id
        )
    }

    private static var residentMemoryBytes: UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(
            MemoryLayout<mach_task_basic_info_data_t>.size / MemoryLayout<natural_t>.size
        )
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? UInt64(info.resident_size) : 0
    }

    func createGroup(name: String, including tabID: BrowserTab.ID? = nil) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let group = TabGroup(
            name: trimmed.isEmpty ? "Group \(tabGroups.count + 1)" : trimmed,
            colorHex: TabGroup.palette[tabGroups.count % TabGroup.palette.count]
        )
        tabGroups.append(group)
        if let tabID {
            assignTab(tabID, to: group.id)
        }
        scheduleSessionSave()
    }

    func renameGroup(_ groupID: TabGroup.ID, to name: String) {
        guard let index = tabGroups.firstIndex(where: { $0.id == groupID }) else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        tabGroups[index].name = trimmed
        scheduleSessionSave()
    }

    func deleteGroup(_ groupID: TabGroup.ID) {
        tabGroups.removeAll { $0.id == groupID }
        for tab in tabs where tab.groupID == groupID {
            tab.groupID = nil
        }
        scheduleSessionSave()
    }

    func toggleGroup(_ groupID: TabGroup.ID) {
        guard let index = tabGroups.firstIndex(where: { $0.id == groupID }) else { return }
        tabGroups[index].isCollapsed.toggle()
        scheduleSessionSave()
    }

    func assignTab(_ tabID: BrowserTab.ID, to groupID: TabGroup.ID?) {
        tabs.first(where: { $0.id == tabID })?.groupID = groupID
        scheduleSessionSave()
    }

    func organizeTabsOnDevice() {
        let candidates = tabs.compactMap { tab -> TabGroupOrganizer.Candidate? in
            guard let entry = tab.navigationEntry else { return nil }
            return .init(tabID: tab.id, title: entry.displayTitle, urlString: entry.urlString)
        }
        for suggestion in TabGroupOrganizer.organize(candidates) {
            let group = TabGroup(
                name: suggestion.name,
                colorHex: TabGroup.palette[tabGroups.count % TabGroup.palette.count]
            )
            tabGroups.append(group)
            for tabID in suggestion.tabIDs {
                tabs.first(where: { $0.id == tabID })?.groupID = group.id
            }
        }
        scheduleSessionSave()
    }

    func restoreSessionIfAvailable() async {
        guard !didRestoreSession, let sessionStore, !isPrivateSession else { return }
        didRestoreSession = true
        let snapshot = await sessionStore.load()
        guard !snapshot.tabs.isEmpty else { return }

        for tab in tabs {
            detachExtensionTab(tab.id)
        }
        tabs.removeAll()
        activeTabID = nil
        tabGroups = snapshot.groups
        recentlyClosed = snapshot.recentlyClosed
        for saved in snapshot.tabs {
            createTab(
                id: saved.id,
                title: saved.title,
                initial: saved.urlString,
                activate: false,
                isPrivate: false,
                groupID: saved.groupID
            )
        }
        let selectedID = snapshot.activeTabID.flatMap { id in
            tabs.contains(where: { $0.id == id }) ? id : nil
        } ?? tabs.first?.id
        if let selectedID {
            activateTab(selectedID)
        }
    }

    func flushSession() async {
        sessionSaveTask?.cancel()
        sessionSaveTask = nil
        guard let sessionStore, !isPrivateSession else { return }
        await sessionStore.save(sessionSnapshot)
    }

    private var sessionSnapshot: BrowserSessionSnapshot {
        let persistentTabs = tabs.filter { !$0.isPrivate }
        let persistentTabIDs = Set(persistentTabs.map(\.id))
        return BrowserSessionSnapshot(
            tabs: persistentTabs.map(\.sessionSnapshot),
            groups: tabGroups,
            activeTabID: activeTabID.flatMap {
                persistentTabIDs.contains($0) ? $0 : persistentTabs.first?.id
            },
            recentlyClosed: Array(recentlyClosed.prefix(10))
        )
    }

    private func scheduleSessionSave() {
        guard let sessionStore, !isPrivateSession else { return }
        sessionSaveTask?.cancel()
        let snapshot = sessionSnapshot
        sessionSaveTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await sessionStore.save(snapshot)
        }
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
            closeTab(probeTabID)
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
        case .hardReload:
            hardReload()
        case .reopenClosedTab:
            reopenClosedTab()
        case .nextTab:
            selectAdjacentTab(offset: 1)
        case .previousTab:
            selectAdjacentTab(offset: -1)
        case .showFind:
            showFind()
        case .showHistory:
            sidebarMode = sidebarMode == .history ? nil : .history
        case .showBookmarks:
            sidebarMode = sidebarMode == .bookmarks ? nil : .bookmarks
        case .showDownloads:
            sidebarMode = sidebarMode == .downloads ? nil : .downloads
        case .toggleReader:
            toggleReaderMode()
        case .bookmarkPage:
            toggleBookmarkForActiveTab()
        }
    }

    private func detachExtensionTab(_ id: BrowserTab.ID) {
        guard let adapter = extensionTabAdapters.removeValue(forKey: id) else {
            return
        }
        extensionWindowAdapter?.tabAdapters.removeAll { $0 === adapter }
        extensionController?.didCloseTab(adapter)
    }

    private func registerExtensionWindowAndTabsIfNeeded() {
        guard !isPrivateSession,
              let extensionController,
              extensionWindowAdapter == nil
        else {
            return
        }
        let adapter = WebExtensionWindowAdapter(browser: self)
        extensionWindowAdapter = adapter
        extensionDelegate?.register(adapter)
        extensionController.didOpenWindow(adapter)
        for tab in tabs {
            registerExtensionTabIfNeeded(tab)
        }
    }

    private func registerExtensionTabIfNeeded(_ tab: BrowserTab) {
        guard !tab.isPrivate,
              let extensionController,
              let extensionWindowAdapter,
              extensionTabAdapters[tab.id] == nil
        else {
            return
        }
        let adapter = WebExtensionTabAdapter(
            tab: tab,
            window: extensionWindowAdapter
        )
        extensionWindowAdapter.tabAdapters.append(adapter)
        extensionTabAdapters[tab.id] = adapter
        extensionController.didOpenTab(adapter)
    }

    private func configureExtensionContextMenu(
        webView: OrionWebView,
        runtime: ExtensionRuntime,
        adapter: WebExtensionTabAdapter
    ) {
        webView.additionalContextMenuItems = { [weak runtime, weak adapter] in
            guard let runtime, let adapter else { return [] }
            return runtime.pageMenuItems(for: adapter)
        }
    }
}
