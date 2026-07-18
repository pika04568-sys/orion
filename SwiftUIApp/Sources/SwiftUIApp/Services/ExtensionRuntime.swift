import Combine
import Foundation
import WebKit

@MainActor
final class ExtensionRuntime: ObservableObject {
    @Published private(set) var records: [ExtensionRecord] = []
    @Published private(set) var managedState: ManagedExtensionState = .idle
    @Published private(set) var lastError: String?

    let profile: BrowserProfile
    let controller: WKWebExtensionController

    private let rootDirectory: URL
    private let recordStore: JSONFileStore<[ExtensionRecord]>
    private var contexts: [String: WKWebExtensionContext] = [:]

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

    @discardableResult
    func install(
        from sourceURL: URL,
        source: ExtensionRecord.Source = .unpacked,
        forcedID: String? = nil
    ) async throws -> ExtensionRecord {
        let directory = try prepareDirectory(from: sourceURL)
        let manifest = try ExtensionManifestInspector.inspect(directory: directory)
        let id = forcedID ?? sanitizedID(directory.lastPathComponent)
        let destination = packageDirectory.appendingPathComponent(id, isDirectory: true)
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: packageDirectory, withIntermediateDirectories: true)
        if directory.standardizedFileURL != destination.standardizedFileURL {
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
            isEnabled: true,
            isPinned: source == .managed,
            installedAt: Date()
        )
        try await loadRecord(record)
        records.removeAll { $0.id == id }
        records.append(record)
        try await recordStore.save(records)
        return record
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

    private var packageDirectory: URL {
        rootDirectory.appendingPathComponent("Packages", isDirectory: true)
    }

    private func loadRecord(_ record: ExtensionRecord) async throws {
        guard contexts[record.id] == nil else { return }
        let extensionObject = try await WKWebExtension(
            resourceBaseURL: URL(fileURLWithPath: record.rootPath, isDirectory: true)
        )
        let context = WKWebExtensionContext(for: extensionObject)
        context.uniqueIdentifier = record.id
        try controller.load(context)
        contexts[record.id] = context
    }

    private func prepareManagedProtection() async {
        let id = ManagedExtensionState.uBlockOriginLiteID
        if let cached = records.first(where: { $0.id == id }) {
            do {
                try await loadRecord(cached)
                managedState = .ready(version: cached.version)
            } catch {
                managedState = .failed(message: error.localizedDescription)
            }
            return
        }
        managedState = .failed(
            message: "Managed protection is not cached. Use Check for Extension Updates while online."
        )
    }

    private func prepareDirectory(from sourceURL: URL) throws -> URL {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(
            atPath: sourceURL.path,
            isDirectory: &isDirectory
        ) else {
            throw CocoaError(.fileNoSuchFile)
        }
        guard isDirectory.boolValue else {
            throw CocoaError(.fileReadUnsupportedScheme)
        }
        return sourceURL
    }

    private func sanitizedID(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let components = value.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "-" }
        let result = String(components).lowercased()
        return result.isEmpty ? UUID().uuidString.lowercased() : result
    }
}
