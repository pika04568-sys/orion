import SwiftUI
import WebKit

struct BrowserWebView: NSViewRepresentable {
    let tabID: BrowserTab.ID
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        // The tab owns this exact WKWebView for its lifetime. SwiftUI only hosts it.
    }
}
