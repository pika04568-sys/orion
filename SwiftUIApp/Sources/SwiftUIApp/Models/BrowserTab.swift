import Combine
import Foundation
import WebKit

@MainActor
final class BrowserTab: ObservableObject, Identifiable {
    let id: UUID
    @Published private(set) var navigationState: NavigationState
    @Published var addressText: String
    @Published private(set) var webView: WKWebView?

    var onNavigationFinished: ((BrowserTab) -> Void)?

    private let makeWebView: @MainActor () -> WKWebView
    private let onWillLoad: (@MainActor (WKWebView) -> Void)?
    private var pendingRequest: URLRequest?
    private lazy var navigationCoordinator = WebViewNavigationCoordinator(tab: self)

    init(
        id: UUID = UUID(),
        title: String = "New Tab",
        urlString: String = "",
        makeWebView: @escaping @MainActor () -> WKWebView = WebViewEnvironment.makeWebView,
        onWillLoad: (@MainActor (WKWebView) -> Void)? = nil
    ) {
        self.id = id
        self.navigationState = NavigationState(title: title, urlString: urlString)
        self.addressText = urlString
        self.webView = nil
        self.makeWebView = makeWebView
        self.onWillLoad = onWillLoad
    }

    @discardableResult
    func activate() -> WKWebView {
        if let webView {
            return webView
        }

        let materializationStartedAt = OrionPerformance.now
        let createdWebView = makeWebView()
        navigationCoordinator.attach(to: createdWebView)
        webView = createdWebView
        OrionPerformance.webViewDidMaterialize(tabID: id, startedAt: materializationStartedAt)

        if let pendingRequest {
            self.pendingRequest = nil
            dispatch(pendingRequest, to: createdWebView)
        }

        return createdWebView
    }

    func load(_ request: URLRequest) {
        navigationState.errorMessage = nil
        addressText = request.url?.absoluteString ?? addressText

        guard let webView else {
            pendingRequest = request
            return
        }

        dispatch(request, to: webView)
    }

    func dismissError() {
        navigationState.errorMessage = nil
    }

    func applyNavigationState(_ state: NavigationState) {
        navigationState = state
    }

    private func dispatch(_ request: URLRequest, to webView: WKWebView) {
        let dispatchStartedAt = OrionPerformance.navigationWillDispatch(tabID: id)
        onWillLoad?(webView)
        webView.load(request)
        OrionPerformance.navigationDidDispatch(tabID: id, startedAt: dispatchStartedAt)
    }

    var displayTitle: String {
        let trimmedTitle = navigationState.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedTitle.isEmpty, trimmedTitle != "New Tab" {
            return trimmedTitle
        }

        if let host = URL(string: navigationState.urlString)?.host, !host.isEmpty {
            return host
        }

        return "New Tab"
    }

    var navigationEntry: NavigationEntry? {
        guard let url = URL(string: navigationState.urlString),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme)
        else {
            return nil
        }

        return NavigationEntry(title: displayTitle, urlString: url.absoluteString)
    }
}

@MainActor
enum WebViewEnvironment {
    static let processPool = WKProcessPool()

    static func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.processPool = processPool

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        return webView
    }
}

@MainActor
private final class WebViewNavigationCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    private enum Completion {
        case none
        case started
        case finished
        case failed(String?)
        case terminated
    }

    private weak var tab: BrowserTab?
    private weak var webView: WKWebView?
    private var observations: [NSKeyValueObservation] = []
    private var syncScheduled = false
    private var pendingCompletion = Completion.none

    init(tab: BrowserTab) {
        self.tab = tab
    }

    func attach(to webView: WKWebView) {
        self.webView = webView
        webView.navigationDelegate = self
        webView.uiDelegate = self

        observations = [
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in self?.scheduleSync() }
            },
            webView.observe(\.isLoading, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in self?.scheduleSync() }
            },
            webView.observe(\.title, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in self?.scheduleSync() }
            },
            webView.observe(\.url, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in self?.scheduleSync() }
            },
            webView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in self?.scheduleSync() }
            },
            webView.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in self?.scheduleSync() }
            }
        ]
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        pendingCompletion = .started
        scheduleSync()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        scheduleSync()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pendingCompletion = .finished
        scheduleSync()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(with: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(with: error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pendingCompletion = .terminated
        scheduleSync()
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

    private func finish(with error: Error) {
        let nsError = error as NSError
        if nsError.code == NSURLErrorCancelled {
            scheduleSync()
            return
        }
        pendingCompletion = .failed(nsError.localizedDescription)
        scheduleSync()
    }

    private func scheduleSync() {
        guard !syncScheduled else { return }
        syncScheduled = true

        Task { @MainActor [weak self] in
            await Task.yield()
            self?.flushState()
        }
    }

    private func flushState() {
        syncScheduled = false
        guard let tab, let webView else { return }

        var state = tab.navigationState
        if let urlString = webView.url?.absoluteString {
            state.urlString = urlString
            tab.addressText = urlString
        }

        if let title = webView.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            state.title = title
        }

        state.isLoading = webView.isLoading
        state.estimatedProgress = webView.estimatedProgress
        state.canGoBack = webView.canGoBack
        state.canGoForward = webView.canGoForward

        let completion = pendingCompletion
        pendingCompletion = .none
        switch completion {
        case .none:
            break
        case .started:
            state.errorMessage = nil
        case .finished:
            state.isLoading = false
            state.estimatedProgress = 1
            state.errorMessage = nil
        case let .failed(message):
            state.isLoading = false
            state.estimatedProgress = 0
            state.errorMessage = message
        case .terminated:
            state.isLoading = false
            state.estimatedProgress = 0
            state.errorMessage = "The page stopped responding."
        }

        tab.applyNavigationState(state)
        if case .finished = completion {
            OrionPerformance.navigationDidFinish(tabID: tab.id, webView: webView)
            tab.onNavigationFinished?(tab)
        }
    }
}
