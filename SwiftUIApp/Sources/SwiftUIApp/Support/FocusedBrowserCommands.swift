import SwiftUI

struct BrowserCommandActions {
    var newTab: () -> Void
    var newPrivateWindow: () -> Void
    var closeTab: () -> Void
    var reopenClosedTab: () -> Void
    var goBack: () -> Void
    var goForward: () -> Void
    var reload: () -> Void
    var hardReload: () -> Void
    var nextTab: () -> Void
    var previousTab: () -> Void
    var focusAddress: () -> Void
    var selectNumberedTab: (Int) -> Void
    var showFind: () -> Void
    var showHistory: () -> Void
    var showBookmarks: () -> Void
    var showDownloads: () -> Void
    var toggleReader: () -> Void
    var bookmarkPage: () -> Void
}

extension Notification.Name {
    static let orionFocusAddress = Notification.Name("orion.focusAddress")
}

private struct BrowserCommandActionsKey: FocusedValueKey {
    typealias Value = BrowserCommandActions
}

extension FocusedValues {
    var browserCommandActions: BrowserCommandActions? {
        get { self[BrowserCommandActionsKey.self] }
        set { self[BrowserCommandActionsKey.self] = newValue }
    }
}
