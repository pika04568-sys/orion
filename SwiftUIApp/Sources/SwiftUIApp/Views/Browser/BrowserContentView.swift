import SwiftUI

struct BrowserContentView: View {
    @ObservedObject var browser: BrowserState

    var body: some View {
        Group {
            if let activeTab = browser.activeTab {
                ActiveWebView(tab: activeTab)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "globe")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(.secondary)

                    Text("No Tab Selected")
                        .font(.headline)

                    Button("Open New Tab") {
                        browser.newTab()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

private struct ActiveWebView: View {
    @ObservedObject var tab: BrowserTab

    var body: some View {
        ZStack(alignment: .top) {
            if let webView = tab.webView {
                BrowserWebView(tabID: tab.id, webView: webView)
                    .id(tab.id)
            }

            if let message = tab.navigationState.errorMessage {
                ErrorBanner(message: message) {
                    tab.dismissError()
                }
                .padding(.top, 12)
            }
        }
    }
}

private struct ErrorBanner: View {
    let message: String
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(.yellow)

            Text(message)
                .lineLimit(2)
                .foregroundStyle(.primary)

            Button {
                dismiss()
            } label: {
                Label("Dismiss", systemImage: "xmark")
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.plain)
            .help("Dismiss")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        .shadow(radius: 8, y: 3)
    }
}
