import Combine
import Foundation
import WebKit

@MainActor
final class BrowserTab: ObservableObject, Identifiable {
    let id: UUID
    let webView: WKWebView

    @Published var title: String
    @Published var urlString: String
    @Published var addressText: String
    @Published var isLoading: Bool
    @Published var estimatedProgress: Double
    @Published var canGoBack: Bool
    @Published var canGoForward: Bool
    @Published var errorMessage: String?

    init(id: UUID = UUID(), title: String = "New Tab", urlString: String = "") {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true

        self.id = id
        self.webView = webView
        self.title = title
        self.urlString = urlString
        self.addressText = urlString
        self.isLoading = false
        self.estimatedProgress = 0
        self.canGoBack = false
        self.canGoForward = false
        self.errorMessage = nil
    }

    var displayTitle: String {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedTitle.isEmpty, trimmedTitle != "New Tab" {
            return trimmedTitle
        }

        if let host = URL(string: urlString)?.host, !host.isEmpty {
            return host
        }

        return "New Tab"
    }

    var navigationEntry: NavigationEntry? {
        guard let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme)
        else {
            return nil
        }

        return NavigationEntry(title: displayTitle, urlString: url.absoluteString)
    }
}
