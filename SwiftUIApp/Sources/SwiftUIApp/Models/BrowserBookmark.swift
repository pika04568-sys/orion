import Foundation

enum BookmarkDestination: String, Codable, CaseIterable, Identifiable, Sendable {
    case bar
    case newTab

    var id: String { rawValue }

    var title: String {
        switch self {
        case .bar:
            "Bookmarks Bar"
        case .newTab:
            "New Tab"
        }
    }
}

struct BrowserBookmark: Identifiable, Codable, Equatable, Sendable {
    let id: UUID
    var title: String
    var urlString: String
    var date: Date
    var destinations: Set<BookmarkDestination>

    init(
        id: UUID = UUID(),
        title: String,
        urlString: String,
        date: Date = Date(),
        destinations: Set<BookmarkDestination> = [.bar]
    ) {
        self.id = id
        self.title = title
        self.urlString = urlString
        self.date = date
        self.destinations = destinations.isEmpty ? [.bar] : destinations
    }

    var navigationEntry: NavigationEntry {
        NavigationEntry(id: id, title: title, urlString: urlString, date: date)
    }

    var displayTitle: String { navigationEntry.displayTitle }
    var host: String { navigationEntry.host }

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case urlString
        case date
        case destinations
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
        urlString = try container.decode(String.self, forKey: .urlString)
        date = try container.decodeIfPresent(Date.self, forKey: .date) ?? Date()
        let decoded = try container.decodeIfPresent(Set<BookmarkDestination>.self, forKey: .destinations)
        destinations = decoded?.isEmpty == false ? decoded! : [.bar]
    }
}
