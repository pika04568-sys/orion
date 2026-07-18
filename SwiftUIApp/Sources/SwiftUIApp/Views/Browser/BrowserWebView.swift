import AppKit
import SwiftUI
import WebKit

@MainActor
final class OrionWebView: WKWebView {
    var additionalContextMenuItems: (() -> [NSMenuItem])?

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event) ?? NSMenu()
        let additionalItems = additionalContextMenuItems?() ?? []
        guard !additionalItems.isEmpty else { return menu }
        if !menu.items.isEmpty {
            menu.addItem(.separator())
        }
        for item in additionalItems {
            menu.addItem(item)
        }
        return menu
    }
}

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
