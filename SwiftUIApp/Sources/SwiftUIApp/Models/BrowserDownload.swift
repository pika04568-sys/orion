import Foundation

struct BrowserDownload: Identifiable, Equatable, Sendable {
    enum State: Equatable, Sendable {
        case downloading
        case finished
        case failed(String)
    }

    let id: UUID
    var filename: String
    var destinationURL: URL?
    var state: State
    var startedAt: Date
    var fractionCompleted: Double

    init(
        id: UUID = UUID(),
        filename: String,
        destinationURL: URL? = nil,
        state: State = .downloading,
        startedAt: Date = Date(),
        fractionCompleted: Double = 0
    ) {
        self.id = id
        self.filename = filename
        self.destinationURL = destinationURL
        self.state = state
        self.startedAt = startedAt
        self.fractionCompleted = fractionCompleted
    }
}

struct PageSummary: Equatable, Sendable {
    var title: String
    var source: String
    var bullets: [String]
    var readingTimeMinutes: Int
}
