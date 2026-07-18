import SwiftUI

struct BrowserRootView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openWindow) private var openWindow
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(BrowserPreferenceKeys.verticalTabs) private var verticalTabs = false
    @AppStorage(BrowserPreferenceKeys.showBookmarksBar) private var showBookmarksBar = true
    @AppStorage(BrowserPreferenceKeys.preferredColorScheme) private var preferredColorScheme = "system"
    @AppStorage(BrowserPreferenceKeys.interfaceLanguage) private var interfaceLanguage = InterfaceLanguage.resolvedDefault.rawValue
    @AppStorage(BrowserPreferenceKeys.onboardingCompleted) private var onboardingCompleted = false
    @StateObject private var library: BrowserLibraryStore
    @StateObject private var browser: BrowserState
    private let coordinator: AppCoordinator
    private let profileRuntime: ProfileRuntime?
    private let initialURL: String?
    let route: BrowserWindowRoute

    init(
        coordinator: AppCoordinator = AppCoordinator(),
        route: BrowserWindowRoute = .normal()
    ) {
        self.coordinator = coordinator
        self.route = route
        let profile = coordinator.profile(for: route)
        let library = coordinator.libraryStore(for: route)
        let profileRuntime = route.isPrivate ? nil : coordinator.runtime(for: route)
        self.profileRuntime = profileRuntime
        let initialURL = ProcessInfo.processInfo.environment["ORION_PERF_URL"]
            ?? route.initialURL
            ?? BrowserPreferences.homepageURL
        self.initialURL = initialURL
        _library = StateObject(wrappedValue: library)
        _browser = StateObject(
            wrappedValue: BrowserState(
                library: library,
                initialURL: nil,
                profile: profile,
                isPrivateSession: route.isPrivate,
                sessionStore: coordinator.sessionStore(for: route),
                permissionStore: route.isPrivate ? nil : profileRuntime?.permissions,
                makeWebView: { isPrivate in
                    coordinator.makeWebView(for: route, isPrivate: isPrivate)
                }
            )
        )
    }

    var body: some View {
        ZStack {
            OrionVisualStyle.pageBackground(for: colorScheme)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    if !verticalTabs {
                        HStack(spacing: 0) {
                            TabStripView(browser: browser)
                            profileMenu
                        }
                    }

                    if let activeTab = browser.activeTab {
                        BrowserToolbarView(browser: browser, tab: activeTab, library: library)
                        LoadingProgressView(tab: activeTab)
                    }

                    if showBookmarksBar, !library.bookmarks.isEmpty {
                        BookmarksBarView(browser: browser, library: library)
                    }
                }
                .background {
                    OrionVisualStyle.chromeBackground(for: colorScheme)
                        .overlay(alignment: .bottom) {
                            OrionVisualStyle.border(for: colorScheme)
                                .frame(height: 1)
                        }
                }
                .shadow(color: Color.black.opacity(colorScheme == .dark ? 0.30 : 0.08), radius: 18, y: 8)

                HStack(spacing: 0) {
                    if verticalTabs {
                        VStack(spacing: 0) {
                            HStack {
                                profileMenu
                                Spacer()
                            }
                            .padding(.leading, 12)
                            .padding(.vertical, 8)

                            TabStripView(browser: browser, vertical: true)
                        }
                        .frame(width: 230)
                        Divider()
                    }

                    if let sidebarMode = browser.sidebarMode {
                        LibrarySidebarView(mode: sidebarMode, browser: browser, library: library)
                            .frame(width: 340)
                        Divider()
                    }

                    BrowserSurfaceContentView(browser: browser, library: library)
                }
            }
        }
        .frame(minWidth: 900, minHeight: 620)
        .overlay(alignment: .bottomTrailing) {
            UpdateAvailabilityBanner(updates: coordinator.updates)
                .padding(18)
        }
        .preferredColorScheme(resolvedColorScheme)
        .environment(\.locale, Locale(identifier: interfaceLanguage))
        .focusedSceneValue(\.browserCommandActions, commandActions)
        .onAppear { [browser] in
            OrionPerformance.shellDidAppear()
            browser.onOpenWindow = { route in
                openWindow(id: "browser", value: route)
            }
            if !route.isPrivate, let profileRuntime {
                browser.remoteNavigationAllowed = {
                    profileRuntime.extensions.managedState.permitsRemoteNavigation
                }
                browser.onRetryProtection = {
                    await profileRuntime.extensions.retryManagedProtection()
                    return profileRuntime.extensions.managedState.permitsRemoteNavigation
                }
            }
            if OrionPerformance.isPerformanceRun {
                OrionPerformance.installInteractionProbe { [weak browser] in
                    guard let browser else { return (0, 0) }
                    return await browser.measurePerformanceInteractions()
                }
            }
        }
        .task {
            if OrionPerformance.isPerformanceRun {
                if let initialURL, !initialURL.isEmpty {
                    browser.load(initialURL)
                }
                return
            }
            await coordinator.load()
            if !route.isPrivate {
                await profileRuntime?.load()
                if let profileRuntime {
                    browser.configureExtensions(
                        controller: profileRuntime.webExtensionController,
                        runtime: profileRuntime.extensions,
                        delegate: profileRuntime.webExtensionDelegate
                    )
                }
            }
            await library.load()
            await browser.restoreSessionIfAvailable()
            if browser.tabs.count == 1,
               browser.activeTab?.surface == .newTab,
               let initialURL,
               !initialURL.isEmpty {
                if route.kind == .extensionWindow,
                   let extensionID = route.extensionID,
                   let context = profileRuntime?.extensions.context(for: extensionID),
                   let url = URL(string: initialURL) {
                    let placeholderID = browser.activeTabID
                    if browser.openExtensionPage(url, context: context) != nil,
                       let placeholderID {
                        browser.closeTab(placeholderID)
                    }
                } else {
                    browser.load(initialURL)
                }
            }
            browser.resumePendingNavigationIfProtectionReady()
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { return }
                browser.evaluateMemoryPressure()
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase != .active else { return }
            Task {
                await library.flush()
                await browser.flushSession()
                await coordinator.flush()
            }
        }
        .sheet(isPresented: onboardingPresentation) {
            LanguageOnboardingView()
        }
    }

    private var resolvedColorScheme: ColorScheme? {
        switch preferredColorScheme {
        case "light":
            .light
        case "dark":
            .dark
        default:
            nil
        }
    }

    private var commandActions: BrowserCommandActions {
        BrowserCommandActions(
            newTab: { browser.newTab() },
            newPrivateWindow: {
                openWindow(id: "browser", value: BrowserWindowRoute.incognito())
            },
            closeTab: { browser.closeActiveTab() },
            reopenClosedTab: { browser.reopenClosedTab() },
            goBack: { browser.goBack() },
            goForward: { browser.goForward() },
            reload: { browser.reload() },
            hardReload: { browser.hardReload() },
            nextTab: { browser.selectAdjacentTab(offset: 1) },
            previousTab: { browser.selectAdjacentTab(offset: -1) },
            focusAddress: {
                NotificationCenter.default.post(name: .orionFocusAddress, object: nil)
            },
            selectNumberedTab: { number in
                let index = number == 9 ? browser.tabs.count - 1 : number - 1
                guard browser.tabs.indices.contains(index) else { return }
                browser.activateTab(browser.tabs[index].id)
            },
            showFind: { browser.showFind() },
            showHistory: {
                browser.sidebarMode = browser.sidebarMode == .history ? nil : .history
            },
            showBookmarks: {
                browser.sidebarMode = browser.sidebarMode == .bookmarks ? nil : .bookmarks
            },
            showDownloads: {
                browser.sidebarMode = browser.sidebarMode == .downloads ? nil : .downloads
            },
            toggleReader: { browser.toggleReaderMode() },
            bookmarkPage: { browser.toggleBookmarkForActiveTab() }
        )
    }

    private var profileMenu: some View {
        ProfileMenuView(
            profileStore: coordinator.profileStore,
            activeProfile: browser.profile,
            isPrivate: route.isPrivate,
            openProfile: { profile in
                openWindow(
                    id: "browser",
                    value: BrowserWindowRoute.normal(profileID: profile.id)
                )
            },
            createProfile: {
                let profile = coordinator.profileStore.addProfile()
                openWindow(
                    id: "browser",
                    value: BrowserWindowRoute.normal(profileID: profile.id)
                )
            }
        )
    }

    private var onboardingPresentation: Binding<Bool> {
        Binding(
            get: { !onboardingCompleted },
            set: { presented in
                if !presented {
                    onboardingCompleted = true
                }
            }
        )
    }
}

private struct UpdateAvailabilityBanner: View {
    @ObservedObject var updates: UpdateRuntime

    var body: some View {
        if case let .available(version, url) = updates.state {
            HStack(spacing: 12) {
                Image(systemName: "arrow.down.circle.fill")
                    .foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Orion \(version) is available.")
                        .font(.headline)
                    Text("Open the release page to install it.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Link("Open Release", destination: url)
                    .buttonStyle(.borderedProminent)
            }
            .padding(14)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            .shadow(radius: 18, y: 8)
        }
    }
}

private struct LoadingProgressView: View {
    @ObservedObject var tab: BrowserTab

    var body: some View {
        Group {
            if tab.navigationState.isLoading {
                ProgressView(value: tab.navigationState.estimatedProgress)
                    .progressViewStyle(.linear)
            } else {
                Color.clear
            }
        }
        .frame(height: 2)
        .tint(OrionVisualStyle.accent)
    }
}
