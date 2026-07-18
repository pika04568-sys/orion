import AppKit
import Combine
import Foundation
import WebKit

@MainActor
final class ExtensionRuntime: ObservableObject {
    @Published private(set) var records: [ExtensionRecord] = []
    @Published private(set) var managedState: ManagedExtensionState = .idle
    @Published private(set) var lastError: String?
    @Published private(set) var isUpdating = false
    @Published private(set) var lastUpdateMessage: String?

    let profile: BrowserProfile
    let controller: WKWebExtensionController

    private let rootDirectory: URL
    private let recordStore: JSONFileStore<[ExtensionRecord]>
    private var contexts: [String: WKWebExtensionContext] = [:]
    private var didLoad = false
    private var managedUpdateTask: Task<Void, Never>?

    init(
        profile: BrowserProfile,
        controller: WKWebExtensionController,
        rootDirectory: URL
    ) {
        self.profile = profile
        self.controller = controller
        self.rootDirectory = rootDirectory
        recordStore = JSONFileStore(
            filename: "extensions.json",
            storageDirectory: rootDirectory
        )
    }

    func load() async {
        guard !didLoad else { return }
        didLoad = true
        await loadBuiltInPrivacyExtension()
        records = await recordStore.load(defaultValue: [])
        for record in records where record.isEnabled {
            do {
                try await loadRecord(record)
            } catch {
                lastError = "\(record.name): \(error.localizedDescription)"
            }
        }
        await prepareManagedProtection()
    }

    private func loadBuiltInPrivacyExtension() async {
        guard BrowserPreferences.antiFingerprinting,
              contexts["orion-built-in-privacy"] == nil,
              let resourceRoot = Bundle.module.resourceURL
        else { return }
        // SwiftPM flattens processed non-localized resources into the target bundle.
        let directory = resourceRoot
        guard FileManager.default.fileExists(
            atPath: directory.appendingPathComponent("manifest.json").path
        ) else { return }
        do {
            let extensionObject = try await WKWebExtension(resourceBaseURL: directory)
            let context = WKWebExtensionContext(for: extensionObject)
            context.uniqueIdentifier = "orion-built-in-privacy"
            try controller.load(context)
            contexts["orion-built-in-privacy"] = context
        } catch {
            lastError = "Built-in privacy protection: \(error.localizedDescription)"
        }
    }

    @discardableResult
    func install(
        from sourceURL: URL,
        source: ExtensionRecord.Source = .unpacked,
        forcedID: String? = nil
    ) async throws -> ExtensionRecord {
        let directory = try await prepareDirectory(from: sourceURL)
        defer { removeStagingDirectory(containing: directory) }
        let manifest = try ExtensionManifestInspector.inspect(directory: directory)
        let id = forcedID ?? sanitizedID(directory.lastPathComponent)
        let destination = packageDirectory.appendingPathComponent(id, isDirectory: true)
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: packageDirectory, withIntermediateDirectories: true)
        if directory.standardizedFileURL != destination.standardizedFileURL {
            if let existingContext = contexts.removeValue(forKey: id) {
                try controller.unload(existingContext)
            }
            if fileManager.fileExists(atPath: destination.path) {
                try fileManager.removeItem(at: destination)
            }
            try fileManager.copyItem(at: directory, to: destination)
        }

        let record = ExtensionRecord(
            id: id,
            name: manifest.name,
            version: manifest.version,
            source: source,
            rootPath: destination.path,
            permissions: (manifest.permissions + manifest.hostPermissions).sorted(),
            isEnabled: records.first(where: { $0.id == id })?.isEnabled ?? true,
            isPinned: records.first(where: { $0.id == id })?.isPinned
                ?? (source == .managed),
            installedAt: records.first(where: { $0.id == id })?.installedAt ?? Date(),
            grantedPermissions: records.first(where: { $0.id == id })?.grantedPermissions ?? [],
            deniedPermissions: records.first(where: { $0.id == id })?.deniedPermissions ?? [],
            grantedHosts: records.first(where: { $0.id == id })?.grantedHosts ?? [],
            deniedHosts: records.first(where: { $0.id == id })?.deniedHosts ?? [],
            grantedMatchPatterns: records.first(where: { $0.id == id })?.grantedMatchPatterns ?? [],
            deniedMatchPatterns: records.first(where: { $0.id == id })?.deniedMatchPatterns ?? []
        )
        try await loadRecord(record)
        records.removeAll { $0.id == id }
        records.append(record)
        try await recordStore.save(records)
        return record
    }

    func inspect(sourceURL: URL) async throws -> InspectedExtensionManifest {
        let directory = try await prepareDirectory(from: sourceURL)
        defer { removeStagingDirectory(containing: directory) }
        return try ExtensionManifestInspector.inspect(directory: directory)
    }

    func setEnabled(_ enabled: Bool, for id: String) async {
        guard let index = records.firstIndex(where: { $0.id == id }) else { return }
        if id == ManagedExtensionState.uBlockOriginLiteID, !enabled {
            lastError = "uBlock Origin Lite is managed by Orion and cannot be disabled."
            return
        }
        records[index].isEnabled = enabled
        do {
            if enabled {
                try await loadRecord(records[index])
            } else if let context = contexts.removeValue(forKey: id) {
                try controller.unload(context)
            }
            try await recordStore.save(records)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func setPinned(_ pinned: Bool, for id: String) async {
        guard let index = records.firstIndex(where: { $0.id == id }) else { return }
        records[index].isPinned = pinned
        try? await recordStore.save(records)
    }

    func remove(_ id: String) async {
        guard id != ManagedExtensionState.uBlockOriginLiteID else {
            lastError = "uBlock Origin Lite is managed by Orion and cannot be removed."
            return
        }
        if let context = contexts.removeValue(forKey: id) {
            try? controller.unload(context)
        }
        guard let record = records.first(where: { $0.id == id }) else { return }
        records.removeAll { $0.id == id }
        try? FileManager.default.removeItem(atPath: record.rootPath)
        try? await recordStore.save(records)
    }

    func clearError() {
        lastError = nil
    }

    func shutdown() {
        managedUpdateTask?.cancel()
        managedUpdateTask = nil
        for context in contexts.values {
            try? controller.unload(context)
        }
        contexts.removeAll()
    }

    func report(_ error: Error) {
        lastError = error.localizedDescription
    }

    @discardableResult
    func installFromChromeWebStore(id proposedID: String) async throws -> ExtensionRecord {
        let id = proposedID.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard ChromeWebStoreResolver.isExtensionID(id) else {
            throw URLError(.badURL)
        }
        var components = URLComponents(
            string: "https://clients2.google.com/service/update2/crx"
        )!
        components.queryItems = [
            URLQueryItem(name: "response", value: "redirect"),
            URLQueryItem(name: "prodversion", value: "131.0.0.0"),
            URLQueryItem(name: "acceptformat", value: "crx2,crx3"),
            URLQueryItem(name: "x", value: "id=\(id)&uc")
        ]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode),
              data.count < 250 * 1_024 * 1_024
        else {
            throw URLError(.badServerResponse)
        }
        let staging = rootDirectory
            .appendingPathComponent("Staging", isDirectory: true)
            .appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(
            at: staging,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: staging) }
        let archiveURL = staging.appendingPathComponent("\(id).crx")
        try data.write(to: archiveURL, options: .atomic)
        return try await install(
            from: archiveURL,
            source: id == ManagedExtensionState.uBlockOriginLiteID ? .managed : .chromeWebStore,
            forcedID: id
        )
    }

    func retryManagedProtection() async {
        await prepareManagedProtection()
    }

    func updateExtensions() async {
        guard !isUpdating else { return }
        isUpdating = true
        lastUpdateMessage = nil
        defer { isUpdating = false }

        let candidates = records.filter { $0.source != .unpacked }
        var failures: [String] = []
        for record in candidates {
            do {
                let updated = try await installFromChromeWebStore(id: record.id)
                if updated.id == ManagedExtensionState.uBlockOriginLiteID {
                    managedState = .ready(version: updated.version)
                }
            } catch {
                failures.append("\(record.name): \(error.localizedDescription)")
            }
        }

        if failures.isEmpty {
            lastError = nil
            lastUpdateMessage = candidates.isEmpty
                ? "No Web Store extensions require updates."
                : "Extension update check complete."
        } else {
            let message = failures.joined(separator: "\n")
            lastError = message
            lastUpdateMessage = nil
        }
    }

    func context(for id: String) -> WKWebExtensionContext? {
        contexts[id]
    }

    func unsupportedAPIs(for record: ExtensionRecord) -> [String] {
        guard let manifest = try? ExtensionManifestInspector.inspect(
            directory: URL(fileURLWithPath: record.rootPath, isDirectory: true)
        ) else {
            return []
        }
        return manifest.unsupportedAPIs
    }

    func openOptions(for id: String, in browser: BrowserState) {
        guard let context = contexts[id],
              let url = context.optionsPageURL
        else {
            lastError = "This extension does not provide an options page."
            return
        }
        browser.openExtensionPage(url, context: context)
    }

    func performAction(for id: String, tab: WebExtensionTabAdapter?) {
        guard let context = contexts[id] else {
            lastError = "The extension is not loaded."
            return
        }
        context.performAction(for: tab)
    }

    func actionIcon(
        for id: String,
        tab: WebExtensionTabAdapter?,
        size: CGSize
    ) -> NSImage? {
        contexts[id]?.action(for: tab)?.icon(for: size)
    }

    func actionLabel(for record: ExtensionRecord, tab: WebExtensionTabAdapter?) -> String {
        contexts[record.id]?.action(for: tab)?.label ?? record.name
    }

    func actionBadge(for id: String, tab: WebExtensionTabAdapter?) -> String {
        contexts[id]?.action(for: tab)?.badgeText ?? ""
    }

    func isActionEnabled(for id: String, tab: WebExtensionTabAdapter?) -> Bool {
        contexts[id]?.action(for: tab)?.isEnabled ?? false
    }

    func presentMenu(for id: String, tab: WebExtensionTabAdapter?) {
        guard let context = contexts[id],
              let tab,
              let contentView = NSApp.keyWindow?.contentView
        else {
            return
        }
        let actionItems = context.action(for: tab)?.menuItems ?? []
        let pageItems = context.menuItems(for: tab)
        let menu = NSMenu()
        for item in actionItems + pageItems {
            menu.addItem(item)
        }
        guard !menu.items.isEmpty else {
            lastError = "This extension has no context menu items for the active tab."
            return
        }
        menu.popUp(
            positioning: nil,
            at: NSPoint(x: contentView.bounds.maxX - 54, y: contentView.bounds.maxY - 62),
            in: contentView
        )
    }

    func pageMenuItems(for tab: WebExtensionTabAdapter) -> [NSMenuItem] {
        records
            .filter(\.isEnabled)
            .compactMap { contexts[$0.id] }
            .flatMap { $0.menuItems(for: tab) }
    }

    func actionDidUpdate() {
        objectWillChange.send()
    }

    func rememberPermissionDecision(
        requested: Set<WKWebExtension.Permission>,
        allowed: Set<WKWebExtension.Permission>,
        context: WKWebExtensionContext
    ) {
        guard let index = records.firstIndex(where: {
            $0.id == context.uniqueIdentifier
        }) else {
            return
        }
        let requestedValues = Set(requested.map(\.rawValue))
        let allowedValues = Set(allowed.map(\.rawValue))
        var granted = Set(records[index].grantedPermissions)
        var denied = Set(records[index].deniedPermissions)
        granted.subtract(requestedValues)
        denied.subtract(requestedValues)
        granted.formUnion(allowedValues)
        denied.formUnion(requestedValues.subtracting(allowedValues))
        records[index].grantedPermissions = granted.sorted()
        records[index].deniedPermissions = denied.sorted()
        let snapshot = records
        Task { try? await recordStore.save(snapshot) }
    }

    func rememberHostDecision(
        requested: Set<URL>,
        allowed: Set<URL>,
        context: WKWebExtensionContext
    ) {
        guard let index = records.firstIndex(where: {
            $0.id == context.uniqueIdentifier
        }) else {
            return
        }
        let requestedValues = Set(requested.map(\.absoluteString))
        let allowedValues = Set(allowed.map(\.absoluteString))
        var granted = Set(records[index].grantedHosts)
        var denied = Set(records[index].deniedHosts)
        granted.subtract(requestedValues)
        denied.subtract(requestedValues)
        granted.formUnion(allowedValues)
        denied.formUnion(requestedValues.subtracting(allowedValues))
        records[index].grantedHosts = granted.sorted()
        records[index].deniedHosts = denied.sorted()
        let snapshot = records
        Task { try? await recordStore.save(snapshot) }
    }

    func rememberMatchPatternDecision(
        requested: Set<WKWebExtension.MatchPattern>,
        allowed: Set<WKWebExtension.MatchPattern>,
        context: WKWebExtensionContext
    ) {
        guard let index = records.firstIndex(where: {
            $0.id == context.uniqueIdentifier
        }) else {
            return
        }
        let requestedValues = Set(requested.map(\.string))
        let allowedValues = Set(allowed.map(\.string))
        var granted = Set(records[index].grantedMatchPatterns)
        var denied = Set(records[index].deniedMatchPatterns)
        granted.subtract(requestedValues)
        denied.subtract(requestedValues)
        granted.formUnion(allowedValues)
        denied.formUnion(requestedValues.subtracting(allowedValues))
        records[index].grantedMatchPatterns = granted.sorted()
        records[index].deniedMatchPatterns = denied.sorted()
        let snapshot = records
        Task { try? await recordStore.save(snapshot) }
    }

    private var packageDirectory: URL {
        rootDirectory.appendingPathComponent("Packages", isDirectory: true)
    }

    private var stagingDirectory: URL {
        rootDirectory.appendingPathComponent("Staging", isDirectory: true)
    }

    private func removeStagingDirectory(containing preparedDirectory: URL) {
        let root = stagingDirectory.standardizedFileURL
        let prepared = preparedDirectory.standardizedFileURL
        guard prepared.path.hasPrefix(root.path + "/") else { return }
        let relativePath = String(prepared.path.dropFirst(root.path.count + 1))
        guard let firstComponent = relativePath.split(separator: "/").first else {
            return
        }
        try? FileManager.default.removeItem(
            at: root.appendingPathComponent(String(firstComponent), isDirectory: true)
        )
    }

    private func loadRecord(_ record: ExtensionRecord) async throws {
        guard contexts[record.id] == nil else { return }
        let extensionObject = try await WKWebExtension(
            resourceBaseURL: URL(fileURLWithPath: record.rootPath, isDirectory: true)
        )
        let context = WKWebExtensionContext(for: extensionObject)
        context.uniqueIdentifier = record.id
        for rawValue in record.grantedPermissions {
            context.setPermissionStatus(
                .grantedExplicitly,
                for: WKWebExtension.Permission(rawValue: rawValue)
            )
        }
        for rawValue in record.deniedPermissions {
            context.setPermissionStatus(
                .deniedExplicitly,
                for: WKWebExtension.Permission(rawValue: rawValue)
            )
        }
        for value in record.grantedHosts {
            if let url = URL(string: value) {
                context.setPermissionStatus(.grantedExplicitly, for: url)
            }
        }
        for value in record.deniedHosts {
            if let url = URL(string: value) {
                context.setPermissionStatus(.deniedExplicitly, for: url)
            }
        }
        for value in record.grantedMatchPatterns {
            if let pattern = try? WKWebExtension.MatchPattern(string: value) {
                context.setPermissionStatus(.grantedExplicitly, for: pattern)
            }
        }
        for value in record.deniedMatchPatterns {
            if let pattern = try? WKWebExtension.MatchPattern(string: value) {
                context.setPermissionStatus(.deniedExplicitly, for: pattern)
            }
        }
        if let manifest = try? ExtensionManifestInspector.inspect(
            directory: URL(fileURLWithPath: record.rootPath, isDirectory: true)
        ) {
            context.unsupportedAPIs = Set(
                manifest.unsupportedAPIs.map { "browser.\($0)" }
            )
        }
        try controller.load(context)
        contexts[record.id] = context
    }

    private func prepareManagedProtection() async {
        let id = ManagedExtensionState.uBlockOriginLiteID
        if let cached = records.first(where: { $0.id == id }) {
            do {
                try await loadRecord(cached)
                managedState = .ready(version: cached.version)
                scheduleManagedProtectionUpdate()
            } catch {
                managedState = .failed(message: error.localizedDescription)
            }
            return
        }
        managedState = .installing
        do {
            let installed = try await installFromChromeWebStore(id: id)
            managedState = .ready(version: installed.version)
        } catch {
            managedState = .failed(message: error.localizedDescription)
        }
    }

    private func scheduleManagedProtectionUpdate() {
        managedUpdateTask?.cancel()
        managedUpdateTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard let self, !Task.isCancelled else { return }
            do {
                let updated = try await installFromChromeWebStore(
                    id: ManagedExtensionState.uBlockOriginLiteID
                )
                managedState = .ready(version: updated.version)
            } catch {
                // The verified cached copy stays active when an update is unavailable.
            }
        }
    }

    private func prepareDirectory(from sourceURL: URL) async throws -> URL {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(
            atPath: sourceURL.path,
            isDirectory: &isDirectory
        ) else {
            throw CocoaError(.fileNoSuchFile)
        }
        if isDirectory.boolValue {
            return sourceURL
        }
        let ext = sourceURL.pathExtension.lowercased()
        guard ["zip", "crx"].contains(ext) else {
            throw CocoaError(.fileReadUnsupportedScheme)
        }
        let staging = stagingDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        let archiveURL: URL
        if ext == "crx" {
            let data = try Data(contentsOf: sourceURL)
            guard let zipOffset = zipArchiveOffset(in: data) else {
                throw ExtensionInspectionError.invalidManifest
            }
            archiveURL = staging.appendingPathComponent("extension.zip")
            try data[zipOffset...].write(to: archiveURL, options: .atomic)
        } else {
            archiveURL = sourceURL
        }
        let destination = staging.appendingPathComponent("Expanded", isDirectory: true)
        try await Task.detached {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            process.arguments = ["-x", "-k", archiveURL.path, destination.path]
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                throw CocoaError(.fileReadCorruptFile)
            }
        }.value
        return try extensionRoot(in: destination)
    }

    private func zipArchiveOffset(in data: Data) -> Data.Index? {
        guard data.count >= 4 else { return nil }
        let signature: [UInt8] = [0x50, 0x4b, 0x03, 0x04]
        return data.indices.dropLast(3).first { index in
            Array(data[index..<(index + 4)]) == signature
        }
    }

    private func extensionRoot(in directory: URL) throws -> URL {
        if FileManager.default.fileExists(
            atPath: directory.appendingPathComponent("manifest.json").path
        ) {
            return directory
        }
        let children = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )
        guard children.count == 1,
              FileManager.default.fileExists(
                atPath: children[0].appendingPathComponent("manifest.json").path
              )
        else {
            throw ExtensionInspectionError.missingManifest
        }
        return children[0]
    }

    private func sanitizedID(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let components = value.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "-" }
        let result = String(components).lowercased()
        return result.isEmpty ? UUID().uuidString.lowercased() : result
    }
}
