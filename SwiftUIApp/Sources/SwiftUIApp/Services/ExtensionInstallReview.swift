import AppKit

@MainActor
enum ExtensionInstallReview {
    static func confirm(_ manifest: InspectedExtensionManifest) -> Bool {
        let alert = NSAlert()
        alert.messageText = String(
            format: NSLocalizedString("Install %@?", comment: ""),
            manifest.name
        )
        let requested = (manifest.permissions + manifest.hostPermissions).sorted()
        var sections = [
            String(
                format: NSLocalizedString("Version: %@", comment: ""),
                manifest.version
            )
        ]
        if !requested.isEmpty {
            sections.append(
                NSLocalizedString("Requested Permissions", comment: "")
                    + ":\n"
                    + requested.joined(separator: "\n")
            )
        }
        if !manifest.unsupportedAPIs.isEmpty {
            sections.append(
                NSLocalizedString("Unsupported WebKit APIs", comment: "")
                    + ":\n"
                    + manifest.unsupportedAPIs.joined(separator: "\n")
            )
        }
        alert.informativeText = sections.joined(separator: "\n\n")
        alert.alertStyle = manifest.unsupportedAPIs.isEmpty ? .informational : .warning
        alert.addButton(withTitle: NSLocalizedString("Install", comment: ""))
        alert.addButton(withTitle: NSLocalizedString("Cancel", comment: ""))
        return alert.runModal() == .alertFirstButtonReturn
    }
}
