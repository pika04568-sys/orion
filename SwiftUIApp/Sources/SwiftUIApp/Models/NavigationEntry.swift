import Foundation

struct NavigationEntry: Identifiable, Codable, Equatable {
    let id: UUID
    var title: String
    var urlString: String
    var date: Date

    init(id: UUID = UUID(), title: String, urlString: String, date: Date = Date()) {
        self.id = id
        self.title = title
        self.urlString = urlString
        self.date = date
    }

    var displayTitle: String {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedTitle.isEmpty {
            return trimmedTitle
        }

        return host
    }

    var host: String {
        URL(string: urlString)?.host ?? urlString
    }
}
