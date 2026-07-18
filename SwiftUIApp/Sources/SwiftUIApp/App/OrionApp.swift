import AppKit
import SwiftUI

@main
struct OrionApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var coordinator = AppCoordinator()

    init() {
        OrionPerformance.appDidInitialize()
    }

    var body: some Scene {
        WindowGroup("Orion", id: "browser", for: BrowserWindowRoute.self) { route in
            BrowserRootView(
                coordinator: coordinator,
                route: route.wrappedValue ?? .normal()
            )
            .environmentObject(coordinator)
        }
        .windowResizability(.contentMinSize)
        .commands {
            BrowserCommands()
        }
        Settings {
            ParitySettingsView()
                .environmentObject(coordinator)
        }
    }
}

private struct BrowserCommands: Commands {
    @FocusedValue(\.browserCommandActions) private var actions

    var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("New Tab") {
                actions?.newTab()
            }
            .keyboardShortcut("t")
            .disabled(actions == nil)

            Button("New Private Window") {
                actions?.newPrivateWindow()
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])
            .disabled(actions == nil)

            Button("Close Tab") {
                actions?.closeTab()
            }
            .keyboardShortcut("w")
            .disabled(actions == nil)

            Button("Reopen Closed Tab") {
                actions?.reopenClosedTab()
            }
            .keyboardShortcut("t", modifiers: [.command, .shift])
            .disabled(actions == nil)
        }

        CommandMenu("Browser") {
            Button("Go Back") {
                actions?.goBack()
            }
            .keyboardShortcut("[")
            .disabled(actions == nil)

            Button("Go Forward") {
                actions?.goForward()
            }
            .keyboardShortcut("]")
            .disabled(actions == nil)

            Button("Reload Page") {
                actions?.reload()
            }
            .keyboardShortcut("r")
            .disabled(actions == nil)

            Button("Hard Reload") {
                actions?.hardReload()
            }
            .keyboardShortcut("r", modifiers: [.command, .shift])
            .disabled(actions == nil)

            Divider()

            Button("Next Tab") {
                actions?.nextTab()
            }
            .keyboardShortcut("]", modifiers: [.command, .shift])
            .disabled(actions == nil)

            Button("Previous Tab") {
                actions?.previousTab()
            }
            .keyboardShortcut("[", modifiers: [.command, .shift])
            .disabled(actions == nil)

            Button("Find in Page…") {
                actions?.showFind()
            }
            .keyboardShortcut("f")
            .disabled(actions == nil)

            Button("Focus Address Bar") {
                actions?.focusAddress()
            }
            .keyboardShortcut("l")
            .disabled(actions == nil)

            ForEach(1...9, id: \.self) { number in
                Button(number == 9 ? "Select Last Tab" : "Select Tab \(number)") {
                    actions?.selectNumberedTab(number)
                }
                .keyboardShortcut(KeyEquivalent(Character(String(number))))
                .disabled(actions == nil)
            }

            Divider()

            Button("Show History") {
                actions?.showHistory()
            }
            .keyboardShortcut("y", modifiers: [.command])
            .disabled(actions == nil)

            Button("Show Bookmarks") {
                actions?.showBookmarks()
            }
            .keyboardShortcut("b", modifiers: [.command, .option])
            .disabled(actions == nil)

            Button("Show Downloads") {
                actions?.showDownloads()
            }
            .keyboardShortcut("j")
            .disabled(actions == nil)

            Button("Toggle Reader Mode") {
                actions?.toggleReader()
            }
            .keyboardShortcut("r", modifiers: [.command, .option])
            .disabled(actions == nil)

            Button("Bookmark Page") {
                actions?.bookmarkPage()
            }
            .keyboardShortcut("d")
            .disabled(actions == nil)
        }
    }
}

@MainActor
private final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}
