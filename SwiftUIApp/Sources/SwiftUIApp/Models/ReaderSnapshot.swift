import Foundation

struct ReaderSnapshot: Codable, Equatable, Sendable {
    struct Block: Identifiable, Codable, Equatable, Sendable {
        enum Kind: String, Codable, Sendable {
            case heading
            case paragraph
            case quote
            case listItem
        }

        let id: UUID
        var kind: Kind
        var text: String

        init(id: UUID = UUID(), kind: Kind, text: String) {
            self.id = id
            self.kind = kind
            self.text = text
        }
    }

    struct Image: Identifiable, Codable, Equatable, Sendable {
        let id: UUID
        var urlString: String
        var altText: String

        init(id: UUID = UUID(), urlString: String, altText: String = "") {
            self.id = id
            self.urlString = urlString
            self.altText = altText
        }
    }

    var sourceURLString: String
    var title: String
    var site: String
    var byline: String?
    var publishedDate: String?
    var modifiedDate: String?
    var blocks: [Block]
    var images: [Image]

    var plainText: String {
        blocks.map(\.text).joined(separator: "\n\n")
    }
}

enum ReaderTheme: String, CaseIterable, Identifiable {
    case light
    case sepia
    case night

    var id: String { rawValue }

    var title: String {
        rawValue.capitalized
    }
}

struct OfflineGameRotation: Sendable {
    private(set) var previous: OfflineGame?

    mutating func next(using randomIndex: (Int) -> Int = { Int.random(in: 0..<$0) }) -> OfflineGame {
        let candidates = OfflineGame.allCases.filter { $0 != previous }
        let selected = candidates[max(0, min(candidates.count - 1, randomIndex(candidates.count)))]
        previous = selected
        return selected
    }
}
