import SwiftUI

struct BrowserRootView: View {
    @Environment(\.colorScheme) private var colorScheme
    @StateObject private var library: BrowserLibraryStore
    @StateObject private var browser: BrowserState

    init() {
        let library = BrowserLibraryStore()
        _library = StateObject(wrappedValue: library)
        _browser = StateObject(wrappedValue: BrowserState(library: library))
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

                    BrowserContentView(browser: browser, library: library)
                }
            }
        }
        .frame(minWidth: 900, minHeight: 620)
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
            if tab.isLoading {
                ProgressView(value: tab.estimatedProgress)
                    .progressViewStyle(.linear)
            } else {
                Color.clear
            }
        }
        .frame(height: 2)
        .tint(OrionVisualStyle.accent)
    }
}
