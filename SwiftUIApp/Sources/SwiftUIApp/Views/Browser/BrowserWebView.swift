import SwiftUI
import WebKit

struct BrowserWebView: NSViewRepresentable {
    @ObservedObject var tab: BrowserTab
    let onNavigationFinished: (BrowserTab) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(tab: tab, onNavigationFinished: onNavigationFinished)
    }

    func makeNSView(context: Context) -> WKWebView {
        tab.webView.navigationDelegate = context.coordinator
        tab.webView.uiDelegate = context.coordinator
        return tab.webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.tab = tab
        context.coordinator.onNavigationFinished = onNavigationFinished

        if webView.navigationDelegate !== context.coordinator {
            webView.navigationDelegate = context.coordinator
        }

        if webView.uiDelegate !== context.coordinator {
            webView.uiDelegate = context.coordinator
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var tab: BrowserTab
        var onNavigationFinished: (BrowserTab) -> Void

        init(tab: BrowserTab, onNavigationFinished: @escaping (BrowserTab) -> Void) {
            self.tab = tab
            self.onNavigationFinished = onNavigationFinished
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            tab.isLoading = true
            tab.estimatedProgress = 0.18
            tab.errorMessage = nil
            syncState(from: webView, finished: false)
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            tab.estimatedProgress = max(tab.estimatedProgress, 0.55)
            syncState(from: webView, finished: false)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            syncState(from: webView, finished: true)
            onNavigationFinished(tab)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            finishWithError(error, webView: webView)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            finishWithError(error, webView: webView)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            tab.isLoading = false
            tab.estimatedProgress = 0
            tab.errorMessage = "The page stopped responding."
            syncState(from: webView, finished: false)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }

            return nil
        }

        private func finishWithError(_ error: Error, webView: WKWebView) {
            let nsError = error as NSError
            tab.isLoading = false
            tab.estimatedProgress = 0
            tab.errorMessage = nsError.code == NSURLErrorCancelled ? nil : nsError.localizedDescription
            syncState(from: webView, finished: false)
        }

        private func syncState(from webView: WKWebView, finished: Bool) {
            if let url = webView.url?.absoluteString {
                tab.urlString = url
                tab.addressText = url
            }

            if let title = webView.title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                tab.title = title
            }

            tab.canGoBack = webView.canGoBack
            tab.canGoForward = webView.canGoForward

            if finished {
                tab.isLoading = false
                tab.estimatedProgress = 1
            }
        }
    }
}
