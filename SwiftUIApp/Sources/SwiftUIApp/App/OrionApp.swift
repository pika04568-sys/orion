import SwiftUI

@main
struct OrionApp: App {
    var body: some Scene {
        WindowGroup("Orion", id: "browser") {
            BrowserRootView()
        }
        .windowResizability(.contentMinSize)
        .commands {
            BrowserCommands()
        }

        Settings {
            SettingsView()
        }
    }
}

private struct BrowserCommands: Commands {
    var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("New Tab") {
                BrowserCommandCenter.post(.newTab)
            }
            .keyboardShortcut("t")

            Button("Close Tab") {
                BrowserCommandCenter.post(.closeTab)
            }
            .keyboardShortcut("w")
        }

        CommandMenu("Browser") {
            Button("Go Back") {
                BrowserCommandCenter.post(.goBack)
            }
            .keyboardShortcut("[")

            Button("Go Forward") {
                BrowserCommandCenter.post(.goForward)
            }
            .keyboardShortcut("]")

            Button("Reload Page") {
                BrowserCommandCenter.post(.reload)
            }
            .keyboardShortcut("r")

            Divider()

            Button("Show History") {
                BrowserCommandCenter.post(.showHistory)
            }
            .keyboardShortcut("y", modifiers: [.command])

            Button("Show Bookmarks") {
                BrowserCommandCenter.post(.showBookmarks)
            }
            .keyboardShortcut("b", modifiers: [.command, .option])
        }
    }
}
