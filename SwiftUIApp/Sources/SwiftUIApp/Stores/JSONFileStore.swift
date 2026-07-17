import Foundation

actor JSONFileStore<Value: Codable & Sendable> {
    private let filename: String
    private let storageDirectory: URL?

    init(filename: String, storageDirectory: URL? = nil) {
        self.filename = filename
        self.storageDirectory = storageDirectory
    }

    func load(defaultValue: Value) -> Value {
        let fileURL = resolvedFileURL(createDirectory: false)
        guard let data = try? Data(contentsOf: fileURL) else {
            return defaultValue
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        return (try? decoder.decode(Value.self, from: data)) ?? defaultValue
    }

    func save(_ value: Value) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(value)
        let fileURL = resolvedFileURL(createDirectory: true)
        try data.write(to: fileURL, options: .atomic)
    }

    private func resolvedFileURL(createDirectory: Bool) -> URL {
        let fileManager = FileManager.default
        let directory: URL

        if let storageDirectory {
            directory = storageDirectory
        } else {
            let baseURL = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support", isDirectory: true)
            directory = baseURL.appendingPathComponent("Orion", isDirectory: true)
        }

        if createDirectory {
            try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }

        return directory.appendingPathComponent(filename)
    }
}
