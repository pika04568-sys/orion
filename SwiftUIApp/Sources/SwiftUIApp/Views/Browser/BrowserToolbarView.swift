import SwiftUI

struct BrowserToolbarView: View {
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject var browser: BrowserState
    @ObservedObject var tab: BrowserTab
    @ObservedObject var library: BrowserLibraryStore

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 7) {
                toolbarButton("Back", systemImage: "chevron.left", disabled: !tab.canGoBack) {
                    browser.goBack()
                }

                toolbarButton("Forward", systemImage: "chevron.right", disabled: !tab.canGoForward) {
                    browser.goForward()
                }

                toolbarButton(tab.isLoading ? "Stop" : "Reload", systemImage: tab.isLoading ? "xmark" : "arrow.clockwise") {
                    tab.isLoading ? browser.stopLoading() : browser.reload()
                }

                toolbarButton("Home", systemImage: "house") {
                    browser.loadHomepage()
                }
            }

            AddressBarView(browser: browser, tab: tab)

            HStack(spacing: 7) {
                toolbarButton("History", systemImage: "clock.arrow.circlepath", active: browser.sidebarMode == .history) {
                    browser.sidebarMode = browser.sidebarMode == .history ? nil : .history
                }

                toolbarButton("Bookmarks", systemImage: "book", active: browser.sidebarMode == .bookmarks) {
                    browser.sidebarMode = browser.sidebarMode == .bookmarks ? nil : .bookmarks
                }

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
        _ title: String,
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
        .help(title)
    }
}

private struct AddressBarView: View {
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject var browser: BrowserState
    @ObservedObject var tab: BrowserTab
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
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

            Button {
                browser.toggleBookmarkForActiveTab()
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
            .help(browser.isBookmarked(tab) ? "Remove bookmark" : "Add bookmark")
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
    }
}
