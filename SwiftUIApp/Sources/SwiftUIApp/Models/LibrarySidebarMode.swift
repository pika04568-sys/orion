import Foundation

enum LibrarySidebarMode: String, CaseIterable, Identifiable {
    case history
    case bookmarks
    case downloads
    case summary

    var id: String { rawValue }

    var title: String {
        switch self {
        case .history:
            "History"
        case .bookmarks:
            "Bookmarks"
        case .downloads:
            "Downloads"
        case .summary:
            "Page Summary"
        }
    }

    var systemImage: String {
        switch self {
        case .history:
            "clock.arrow.circlepath"
        case .bookmarks:
            "star"
        case .downloads:
            "arrow.down.circle"
        case .summary:
            "sparkles"
        }
    }
}
