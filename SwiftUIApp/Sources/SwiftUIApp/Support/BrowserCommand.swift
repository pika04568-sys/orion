import Foundation

enum BrowserCommand: String {
    case newTab
    case closeTab
    case goBack
    case goForward
    case reload
    case showHistory
    case showBookmarks
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
