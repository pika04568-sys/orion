import AppKit
import Foundation
import OSLog
import WebKit

@MainActor
enum OrionPerformance {
    private struct Sample: Codable, Sendable {
        var shellVisibleMs: Double?
        var webViewReadyMs: Double?
        var navigationDispatchMs: Double?
        var firstContentfulPaintMs: Double?
        var loadCompleteMs: Double?
        var newTabMs: Double?
        var tabSwitchMs: Double?
        var mainThreadStallMs: Double?
    }

    private static let logger = Logger(subsystem: "com.kenokayasu.Orion", category: "performance")
    private static let processStartedAt: UInt64 = {
        let current = DispatchTime.now().uptimeNanoseconds
        guard
            let rawValue = ProcessInfo.processInfo.environment["ORION_PERF_PROCESS_STARTED_NS"],
            let externalStart = UInt64(rawValue),
            externalStart <= current,
            current - externalStart < 60_000_000_000
        else {
            return current
        }
        return externalStart
    }()
    private static var sample = Sample()
    private static var navigationStartedAt: [UUID: UInt64] = [:]
    private static var shellWasMarked = false
    private static var resultWasWritten = false
    private static var interactionProbe: (@MainActor () async -> (newTabMs: Double, tabSwitchMs: Double))?
    private static var stallTimer: Timer?
    private static var nextTimerDeadline: UInt64?
    private static var maximumMainThreadStallMs = 0.0

    static var now: UInt64 { DispatchTime.now().uptimeNanoseconds }
    static var isPerformanceRun: Bool { performanceOutputURL != nil }

    static func appDidInitialize() {
        _ = processStartedAt
        if isPerformanceRun {
            startStallMonitor()
        }
        logger.notice("launch.begin")
    }

    static func installInteractionProbe(
        _ probe: @escaping @MainActor () async -> (newTabMs: Double, tabSwitchMs: Double)
    ) {
        guard isPerformanceRun else { return }
        interactionProbe = probe
    }

    static func shellDidAppear() {
        guard !shellWasMarked else { return }
        shellWasMarked = true
        sample.shellVisibleMs = milliseconds(since: processStartedAt)
        logger.notice("launch.shell-visible milliseconds=\(sample.shellVisibleMs ?? 0, privacy: .public)")
    }

    static func webViewDidMaterialize(tabID: UUID, startedAt: UInt64) {
        let elapsed = milliseconds(since: startedAt)
        if sample.webViewReadyMs == nil {
            sample.webViewReadyMs = elapsed
        }
        logger.debug("webview.materialized tab=\(tabID.uuidString, privacy: .public) milliseconds=\(elapsed, privacy: .public)")
    }

    static func navigationWillDispatch(tabID: UUID) -> UInt64 {
        let startedAt = now
        navigationStartedAt[tabID] = startedAt
        return startedAt
    }

    static func navigationDidDispatch(tabID: UUID, startedAt: UInt64) {
        let elapsed = milliseconds(since: startedAt)
        if sample.navigationDispatchMs == nil {
            sample.navigationDispatchMs = elapsed
        }
        logger.debug("navigation.dispatched tab=\(tabID.uuidString, privacy: .public) milliseconds=\(elapsed, privacy: .public)")
    }

    static func navigationDidFinish(tabID: UUID, webView: WKWebView) {
        guard let startedAt = navigationStartedAt.removeValue(forKey: tabID) else { return }
        let loadCompleteMs = milliseconds(since: startedAt)
        sample.loadCompleteMs = loadCompleteMs
        logger.notice("navigation.finished tab=\(tabID.uuidString, privacy: .public) milliseconds=\(loadCompleteMs, privacy: .public)")

        guard performanceOutputURL != nil, !resultWasWritten else { return }
        webView.evaluateJavaScript(
            "performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null"
        ) { value, _ in
            let firstContentfulPaint = (value as? NSNumber)?.doubleValue
            Task { @MainActor in
                let interactions = await interactionProbe?() ?? (newTabMs: 0, tabSwitchMs: 0)
                completePerformanceRun(
                    firstContentfulPaintMs: firstContentfulPaint,
                    newTabMs: interactions.newTabMs,
                    tabSwitchMs: interactions.tabSwitchMs
                )
            }
        }
    }

    private static var performanceOutputURL: URL? {
        guard let path = ProcessInfo.processInfo.environment["ORION_PERF_OUTPUT"], !path.isEmpty else {
            return nil
        }
        return URL(fileURLWithPath: path)
    }

    private static func completePerformanceRun(
        firstContentfulPaintMs: Double?,
        newTabMs: Double,
        tabSwitchMs: Double
    ) {
        guard !resultWasWritten, let outputURL = performanceOutputURL else { return }
        resultWasWritten = true
        stallTimer?.invalidate()
        stallTimer = nil
        sample.firstContentfulPaintMs = firstContentfulPaintMs
        sample.newTabMs = newTabMs
        sample.tabSwitchMs = tabSwitchMs
        sample.mainThreadStallMs = maximumMainThreadStallMs

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(sample) {
            try? data.write(to: outputURL, options: .atomic)
        }

        NSApp.terminate(nil)
    }

    static func milliseconds(since start: UInt64) -> Double {
        Double(now - start) / 1_000_000
    }

    private static func startStallMonitor() {
        let interval = 10_000_000 as UInt64
        nextTimerDeadline = now + interval
        stallTimer = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { _ in
            Task { @MainActor in
                let current = now
                if let deadline = nextTimerDeadline, current > deadline {
                    maximumMainThreadStallMs = max(
                        maximumMainThreadStallMs,
                        Double(current - deadline) / 1_000_000
                    )
                }
                nextTimerDeadline = current + interval
            }
        }
    }
}
