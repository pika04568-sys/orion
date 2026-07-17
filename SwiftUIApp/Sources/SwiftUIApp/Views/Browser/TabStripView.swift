import SwiftUI

struct TabStripView: View {
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject var browser: BrowserState

    var body: some View {
        HStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 6) {
                    ForEach(browser.tabs) { tab in
                        TabStripItem(
                            tab: tab,
                            isSelected: tab.id == browser.activeTabID,
                            activate: { browser.activateTab(tab.id) },
                            close: { browser.closeTab(tab.id) }
                        )
                    }
                }
                .padding(.leading, 10)
            }

            Button {
                browser.newTab()
            } label: {
                Label("New Tab", systemImage: "plus")
            }
            .buttonStyle(OrionIconButtonStyle(size: 32))
            .help("New tab")
            .padding(.trailing, 10)
        }
        .frame(height: 44)
        .padding(.top, 4)
        .background(OrionVisualStyle.chromeBackground(for: colorScheme))
    }
}

private struct TabStripItem: View {
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject var tab: BrowserTab
    let isSelected: Bool
    let activate: () -> Void
    let close: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Button(action: activate) {
                HStack(spacing: 6) {
                    if tab.navigationState.isLoading {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 14, height: 14)
                    } else {
                        Image(systemName: "globe")
                            .foregroundStyle(.secondary)
                            .frame(width: 14)
                    }

                    Text(tab.displayTitle)
                        .font(.callout)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button(action: close) {
                Label("Close Tab", systemImage: "xmark")
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.plain)
            .help("Close tab")
        }
        .padding(.leading, 12)
        .padding(.trailing, 7)
        .frame(width: 196, height: 34)
        .foregroundStyle(isSelected ? OrionVisualStyle.accent : OrionVisualStyle.primaryText(for: colorScheme))
        .background(
            OrionVisualStyle.tabBackground(for: colorScheme, active: isSelected),
            in: UnevenRoundedRectangle(topLeadingRadius: 11, bottomLeadingRadius: 3, bottomTrailingRadius: 3, topTrailingRadius: 11)
        )
        .overlay {
            UnevenRoundedRectangle(topLeadingRadius: 11, bottomLeadingRadius: 3, bottomTrailingRadius: 3, topTrailingRadius: 11)
                .strokeBorder(isSelected ? OrionVisualStyle.accent.opacity(0.30) : OrionVisualStyle.border(for: colorScheme), lineWidth: 1)
        }
        .shadow(color: (isSelected ? OrionVisualStyle.accent : Color.black).opacity(colorScheme == .dark ? 0.26 : 0.12), radius: isSelected ? 14 : 8, y: 6)
        .contextMenu {
            Button("Close Tab", action: close)
        }
    }
}
