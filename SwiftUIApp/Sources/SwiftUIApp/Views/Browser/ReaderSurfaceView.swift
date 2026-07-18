import SwiftUI

struct ReaderSurfaceView: View {
    let snapshot: ReaderSnapshot

    @AppStorage(BrowserPreferenceKeys.readerTheme) private var themeName = ReaderTheme.light.rawValue
    @AppStorage(BrowserPreferenceKeys.readerFontScale) private var fontScale = 1.0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Picker("Reader Theme", selection: $themeName) {
                        ForEach(ReaderTheme.allCases) { theme in
                            Text(theme.title).tag(theme.rawValue)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 320)

                    Spacer()

                    Button {
                        fontScale = max(0.8, fontScale - 0.1)
                    } label: {
                        Label("Smaller Text", systemImage: "textformat.size.smaller")
                    }
                    .labelStyle(.iconOnly)

                    Button {
                        fontScale = min(1.6, fontScale + 0.1)
                    } label: {
                        Label("Larger Text", systemImage: "textformat.size.larger")
                    }
                    .labelStyle(.iconOnly)
                }

                Text(snapshot.title)
                    .font(.system(size: 40 * fontScale, weight: .bold, design: .serif))

                HStack(spacing: 8) {
                    Text(snapshot.site)
                    if let byline = snapshot.byline {
                        Text("•")
                        Text(byline)
                    }
                    if let date = snapshot.publishedDate {
                        Text("•")
                        Text(date)
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)

                Divider()

                ForEach(snapshot.blocks) { block in
                    blockView(block)
                }

                ForEach(snapshot.images) { image in
                    if let url = URL(string: image.urlString) {
                        AsyncImage(url: url) { phase in
                            if let image = phase.image {
                                image.resizable().scaledToFit()
                            } else if phase.error == nil {
                                ProgressView()
                                    .frame(maxWidth: .infinity, minHeight: 120)
                            }
                        }
                        .accessibilityLabel(image.altText)
                    }
                }
            }
            .frame(maxWidth: 780, alignment: .leading)
            .padding(.horizontal, 44)
            .padding(.vertical, 48)
        }
        .foregroundStyle(foreground)
        .background(background)
    }

    @ViewBuilder
    private func blockView(_ block: ReaderSnapshot.Block) -> some View {
        switch block.kind {
        case .heading:
            Text(block.text)
                .font(.system(size: 27 * fontScale, weight: .semibold, design: .serif))
                .padding(.top, 12)
        case .quote:
            Text(block.text)
                .font(.system(size: 19 * fontScale, design: .serif))
                .italic()
                .padding(.leading, 18)
                .overlay(alignment: .leading) {
                    Rectangle().frame(width: 3).foregroundStyle(.secondary)
                }
        case .listItem:
            HStack(alignment: .firstTextBaseline) {
                Text("•")
                Text(block.text)
            }
            .font(.system(size: 19 * fontScale, design: .serif))
        case .paragraph:
            Text(block.text)
                .font(.system(size: 19 * fontScale, design: .serif))
                .lineSpacing(7 * fontScale)
        }
    }

    private var selectedTheme: ReaderTheme {
        ReaderTheme(rawValue: themeName) ?? .light
    }

    private var background: Color {
        switch selectedTheme {
        case .light: Color(red: 0.98, green: 0.98, blue: 0.97)
        case .sepia: Color(red: 0.95, green: 0.90, blue: 0.78)
        case .night: Color(red: 0.08, green: 0.09, blue: 0.11)
        }
    }

    private var foreground: Color {
        selectedTheme == .night ? .white.opacity(0.92) : .black.opacity(0.84)
    }
}
