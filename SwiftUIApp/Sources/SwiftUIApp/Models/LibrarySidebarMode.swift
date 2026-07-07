import Foundation

enum LibrarySidebarMode: String, CaseIterable, Identifiable {
    case history
    case bookmarks

    var id: String { rawValue }

    var title: String {
        switch self {
        case .history:
            "History"
        case .bookmarks:
            "Bookmarks"
        }
    }

    var systemImage: String {
        switch self {
        case .history:
            "clock.arrow.circlepath"
        case .bookmarks:
            "star"
        }
    }
}
