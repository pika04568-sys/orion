import SwiftUI

struct LibrarySidebarView: View {
    @Environment(\.colorScheme) private var colorScheme
    let mode: LibrarySidebarMode
    @ObservedObject var browser: BrowserState
    @ObservedObject var library: BrowserLibraryStore

    private var entries: [NavigationEntry] {
        switch mode {
        case .history:
            library.history
        case .bookmarks:
            library.bookmarks
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Library")
                        .font(.caption.weight(.bold))
                        .textCase(.uppercase)
                        .foregroundStyle(OrionVisualStyle.secondaryText(for: colorScheme))

                    Text(mode.title)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(OrionVisualStyle.primaryText(for: colorScheme))
                }

                Spacer()

                Button {
                    browser.sidebarMode = nil
                } label: {
                    Label("Close", systemImage: "xmark")
                }
                .labelStyle(.iconOnly)
                .buttonStyle(OrionIconButtonStyle(size: 34))
                .help("Close sidebar")
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)

            Picker("Library", selection: Binding(
                get: { mode },
                set: { browser.sidebarMode = $0 }
            )) {
                ForEach(LibrarySidebarMode.allCases) { mode in
                    Label(mode.title, systemImage: mode.systemImage)
                        .tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 18)
            .padding(.bottom, 12)

            if entries.isEmpty {
                ContentUnavailablePanel(mode: mode)
            } else {
                List(entries) { entry in
                    LibraryEntryRow(entry: entry) {
                        browser.load(entry: entry)
                    }
                    .contextMenu {
                        if mode == .bookmarks {
                            Button("Remove Bookmark") {
                                library.removeBookmark(entry)
                            }
                        }
                    }
                }
                .listStyle(.sidebar)
            }

            if mode == .history, !library.history.isEmpty {
                Divider()
                Button("Clear History") {
                    library.clearHistory()
                }
                .padding(10)
            }
        }
        .background(
            OrionVisualStyle.pageBackground(for: colorScheme)
                .overlay(Color.white.opacity(colorScheme == .dark ? 0.02 : 0.34))
        )
    }
}

private struct LibraryEntryRow: View {
    let entry: NavigationEntry
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: "globe")
                    .foregroundStyle(.secondary)
                    .frame(width: 16)

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.displayTitle)
                        .lineLimit(1)

                    Text(entry.host)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct ContentUnavailablePanel: View {
    let mode: LibrarySidebarMode

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: mode.systemImage)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(.secondary)

            Text("No \(mode.title)")
                .font(.headline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
