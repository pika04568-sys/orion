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
            library.bookmarks.map(\.navigationEntry)
        case .downloads, .summary:
            []
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

            Group {
                switch mode {
                case .history, .bookmarks:
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
                                } else {
                                    Button("Remove from History") {
                                        library.removeHistory(entry)
                                    }
                                }
                            }
                        }
                        .listStyle(.sidebar)
                    }
                case .downloads:
                    DownloadsSidebarContent(downloads: browser.downloads)
                case .summary:
                    PageSummarySidebarContent(
                        summary: browser.pageSummary,
                        isLoading: browser.isSummarizing
                    )
                }
            }

            if mode == .history, !library.history.isEmpty {
                Divider()
                Menu("Clear History") {
                    Button("Last Hour") {
                        library.clearHistory(since: Date().addingTimeInterval(-3_600))
                    }

                    Button("Today") {
                        library.clearHistory(since: Calendar.current.startOfDay(for: Date()))
                    }

                    Button("Last 7 Days") {
                        library.clearHistory(since: Date().addingTimeInterval(-7 * 86_400))
                    }

                    Divider()

                    Button("All History", role: .destructive) {
                        library.clearHistory()
                    }
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

private struct DownloadsSidebarContent: View {
    let downloads: [BrowserDownload]

    var body: some View {
        if downloads.isEmpty {
            ContentUnavailablePanel(mode: .downloads)
        } else {
            List(downloads) { download in
                VStack(alignment: .leading, spacing: 5) {
                    Text(download.filename)
                        .lineLimit(1)

                    switch download.state {
                    case .downloading:
                        HStack {
                            ProgressView(value: download.fractionCompleted)
                            Text(download.fractionCompleted, format: .percent.precision(.fractionLength(0)))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    case .finished:
                        Label("Done", systemImage: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(.green)
                    case let .failed(message):
                        Label(message, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.red)
                            .lineLimit(2)
                    }
                }
                .padding(.vertical, 4)
            }
            .listStyle(.sidebar)
        }
    }
}

private struct PageSummarySidebarContent: View {
    let summary: PageSummary?
    let isLoading: Bool

    var body: some View {
        if isLoading {
            VStack(spacing: 12) {
                ProgressView()
                Text("Summarizing on this Mac…")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let summary {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(summary.title)
                        .font(.title3.weight(.semibold))

                    HStack {
                        Text(summary.source)
                        Spacer()
                        Text("\(summary.readingTimeMinutes) min read")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)

                    ForEach(Array(summary.bullets.enumerated()), id: \.offset) { _, bullet in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "circle.fill")
                                .font(.system(size: 5))
                                .padding(.top, 7)
                            Text(bullet)
                                .textSelection(.enabled)
                        }
                    }
                }
                .padding(18)
            }
        } else {
            ContentUnavailablePanel(mode: .summary)
        }
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
