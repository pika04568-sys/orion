import SwiftUI

struct BrowserRootView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var library: BrowserLibraryStore
    @StateObject private var browser: BrowserState

    init() {
        let library = BrowserLibraryStore()
        let initialURL = ProcessInfo.processInfo.environment["ORION_PERF_URL"] ?? BrowserPreferences.homepageURL
        _library = StateObject(wrappedValue: library)
        _browser = StateObject(wrappedValue: BrowserState(library: library, initialURL: initialURL))
    }

    var body: some View {
        ZStack {
            OrionVisualStyle.pageBackground(for: colorScheme)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    TabStripView(browser: browser)

                    if let activeTab = browser.activeTab {
                        BrowserToolbarView(browser: browser, tab: activeTab, library: library)
                        LoadingProgressView(tab: activeTab)
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
                    if let sidebarMode = browser.sidebarMode {
                        LibrarySidebarView(mode: sidebarMode, browser: browser, library: library)
                            .frame(width: 340)
                        Divider()
                    }

                    BrowserContentView(browser: browser)
                }
            }
        }
        .frame(minWidth: 900, minHeight: 620)
        .onAppear { [browser] in
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
            await library.load()
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase != .active else { return }
            Task {
                await library.flush()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: BrowserCommandCenter.notification)) { notification in
            guard let command = BrowserCommandCenter.command(from: notification) else { return }
            browser.handle(command)
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
