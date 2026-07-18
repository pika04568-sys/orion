import SwiftUI

struct ExtensionsSurfaceView: View {
    let isPrivate: Bool

    var body: some View {
        ContentUnavailableView {
            Label("Extensions", systemImage: "puzzlepiece.extension")
        } description: {
            Text(
                isPrivate
                    ? "Extensions are disabled in private browsing."
                    : "Manage installed WebKit extensions in Settings."
            )
        } actions: {
            if !isPrivate {
                SettingsLink {
                    Text("Open Extension Settings")
                }
            }
        }
    }
}
