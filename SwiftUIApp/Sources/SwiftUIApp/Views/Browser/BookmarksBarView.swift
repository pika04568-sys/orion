import SwiftUI

struct BookmarksBarView: View {
    @ObservedObject var browser: BrowserState
    @ObservedObject var library: BrowserLibraryStore

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 4) {
                ForEach(library.bookmarks.filter { $0.destinations.contains(.bar) }.prefix(20)) { bookmark in
                    Button {
                        browser.load(entry: bookmark.navigationEntry)
                    } label: {
                        Label {
                            Text(bookmark.displayTitle)
                                .lineLimit(1)
                        } icon: {
                            Image(systemName: "globe")
                        }
                    }
                    .buttonStyle(.borderless)
                    .controlSize(.small)
                    .contextMenu {
                        Button("Remove Bookmark") {
                            library.removeBookmark(bookmark)
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
        }
        .frame(height: 32)
        .background(.thinMaterial)
        .overlay(alignment: .bottom) { Divider() }
    }
}
