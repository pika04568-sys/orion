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
    let route: BrowserWindowRoute

    init(
        coordinator: AppCoordinator = AppCoordinator(),
        route: BrowserWindowRoute = .normal()
    ) {
        self.coordinator = coordinator
        self.route = route
        let profile = coordinator.profile(for: route)
        let library = coordinator.libraryStore(for: route)
        let initialURL = ProcessInfo.processInfo.environment["ORION_PERF_URL"]
            ?? route.initialURL
            ?? BrowserPreferences.homepageURL
        _library = StateObject(wrappedValue: library)
        _browser = StateObject(
            wrappedValue: BrowserState(
                library: library,
                initialURL: initialURL,
                profile: profile,
                isPrivateSession: route.isPrivate,
                sessionStore: coordinator.sessionStore(for: route),
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
                        TabStripView(browser: browser, vertical: true)
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
        .preferredColorScheme(resolvedColorScheme)
        .environment(\.locale, Locale(identifier: interfaceLanguage))
        .focusedSceneValue(\.browserCommandActions, commandActions)
        .onAppear { [browser] in
            browser.onOpenWindow = { route in
                openWindow(id: "browser", value: route)
            }
            if OrionPerformance.isPerformanceRun {
                OrionPerformance.installInteractionProbe { [weak browser] in
                    guard let browser else { return (0, 0) }
                    return await browser.measurePerformanceInteractions()
                }
            }
            Task { @MainActor in
                await Task.yield()
                await Task.yield()
                OrionPerformance.shellDidAppear()
            }
        }
        .task {
            await coordinator.load()
            if !route.isPrivate {
                await coordinator.runtime(for: route).load()
            }
            await library.load()
            await browser.restoreSessionIfAvailable()
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
