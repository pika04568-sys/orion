import Foundation

struct BrowserTabSnapshot: Identifiable, Codable, Equatable, Sendable {
    let id: UUID
    var title: String
    var urlString: String
    var groupID: UUID?
    var readerSourceURLString: String?
    var isReaderMode: Bool
    var isUnloaded: Bool
}

struct BrowserSessionSnapshot: Codable, Equatable, Sendable {
    static let empty = BrowserSessionSnapshot(
        tabs: [],
        groups: [],
        activeTabID: nil,
        recentlyClosed: []
    )

    var tabs: [BrowserTabSnapshot]
    var groups: [TabGroup]
    var activeTabID: UUID?
    var recentlyClosed: [BrowserTabSnapshot]
}
