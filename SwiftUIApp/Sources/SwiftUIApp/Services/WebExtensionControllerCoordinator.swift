import AppKit
import WebKit

@MainActor
final class WebExtensionControllerCoordinator: NSObject, WKWebExtensionControllerDelegate {
    weak var runtime: ExtensionRuntime?

    private let windows = NSHashTable<WebExtensionWindowAdapter>.weakObjects()

    func register(_ window: WebExtensionWindowAdapter) {
        windows.add(window)
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        openWindowsFor extensionContext: WKWebExtensionContext
    ) -> [any WKWebExtensionWindow] {
        windows.allObjects
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        focusedWindowFor extensionContext: WKWebExtensionContext
    ) -> (any WKWebExtensionWindow)? {
        windows.allObjects.first
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        openNewTabUsing configuration: WKWebExtension.TabConfiguration,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping ((any WKWebExtensionTab)?, (any Error)?) -> Void
    ) {
        let requestedWindow = configuration.window as? WebExtensionWindowAdapter
        guard let window = requestedWindow ?? windows.allObjects.first,
              let browser = window.browser
        else {
            completionHandler(nil, extensionError("No browser window is available."))
            return
        }
        let created = browser.openExtensionRequestedTab(
            url: configuration.url,
            context: extensionContext,
            activate: configuration.shouldBeActive
        )
        completionHandler(created, created == nil ? extensionError("The tab could not be opened.") : nil)
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        openNewWindowUsing configuration: WKWebExtension.WindowConfiguration,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping ((any WKWebExtensionWindow)?, (any Error)?) -> Void
    ) {
        guard !configuration.shouldBePrivate,
              let browser = windows.allObjects.first?.browser
        else {
            completionHandler(
                nil,
                extensionError("Extensions are unavailable in private browsing.")
            )
            return
        }
        browser.onOpenWindow?(
            .extensionWindow(
                profileID: browser.profile.id,
                extensionID: extensionContext.uniqueIdentifier,
                initialURL: configuration.tabURLs.first?.absoluteString
            )
        )
        completionHandler(nil, nil)
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        openOptionsPageFor extensionContext: WKWebExtensionContext,
        completionHandler: @escaping ((any Error)?) -> Void
    ) {
        guard let browser = windows.allObjects.first?.browser,
              let url = extensionContext.optionsPageURL,
              browser.openExtensionPage(url, context: extensionContext) != nil
        else {
            completionHandler(extensionError("This extension has no available options page."))
            return
        }
        completionHandler(nil)
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        didUpdate action: WKWebExtension.Action,
        forExtensionContext context: WKWebExtensionContext
    ) {
        runtime?.actionDidUpdate()
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        promptForPermissions permissions: Set<WKWebExtension.Permission>,
        in tab: (any WKWebExtensionTab)?,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping (
            Set<WKWebExtension.Permission>,
            Date?
        ) -> Void
    ) {
        let extensionName = extensionContext.webExtension.displayName
            ?? extensionContext.uniqueIdentifier
        let allowed = confirmPermissions(
            title: String(
                format: NSLocalizedString("%@ Requests Permissions", comment: ""),
                extensionName
            ),
            details: permissions.map(\.rawValue).sorted()
        )
        let granted = allowed ? permissions : []
        runtime?.rememberPermissionDecision(
            requested: permissions,
            allowed: granted,
            context: extensionContext
        )
        completionHandler(granted, nil)
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        promptForPermissionToAccess urls: Set<URL>,
        in tab: (any WKWebExtensionTab)?,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping (Set<URL>, Date?) -> Void
    ) {
        let extensionName = extensionContext.webExtension.displayName
            ?? extensionContext.uniqueIdentifier
        let allowed = confirmPermissions(
            title: String(
                format: NSLocalizedString("%@ Requests Site Access", comment: ""),
                extensionName
            ),
            details: urls.map(\.absoluteString).sorted()
        )
        let granted = allowed ? urls : []
        runtime?.rememberHostDecision(
            requested: urls,
            allowed: granted,
            context: extensionContext
        )
        completionHandler(granted, nil)
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        promptForPermissionMatchPatterns matchPatterns: Set<WKWebExtension.MatchPattern>,
        in tab: (any WKWebExtensionTab)?,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping (
            Set<WKWebExtension.MatchPattern>,
            Date?
        ) -> Void
    ) {
        let extensionName = extensionContext.webExtension.displayName
            ?? extensionContext.uniqueIdentifier
        let allowed = confirmPermissions(
            title: String(
                format: NSLocalizedString("%@ Requests Site Access", comment: ""),
                extensionName
            ),
            details: matchPatterns.map(\.string).sorted()
        )
        let granted = allowed ? matchPatterns : []
        runtime?.rememberMatchPatternDecision(
            requested: matchPatterns,
            allowed: granted,
            context: extensionContext
        )
        completionHandler(granted, nil)
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        presentActionPopup action: WKWebExtension.Action,
        for context: WKWebExtensionContext,
        completionHandler: @escaping ((any Error)?) -> Void
    ) {
        guard let popover = action.popupPopover,
              let contentView = NSApp.keyWindow?.contentView
        else {
            completionHandler(extensionError("The extension popup is unavailable."))
            return
        }
        let anchor = NSRect(
            x: contentView.bounds.maxX - 44,
            y: contentView.bounds.maxY - 44,
            width: 1,
            height: 1
        )
        popover.show(relativeTo: anchor, of: contentView, preferredEdge: .maxY)
        completionHandler(nil)
    }

    private func extensionError(_ message: String) -> NSError {
        NSError(
            domain: "Orion.WebExtension",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }

    private func confirmPermissions(title: String, details: [String]) -> Bool {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = details.isEmpty
            ? NSLocalizedString(
                "The extension is requesting additional access.",
                comment: ""
            )
            : details.joined(separator: "\n")
        alert.alertStyle = .warning
        alert.addButton(withTitle: NSLocalizedString("Allow", comment: ""))
        alert.addButton(withTitle: NSLocalizedString("Deny", comment: ""))
        return alert.runModal() == .alertFirstButtonReturn
    }
}
