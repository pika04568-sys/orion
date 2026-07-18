import SwiftUI

struct BrowserToolbarView: View {
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject var browser: BrowserState
    @ObservedObject var tab: BrowserTab
    @ObservedObject var library: BrowserLibraryStore

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 7) {
                toolbarButton("Back", systemImage: "chevron.left", disabled: !tab.navigationState.canGoBack) {
                    browser.goBack()
                }

                toolbarButton("Forward", systemImage: "chevron.right", disabled: !tab.navigationState.canGoForward) {
                    browser.goForward()
                }

                toolbarButton(
                    tab.navigationState.isLoading ? "Stop" : "Reload",
                    systemImage: tab.navigationState.isLoading ? "xmark" : "arrow.clockwise"
                ) {
                    tab.navigationState.isLoading ? browser.stopLoading() : browser.reload()
                }

                toolbarButton("Home", systemImage: "house") {
                    browser.loadHomepage()
                }

                toolbarButton(
                    tab.navigationState.isReaderMode ? "Exit Reader" : "Reader Mode",
                    systemImage: "book.pages",
                    active: tab.navigationState.isReaderMode
                ) {
                    browser.toggleReaderMode()
                }
            }

            AddressBarView(browser: browser, tab: tab)

            HStack(spacing: 7) {
                if let runtime = browser.extensionRuntime, !browser.isPrivateSession {
                    ExtensionToolbarActions(
                        browser: browser,
                        tab: tab,
                        runtime: runtime
                    )
                }

                if let storeID = ChromeWebStoreResolver.extensionID(
                    from: tab.webView?.url?.absoluteString
                        ?? tab.navigationState.urlString
                ), let runtime = browser.extensionRuntime {
                    ChromeWebStoreInstallButton(
                        browser: browser,
                        runtime: runtime,
                        extensionID: storeID
                    )
                }

                toolbarButton("History", systemImage: "clock.arrow.circlepath", active: browser.sidebarMode == .history) {
                    browser.sidebarMode = browser.sidebarMode == .history ? nil : .history
                }

                toolbarButton("Bookmarks", systemImage: "book", active: browser.sidebarMode == .bookmarks) {
                    browser.sidebarMode = browser.sidebarMode == .bookmarks ? nil : .bookmarks
                }

                toolbarButton("Downloads", systemImage: "arrow.down.circle", active: browser.sidebarMode == .downloads) {
                    browser.sidebarMode = browser.sidebarMode == .downloads ? nil : .downloads
                }

                toolbarButton("Summarize", systemImage: "sparkles", active: browser.sidebarMode == .summary) {
                    browser.summarizeActivePage()
                }

                Menu {
                    Button("New Private Tab", systemImage: "hand.raised") {
                        browser.newPrivateTab()
                    }
                    Button("Reopen Closed Tab", systemImage: "arrow.uturn.backward") {
                        browser.reopenClosedTab()
                    }
                    Button("Find in Page…", systemImage: "text.magnifyingglass") {
                        browser.showFind()
                    }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .buttonStyle(OrionIconButtonStyle())

                SettingsLink {
                    Label("Settings", systemImage: "gearshape")
                }
                .buttonStyle(OrionIconButtonStyle())
                .help("Settings")
            }
        }
        .labelStyle(.iconOnly)
        .controlSize(.large)
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    private func toolbarButton(
        _ title: LocalizedStringKey,
        systemImage: String,
        disabled: Bool = false,
        active: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
        }
        .buttonStyle(OrionIconButtonStyle(active: active))
        .disabled(disabled)
        .opacity(disabled ? 0.46 : 1)
        .help(Text(title))
    }
}

private struct ChromeWebStoreInstallButton: View {
    @ObservedObject var browser: BrowserState
    @ObservedObject var runtime: ExtensionRuntime
    let extensionID: String
    @StateObject private var state = ExtensionInstallButtonState()

    var body: some View {
        Button {
            state.isInstalling = true
            Task {
                defer { state.isInstalling = false }
                do {
                    try await runtime.installFromChromeWebStore(id: extensionID)
                    browser.load(BrowserSurface.extensions.displayURLString)
                } catch {
                    runtime.report(error)
                }
            }
        } label: {
            if state.isInstalling {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 18, height: 18)
            } else {
                Label(
                    isInstalled ? "Installed in Orion" : "Install in Orion",
                    systemImage: isInstalled ? "checkmark.seal.fill" : "plus.app.fill"
                )
            }
        }
        .buttonStyle(OrionIconButtonStyle(active: isInstalled))
        .disabled(state.isInstalling || isInstalled)
        .help(isInstalled ? "This extension is installed." : "Install this Chrome Web Store extension in Orion")
    }

    private var isInstalled: Bool {
        runtime.records.contains { $0.id == extensionID }
    }
}

private struct ExtensionToolbarActions: View {
    @ObservedObject var browser: BrowserState
    @ObservedObject var tab: BrowserTab
    @ObservedObject var runtime: ExtensionRuntime

    var body: some View {
        ForEach(pinnedRecords) { record in
            Button {
                runtime.performAction(
                    for: record.id,
                    tab: browser.extensionTabAdapter(for: tab.id)
                )
            } label: {
                ZStack(alignment: .topTrailing) {
                    extensionIcon(record)
                    let badge = runtime.actionBadge(
                        for: record.id,
                        tab: browser.extensionTabAdapter(for: tab.id)
                    )
                    if !badge.isEmpty {
                        Text(badge)
                            .font(.system(size: 8, weight: .bold))
                            .padding(.horizontal, 3)
                            .frame(minWidth: 12, minHeight: 12)
                            .background(.red, in: Capsule())
                            .foregroundStyle(.white)
                            .offset(x: 5, y: -5)
                    }
                }
            }
            .buttonStyle(OrionIconButtonStyle())
            .disabled(
                !runtime.isActionEnabled(
                    for: record.id,
                    tab: browser.extensionTabAdapter(for: tab.id)
                )
            )
            .help(
                runtime.actionLabel(
                    for: record,
                    tab: browser.extensionTabAdapter(for: tab.id)
                )
            )
            .contextMenu {
                Button("Extension Menu…") {
                    runtime.presentMenu(
                        for: record.id,
                        tab: browser.extensionTabAdapter(for: tab.id)
                    )
                }
                if runtime.context(for: record.id)?.optionsPageURL != nil {
                    Button("Options") {
                        runtime.openOptions(for: record.id, in: browser)
                    }
                }
                Button("Unpin from Toolbar") {
                    Task { await runtime.setPinned(false, for: record.id) }
                }
            }
        }

        Menu {
            if runtime.records.isEmpty {
                Text("No extensions installed.")
            }
            ForEach(runtime.records.filter(\.isEnabled)) { record in
                Button {
                    runtime.performAction(
                        for: record.id,
                        tab: browser.extensionTabAdapter(for: tab.id)
                    )
                } label: {
                    Label(
                        runtime.actionLabel(
                            for: record,
                            tab: browser.extensionTabAdapter(for: tab.id)
                        ),
                        systemImage: record.isPinned ? "pin.fill" : "puzzlepiece.extension"
                    )
                }
                Button(record.isPinned ? "Unpin from Toolbar" : "Pin to Toolbar") {
                    Task { await runtime.setPinned(!record.isPinned, for: record.id) }
                }
            }
            Divider()
            Button("Manage Extensions…", systemImage: "slider.horizontal.3") {
                browser.load(BrowserSurface.extensions.displayURLString)
            }
        } label: {
            Label("Extensions", systemImage: "puzzlepiece.extension")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .buttonStyle(OrionIconButtonStyle())
    }

    private var pinnedRecords: [ExtensionRecord] {
        runtime.records.filter { $0.isEnabled && $0.isPinned }
    }

    @ViewBuilder
    private func extensionIcon(_ record: ExtensionRecord) -> some View {
        if let icon = runtime.actionIcon(
            for: record.id,
            tab: browser.extensionTabAdapter(for: tab.id),
            size: CGSize(width: 18, height: 18)
        ) {
            Image(nsImage: icon)
                .resizable()
                .scaledToFit()
                .frame(width: 18, height: 18)
        } else {
            Image(systemName: "puzzlepiece.extension.fill")
                .frame(width: 18, height: 18)
        }
    }
}

private struct AddressBarView: View {
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject var browser: BrowserState
    @ObservedObject var tab: BrowserTab
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: securityIcon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(OrionVisualStyle.secondaryText(for: colorScheme))

            TextField("Search or enter URL", text: Binding(
                get: { tab.addressText },
                set: { tab.addressText = $0 }
            ))
            .textFieldStyle(.plain)
            .font(.system(size: 14))
            .foregroundStyle(OrionVisualStyle.primaryText(for: colorScheme))
            .focused($focused)
            .onSubmit {
                browser.submitAddress(for: tab)
            }

            Menu {
                if browser.isBookmarked(tab) {
                    Button("Remove Bookmark", role: .destructive) {
                        browser.toggleBookmarkForActiveTab()
                    }
                } else {
                    Button("Bookmarks Bar") {
                        browser.bookmarkActiveTab(destinations: [.bar])
                    }
                    Button("New Tab") {
                        browser.bookmarkActiveTab(destinations: [.newTab])
                    }
                    Button("Both") {
                        browser.bookmarkActiveTab(destinations: [.bar, .newTab])
                    }
                }
            } label: {
                Label(
                    browser.isBookmarked(tab) ? "Remove Bookmark" : "Add Bookmark",
                    systemImage: browser.isBookmarked(tab) ? "star.fill" : "star"
                )
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.plain)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(browser.isBookmarked(tab) ? OrionVisualStyle.accent : OrionVisualStyle.secondaryText(for: colorScheme))
            .frame(width: 28, height: 28)
            .contentShape(RoundedRectangle(cornerRadius: 9))
            .disabled(tab.navigationEntry == nil)
            .help(
                Text(
                    browser.isBookmarked(tab)
                        ? LocalizedStringKey("Remove Bookmark")
                        : LocalizedStringKey("Add Bookmark")
                )
            )
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .frame(height: 38)
        .background {
            RoundedRectangle(cornerRadius: 18)
                .fill(OrionVisualStyle.addressBackground(for: colorScheme))
                .overlay(alignment: .top) {
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(Color.white.opacity(colorScheme == .dark ? 0.10 : 0.70), lineWidth: 1)
                }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .stroke(focused ? OrionVisualStyle.accent.opacity(0.38) : OrionVisualStyle.border(for: colorScheme).opacity(0.74), lineWidth: 1)
        }
        .shadow(color: Color.black.opacity(colorScheme == .dark ? 0.28 : 0.10), radius: focused ? 18 : 13, y: focused ? 8 : 6)
        .animation(.easeOut(duration: 0.16), value: focused)
        .onReceive(NotificationCenter.default.publisher(for: .orionFocusAddress)) { _ in
            focused = true
        }
    }

    private var securityIcon: String {
        guard let scheme = URL(string: tab.navigationState.urlString)?.scheme?.lowercased() else {
            return "magnifyingglass"
        }
        return scheme == "https" ? "lock.fill" : "exclamationmark.triangle"
    }
}
