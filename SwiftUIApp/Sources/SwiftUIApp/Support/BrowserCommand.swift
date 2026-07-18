import Foundation

enum BrowserCommand: String {
    case newTab
    case closeTab
    case goBack
    case goForward
    case reload
    case hardReload
    case reopenClosedTab
    case nextTab
    case previousTab
    case showFind
    case showHistory
    case showBookmarks
    case showDownloads
    case toggleReader
    case bookmarkPage
}

enum BrowserCommandCenter {
    static let notification = Notification.Name("OrionBrowserCommand")

    static func post(_ command: BrowserCommand) {
        NotificationCenter.default.post(name: notification, object: command.rawValue)
    }

    static func command(from notification: Notification) -> BrowserCommand? {
        guard let rawValue = notification.object as? String else { return nil }
        return BrowserCommand(rawValue: rawValue)
    }
}
