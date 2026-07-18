import SwiftUI
import WebKit

struct OfflineArcadeView: View {
    let targetURLString: String
    let game: OfflineGame
    let retry: () -> Void

    var body: some View {
        OfflineArcadeWebView(
            targetURLString: targetURLString,
            game: game,
            retry: retry
        )
    }
}

private struct OfflineArcadeWebView: NSViewRepresentable {
    let targetURLString: String
    let game: OfflineGame
    let retry: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(retry: retry)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        context.coordinator.load(
            targetURLString: targetURLString,
            game: game,
            in: webView
        )
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let signature = "\(game.rawValue)|\(targetURLString)"
        guard context.coordinator.signature != signature else { return }
        context.coordinator.load(
            targetURLString: targetURLString,
            game: game,
            in: webView
        )
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var signature = ""
        private let retry: () -> Void

        init(retry: @escaping () -> Void) {
            self.retry = retry
        }

        func load(
            targetURLString: String,
            game: OfflineGame,
            in webView: WKWebView
        ) {
            signature = "\(game.rawValue)|\(targetURLString)"
            guard let root = Bundle.module.resourceURL,
                  FileManager.default.fileExists(
                    atPath: root.appendingPathComponent("offline.html").path
                  ),
                  var components = URLComponents(
                    url: root.appendingPathComponent("offline.html"),
                    resolvingAgainstBaseURL: false
                  )
            else {
                return
            }
            components.queryItems = [
                URLQueryItem(name: "game", value: game.rawValue),
                URLQueryItem(name: "target", value: targetURLString)
            ]
            guard let url = components.url else { return }
            webView.loadFileURL(url, allowingReadAccessTo: root)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            if navigationAction.targetFrame?.isMainFrame != false,
               let url = navigationAction.request.url,
               url.scheme != "file" {
                retry()
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
