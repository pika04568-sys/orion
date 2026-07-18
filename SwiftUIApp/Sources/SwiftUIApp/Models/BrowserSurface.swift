import Foundation

enum OfflineGame: String, Codable, CaseIterable, Sendable {
    case snake
    case tetris
    case pacman

    var title: String {
        switch self {
        case .snake:
            "Snake"
        case .tetris:
            "Tetris"
        case .pacman:
            "Pac-Man"
        }
    }
}

enum BrowserSurface: Codable, Equatable, Sendable {
    case newTab
    case web
    case reader
    case offline(targetURLString: String, game: OfflineGame)
    case extensions

    var displayURLString: String {
        switch self {
        case .newTab:
            "chrome://newtab"
        case .web:
            ""
        case .reader:
            "chrome://reader"
        case .offline:
            "chrome://offline"
        case .extensions:
            "chrome://extensions"
        }
    }
}
