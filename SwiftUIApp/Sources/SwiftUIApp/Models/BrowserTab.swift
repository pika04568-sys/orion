import Combine
import Foundation
import WebKit

@MainActor
final class BrowserTab: ObservableObject, Identifiable {
    let id: UUID
    let isPrivate: Bool
    @Published var groupID: UUID?
    @Published private(set) var navigationState: NavigationState
    @Published var addressText: String
    @Published private(set) var webView: WKWebView?
    @Published private(set) var surface: BrowserSurface
    @Published private(set) var readerSnapshot: ReaderSnapshot?
    @Published private(set) var lastActivatedAt = Date.distantPast
    @Published private(set) var estimatedResourceBytes: UInt64 = 96 * 1_024 * 1_024
    @Published private(set) var historicalPeakBytes: UInt64 = 96 * 1_024 * 1_024

    var onNavigationFinished: ((BrowserTab) -> Void)?
    var onDownloadStarted: ((BrowserDownload) -> Void)?
    var onDownloadUpdated: ((UUID, BrowserDownload.State, URL?, Double?) -> Void)?
    var onPopupRequested: ((URLRequest) -> Void)?

    private let makeWebView: @MainActor () -> WKWebView
    private let onWillLoad: (@MainActor (WKWebView) -> Void)?
    private var pendingRequest: URLRequest?
    private var readerSourceURL: URL?
    private var navigationGeneration = 0
    private var offlineGameRotation = OfflineGameRotation()
    private lazy var navigationCoordinator = WebViewNavigationCoordinator(tab: self)

    init(
        id: UUID = UUID(),
        title: String = "New Tab",
        urlString: String = "",
        isPrivate: Bool = false,
        groupID: UUID? = nil,
        makeWebView: @escaping @MainActor () -> WKWebView = { WebViewEnvironment.makeWebView() },
        onWillLoad: (@MainActor (WKWebView) -> Void)? = nil
    ) {
        self.id = id
        self.isPrivate = isPrivate
        self.groupID = groupID
        self.navigationState = NavigationState(title: title, urlString: urlString)
        self.addressText = urlString
        self.webView = nil
        self.surface = urlString.isEmpty ? .newTab : .web
        self.readerSnapshot = nil
        self.makeWebView = makeWebView
        self.onWillLoad = onWillLoad
    }

    @discardableResult
    func activate() -> WKWebView? {
        lastActivatedAt = Date()
        guard surface == .web else { return webView }
        if let webView {
            return webView
        }

        let materializationStartedAt = OrionPerformance.now
        let createdWebView = makeWebView()
        navigationCoordinator.attach(to: createdWebView)
        webView = createdWebView
        estimatedResourceBytes = max(estimatedResourceBytes, 160 * 1_024 * 1_024)
        historicalPeakBytes = max(historicalPeakBytes, estimatedResourceBytes)
        navigationState.isUnloaded = false
        OrionPerformance.webViewDidMaterialize(tabID: id, startedAt: materializationStartedAt)

        if let pendingRequest {
            self.pendingRequest = nil
            dispatch(pendingRequest, to: createdWebView)
        }

        return createdWebView
    }

    func load(_ request: URLRequest) {
        navigationGeneration += 1
        navigationState.errorMessage = nil
        navigationState.isReaderMode = false
        readerSnapshot = nil
        readerSourceURL = nil
        surface = .web
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

    func hardReload() {
        guard let url = webView?.url ?? URL(string: navigationState.urlString) else { return }
        load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
    }

    func unload() {
        guard let webView,
              !navigationState.isLoading,
              let url = webView.url ?? URL(string: navigationState.urlString)
        else {
            return
        }
        webView.stopLoading()
        navigationCoordinator.detach()
        pendingRequest = URLRequest(url: url)
        self.webView = nil
        estimatedResourceBytes = 12 * 1_024 * 1_024
        navigationState.isUnloaded = true
    }

    func find(
        _ query: String,
        backwards: Bool = false,
        completion: @escaping (_ ordinal: Int, _ count: Int) -> Void
    ) {
        guard let webView, !query.isEmpty else {
            completion(0, 0)
            return
        }
        let script = """
        (() => {
          const query = \(Self.javaScriptString(query));
          const backwards = \(backwards ? "true" : "false");
          const existing = window.__orionFind;
          if (!existing || existing.query !== query) {
            document.querySelectorAll('mark[data-orion-find]').forEach(mark => {
              mark.replaceWith(document.createTextNode(mark.textContent || ''));
            });
            document.normalize();
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
              acceptNode(node) {
                const parent = node.parentElement;
                if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(parent.tagName)) {
                  return NodeFilter.FILTER_REJECT;
                }
                return node.data.toLocaleLowerCase().includes(query.toLocaleLowerCase())
                  ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
              }
            });
            const matches = [];
            let node;
            while ((node = walker.nextNode()) && matches.length < 500) {
              const lower = node.data.toLocaleLowerCase();
              const needle = query.toLocaleLowerCase();
              let start = 0;
              while ((start = lower.indexOf(needle, start)) >= 0 && matches.length < 500) {
                matches.push({ node, start, length: query.length });
                start += Math.max(1, query.length);
              }
            }
            const marks = [];
            for (let index = matches.length - 1; index >= 0; index--) {
              const match = matches[index];
              const range = document.createRange();
              range.setStart(match.node, match.start);
              range.setEnd(match.node, match.start + match.length);
              const mark = document.createElement('mark');
              mark.dataset.orionFind = '1';
              mark.style.background = '#ffe66d';
              mark.style.color = '#111';
              range.surroundContents(mark);
              marks.unshift(mark);
            }
            window.__orionFind = { query, marks, index: backwards ? marks.length - 1 : 0 };
          } else if (existing.marks.length) {
            existing.index = (
              existing.index + (backwards ? -1 : 1) + existing.marks.length
            ) % existing.marks.length;
          }
          const state = window.__orionFind;
          state.marks.forEach((mark, index) => {
            mark.style.background = index === state.index ? '#ff9f1c' : '#ffe66d';
          });
          state.marks[state.index]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return { count: state.marks.length, ordinal: state.marks.length ? state.index + 1 : 0 };
        })()
        """
        webView.evaluateJavaScript(script) { result, _ in
            let values = result as? [String: Any]
            completion(values?["ordinal"] as? Int ?? 0, values?["count"] as? Int ?? 0)
        }
    }

    func toggleReaderMode() async {
        if surface == .reader {
            guard let readerSourceURL else { return }
            navigationState.isReaderMode = false
            surface = .web
            readerSnapshot = nil
            load(URLRequest(url: readerSourceURL))
            self.readerSourceURL = nil
            return
        }

        guard let webView,
              let sourceURL = webView.url
        else {
            navigationState.errorMessage = "Reader mode is unavailable for this page."
            return
        }

        let generation = navigationGeneration
        guard let snapshot = await extractedArticle(from: webView),
              generation == navigationGeneration,
              webView.url == sourceURL
        else {
            if generation == navigationGeneration {
                navigationState.errorMessage = "Reader mode is unavailable for this page."
            }
            return
        }

        readerSourceURL = sourceURL
        readerSnapshot = snapshot
        navigationState.isReaderMode = true
        surface = .reader
        addressText = BrowserSurface.reader.displayURLString
    }

    func summarizePage() async -> PageSummary? {
        let snapshot: ReaderSnapshot?
        if let readerSnapshot {
            snapshot = readerSnapshot
        } else if let webView {
            let generation = navigationGeneration
            let extracted = await extractedArticle(from: webView)
            snapshot = generation == navigationGeneration ? extracted : nil
        } else {
            snapshot = nil
        }
        guard let snapshot else { return nil }
        return PageSummaryService.summarize(
            .init(
                title: snapshot.title,
                host: snapshot.site,
                text: snapshot.plainText
            )
        )
    }

    func applyNavigationState(_ state: NavigationState) {
        navigationState = state
    }

    func showOfflinePage(for url: URL, message: String) {
        navigationGeneration += 1
        webView?.stopLoading()
        navigationState.errorMessage = nil
        navigationState.isLoading = false
        navigationState.isReaderMode = false
        navigationState.title = "Offline Arcade"
        addressText = url.absoluteString
        surface = .offline(
            targetURLString: url.absoluteString,
            game: offlineGameRotation.next()
        )
    }

    func showNewTab() {
        navigationGeneration += 1
        webView?.stopLoading()
        pendingRequest = nil
        readerSnapshot = nil
        readerSourceURL = nil
        surface = .newTab
        addressText = BrowserSurface.newTab.displayURLString
        navigationState = NavigationState(title: "New Tab", urlString: addressText)
    }

    func showExtensions() {
        navigationGeneration += 1
        webView?.stopLoading()
        pendingRequest = nil
        readerSnapshot = nil
        readerSourceURL = nil
        surface = .extensions
        addressText = BrowserSurface.extensions.displayURLString
        navigationState = NavigationState(title: "Extensions", urlString: addressText)
    }

    func navigationDidStart() {
        navigationGeneration += 1
        if surface != .web {
            surface = .web
            readerSnapshot = nil
            readerSourceURL = nil
        }
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

        switch surface {
        case .newTab:
            return "New Tab"
        case .reader:
            return readerSnapshot?.title ?? "Reader"
        case .offline:
            return "Offline Arcade"
        case .extensions:
            return "Extensions"
        case .web:
            return "New Tab"
        }
    }

    var navigationEntry: NavigationEntry? {
        let candidate = surface == .reader ? readerSourceURL?.absoluteString : navigationState.urlString
        guard let candidate,
              let url = URL(string: candidate),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme)
        else {
            return nil
        }

        return NavigationEntry(title: displayTitle, urlString: url.absoluteString)
    }

    var sessionSnapshot: BrowserTabSnapshot {
        BrowserTabSnapshot(
            id: id,
            title: displayTitle,
            urlString: navigationEntry?.urlString ?? {
                let alias = surface.displayURLString
                return alias.isEmpty ? navigationState.urlString : alias
            }(),
            groupID: groupID,
            readerSourceURLString: readerSourceURL?.absoluteString,
            isReaderMode: navigationState.isReaderMode,
            isUnloaded: navigationState.isUnloaded
        )
    }

    private func extractedArticle(from webView: WKWebView) async -> ReaderSnapshot? {
        let script = """
        (() => {
          const root = document.querySelector('article, main, [role="main"]') || document.body;
          if (!root) return null;
          const normalize = value => (value || '').replace(/\\s+/g, ' ').trim();
          const blocks = [...root.querySelectorAll('h1,h2,h3,p,blockquote,li')]
            .slice(0, 400)
            .map(node => ({
              kind: /^H[1-3]$/.test(node.tagName) ? 'heading'
                : node.tagName === 'BLOCKQUOTE' ? 'quote'
                : node.tagName === 'LI' ? 'listItem' : 'paragraph',
              text: normalize(node.innerText)
            }))
            .filter(block => block.text.length > 0);
          const images = [...root.querySelectorAll('img[src]')]
            .slice(0, 24)
            .map(image => ({ urlString: image.currentSrc || image.src, altText: normalize(image.alt) }))
            .filter(image => /^https?:/.test(image.urlString));
          const byline = normalize(
            document.querySelector('[rel="author"], .byline, [class*="author"]')?.textContent
          );
          const publishedDate = document.querySelector(
            'meta[property="article:published_time"], time[datetime]'
          )?.content || document.querySelector('time[datetime]')?.dateTime || '';
          const modifiedDate = document.querySelector(
            'meta[property="article:modified_time"]'
          )?.content || '';
          return {
            sourceURLString: location.href,
            title: normalize(document.title) || location.hostname,
            site: normalize(document.querySelector('meta[property="og:site_name"]')?.content) || location.hostname,
            byline,
            publishedDate,
            modifiedDate,
            blocks,
            images
          };
        })()
        """
        guard let value = try? await webView.evaluateJavaScript(script),
              let result = value as? [String: Any],
              let rawBlocks = result["blocks"] as? [[String: Any]]
        else {
            return nil
        }
        let blocks = rawBlocks.compactMap { raw -> ReaderSnapshot.Block? in
            guard let kindString = raw["kind"] as? String,
                  let kind = ReaderSnapshot.Block.Kind(rawValue: kindString),
                  let text = raw["text"] as? String,
                  !text.isEmpty
            else { return nil }
            return .init(kind: kind, text: String(text.prefix(12_000)))
        }
        guard blocks.reduce(0, { $0 + $1.text.count }) >= 120 else { return nil }
        let rawImages = result["images"] as? [[String: Any]] ?? []
        let images = rawImages.compactMap { raw -> ReaderSnapshot.Image? in
            guard let urlString = raw["urlString"] as? String else { return nil }
            return .init(
                urlString: urlString,
                altText: raw["altText"] as? String ?? ""
            )
        }
        return ReaderSnapshot(
            sourceURLString: result["sourceURLString"] as? String ?? webView.url?.absoluteString ?? "",
            title: result["title"] as? String ?? displayTitle,
            site: result["site"] as? String ?? webView.url?.host ?? "",
            byline: Self.nonEmpty(result["byline"] as? String),
            publishedDate: Self.nonEmpty(result["publishedDate"] as? String),
            modifiedDate: Self.nonEmpty(result["modifiedDate"] as? String),
            blocks: Array(blocks.prefix(400)),
            images: Array(images.prefix(24))
        )
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    private static func javaScriptString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let encoded = String(data: data, encoding: .utf8)
        else {
            return "\"\""
        }
        return encoded
    }
}

@MainActor
enum WebViewEnvironment {
    static let processPool = WKProcessPool()
    private static var persistentStores: [UUID: WKWebsiteDataStore] = [:]

    static func makeWebView(
        profile: BrowserProfile = .defaultProfile,
        isPrivate: Bool = false,
        websiteDataStore: WKWebsiteDataStore? = nil,
        webExtensionController: WKWebExtensionController? = nil
    ) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        if isPrivate {
            configuration.websiteDataStore = .nonPersistent()
        } else {
            let dataStore = websiteDataStore
                ?? persistentStores[profile.dataStoreIdentifier]
                ?? WKWebsiteDataStore(forIdentifier: profile.dataStoreIdentifier)
            persistentStores[profile.dataStoreIdentifier] = dataStore
            configuration.websiteDataStore = dataStore
            configuration.webExtensionController = webExtensionController
        }
        configuration.processPool = processPool
        if BrowserPreferences.antiFingerprinting {
            let source = """
            Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>4});
            Object.defineProperty(navigator,'deviceMemory',{get:()=>8});
            Object.defineProperty(navigator,'languages',{get:()=>['en-US','en']});
            """
            configuration.userContentController.addUserScript(
                WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false)
            )
        }

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
    private var downloadIDs: [ObjectIdentifier: UUID] = [:]
    private var downloadProgressObservations: [ObjectIdentifier: NSKeyValueObservation] = [:]

    init(tab: BrowserTab) {
        self.tab = tab
    }

    func attach(to webView: WKWebView) {
        detach()
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

    func detach() {
        observations.removeAll()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView = nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        tab?.navigationDidStart()
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
        let nsError = error as NSError
        let offlineCodes = [
            NSURLErrorNotConnectedToInternet,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorCannotFindHost,
            NSURLErrorCannotConnectToHost,
            NSURLErrorTimedOut
        ]
        if offlineCodes.contains(nsError.code),
           let url = webView.url ?? URL(string: tab?.addressText ?? "") {
            tab?.showOfflinePage(for: url, message: nsError.localizedDescription)
            return
        }
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
            tab?.onPopupRequested?(navigationAction.request)
        }

        return nil
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if BrowserPreferences.httpsOnlyMode,
           navigationAction.targetFrame?.isMainFrame != false,
           let url = navigationAction.request.url,
           url.scheme?.lowercased() == "http",
           var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            components.scheme = "https"
            if let secureURL = components.url {
                webView.load(URLRequest(url: secureURL))
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
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
        if !state.isReaderMode, let urlString = webView.url?.absoluteString {
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

extension WebViewNavigationCoordinator: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let directory = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads", isDirectory: true)
        let destination = uniqueDestination(in: directory, filename: suggestedFilename)
        let item = BrowserDownload(filename: suggestedFilename, destinationURL: destination)
        let identifier = ObjectIdentifier(download)
        downloadIDs[identifier] = item.id
        downloadProgressObservations[identifier] = download.progress.observe(
            \.fractionCompleted,
            options: [.initial, .new]
        ) { [weak self] progress, _ in
            Task { @MainActor [weak self] in
                guard let self, let id = downloadIDs[identifier] else { return }
                tab?.onDownloadUpdated?(id, .downloading, destination, progress.fractionCompleted)
            }
        }
        tab?.onDownloadStarted?(item)
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        let identifier = ObjectIdentifier(download)
        downloadProgressObservations.removeValue(forKey: identifier)
        guard let id = downloadIDs.removeValue(forKey: identifier) else { return }
        tab?.onDownloadUpdated?(id, .finished, nil, 1)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let identifier = ObjectIdentifier(download)
        downloadProgressObservations.removeValue(forKey: identifier)
        guard let id = downloadIDs.removeValue(forKey: identifier) else { return }
        tab?.onDownloadUpdated?(id, .failed(error.localizedDescription), nil, nil)
    }

    private func uniqueDestination(in directory: URL, filename: String) -> URL {
        let original = directory.appendingPathComponent(filename)
        guard FileManager.default.fileExists(atPath: original.path) else { return original }
        let stem = original.deletingPathExtension().lastPathComponent
        let ext = original.pathExtension
        for index in 2...999 {
            let name = ext.isEmpty ? "\(stem) \(index)" : "\(stem) \(index).\(ext)"
            let candidate = directory.appendingPathComponent(name)
            if !FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
        }
        return directory.appendingPathComponent("\(UUID().uuidString)-\(filename)")
    }
}
