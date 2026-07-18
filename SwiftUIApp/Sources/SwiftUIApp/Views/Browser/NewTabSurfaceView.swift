import SwiftUI

private struct NewTabShortcut: Identifiable {
    let id: String
    let title: String
    let urlString: String
    let systemImage: String
}

struct NewTabSurfaceView: View {
    @ObservedObject var browser: BrowserState
    @ObservedObject var library: BrowserLibraryStore
    let profile: BrowserProfile

    @AppStorage(BrowserPreferenceKeys.showSeconds) private var showSeconds = false
    @AppStorage(BrowserPreferenceKeys.hiddenDefaultShortcuts) private var hiddenShortcutsJSON = "[]"
    @AppStorage(BrowserPreferenceKeys.accentColor) private var accentName = OrionAccent.blue.rawValue
    @StateObject private var state = NewTabSurfaceState()

    private let defaults = [
        NewTabShortcut(id: "wikipedia", title: "Wikipedia", urlString: "https://wikipedia.org", systemImage: "book"),
        NewTabShortcut(id: "youtube", title: "YouTube", urlString: "https://youtube.com", systemImage: "play.rectangle"),
        NewTabShortcut(id: "github", title: "GitHub", urlString: "https://github.com", systemImage: "chevron.left.forwardslash.chevron.right"),
        NewTabShortcut(id: "maps", title: "Maps", urlString: "https://maps.apple.com", systemImage: "map")
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 30) {
                TimelineView(.periodic(from: .now, by: showSeconds ? 1 : 60)) { context in
                    VStack(spacing: 6) {
                        Text(context.date, format: timeFormat)
                            .font(.system(size: 68, weight: .thin, design: .rounded))
                            .monospacedDigit()
                        Text(context.date, format: .dateTime.weekday(.wide).month(.wide).day().year())
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                }

                VStack(spacing: 8) {
                    Image(systemName: "person.crop.circle.fill")
                        .font(.title2)
                        .foregroundStyle(accent)
                    Text(profile.name)
                        .font(.headline)
                }

                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("Search the web", text: $state.searchText)
                        .textFieldStyle(.plain)
                        .font(.title3)
                        .onSubmit { browser.load(state.searchText) }
                    if !state.searchText.isEmpty {
                        Button {
                            state.searchText = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 18)
                .frame(maxWidth: 640, minHeight: 52)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                .overlay {
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(accent.opacity(0.24))
                }

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 112, maximum: 144), spacing: 14)],
                    spacing: 14
                ) {
                    ForEach(visibleDefaultShortcuts) { shortcut in
                        shortcutButton(
                            id: shortcut.id,
                            title: shortcut.title,
                            urlString: shortcut.urlString,
                            systemImage: shortcut.systemImage,
                            removable: true
                        )
                    }

                    ForEach(library.bookmarks.filter { $0.destinations.contains(.newTab) }) { bookmark in
                        shortcutButton(
                            id: bookmark.id.uuidString,
                            title: bookmark.displayTitle,
                            urlString: bookmark.urlString,
                            systemImage: "star.fill",
                            removable: false
                        )
                    }
                }
                .frame(maxWidth: 720)
            }
            .padding(.horizontal, 40)
            .padding(.vertical, 72)
        }
        .background(
            LinearGradient(
                colors: [accent.opacity(0.08), Color.clear],
                startPoint: .top,
                endPoint: .center
            )
        )
    }

    private var timeFormat: Date.FormatStyle {
        showSeconds
            ? .dateTime.hour().minute().second()
            : .dateTime.hour().minute()
    }

    private var visibleDefaultShortcuts: [NewTabShortcut] {
        let hidden = (try? JSONDecoder().decode(Set<String>.self, from: Data(hiddenShortcutsJSON.utf8))) ?? []
        return defaults.filter { !hidden.contains($0.id) }
    }

    private var accent: Color {
        switch OrionAccent(rawValue: accentName) ?? .blue {
        case .blue: .blue
        case .purple: .purple
        case .pink: .pink
        case .orange: .orange
        case .green: .green
        case .graphite: .gray
        }
    }

    private func shortcutButton(
        id: String,
        title: String,
        urlString: String,
        systemImage: String,
        removable: Bool
    ) -> some View {
        Button {
            browser.load(urlString)
        } label: {
            VStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.title2)
                    .frame(width: 44, height: 44)
                    .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                Text(title)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
            }
            .padding(12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .contextMenu {
            if removable {
                Button("Remove Shortcut", role: .destructive) {
                    hideShortcut(id)
                }
            }
        }
    }

    private func hideShortcut(_ id: String) {
        var hidden = (try? JSONDecoder().decode(Set<String>.self, from: Data(hiddenShortcutsJSON.utf8))) ?? []
        hidden.insert(id)
        if let data = try? JSONEncoder().encode(hidden),
           let encoded = String(data: data, encoding: .utf8) {
            hiddenShortcutsJSON = encoded
        }
    }
}

@MainActor
private final class NewTabSurfaceState: ObservableObject {
    @Published var searchText = ""
}
