import SwiftUI

struct BrowserSurfaceContentView: View {
    @ObservedObject var browser: BrowserState
    @ObservedObject var library: BrowserLibraryStore

    var body: some View {
        Group {
            if let tab = browser.activeTab {
                ActiveBrowserSurface(browser: browser, library: library, tab: tab)
            } else {
                ContentUnavailableView {
                    Label("No Tab Selected", systemImage: "globe")
                } actions: {
                    Button("Open New Tab") { browser.newTab() }
                }
            }
        }
    }
}

private struct ActiveBrowserSurface: View {
    @ObservedObject var browser: BrowserState
    @ObservedObject var library: BrowserLibraryStore
    @ObservedObject var tab: BrowserTab

    var body: some View {
        ZStack(alignment: .top) {
            switch tab.surface {
            case .newTab:
                NewTabSurfaceView(browser: browser, library: library, profile: browser.profile)
            case .web:
                if let webView = tab.webView {
                    BrowserWebView(tabID: tab.id, webView: webView)
                        .id(tab.id)
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .task { _ = tab.activate() }
                }
            case .reader:
                if let snapshot = tab.readerSnapshot {
                    ReaderSurfaceView(snapshot: snapshot)
                } else {
                    ContentUnavailableView("Reader Unavailable", systemImage: "doc.text.magnifyingglass")
                }
            case let .offline(targetURLString, game):
                OfflineArcadeView(
                    targetURLString: targetURLString,
                    game: game,
                    retry: { browser.load(targetURLString, in: tab) }
                )
            case .extensions:
                ExtensionsSurfaceView(
                    isPrivate: browser.isPrivateSession,
                    browser: browser,
                    runtime: browser.extensionRuntime
                )
            }

            if let message = tab.navigationState.errorMessage {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundStyle(.yellow)
                    Text(message).lineLimit(2)
                    Button {
                        tab.dismissError()
                    } label: {
                        Label("Dismiss", systemImage: "xmark")
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                .shadow(radius: 8, y: 3)
                .padding(.top, 12)
            }

            if let message = browser.protectionGateMessage {
                VStack(spacing: 12) {
                    Image(systemName: "shield.lefthalf.filled")
                        .font(.largeTitle)
                        .foregroundStyle(.tint)
                    Text("Protection Required")
                        .font(.headline)
                    Text(message)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Button("Retry Installation") {
                        Task { await browser.retryProtectionAndNavigation() }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(24)
                .frame(maxWidth: 440)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
                .shadow(radius: 24, y: 10)
                .padding(.top, 32)
            }
        }
    }
}
