import SwiftUI

struct TabStripView: View {
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject var browser: BrowserState
    var vertical = false
    @StateObject private var renameState = TabGroupRenameState()

    var body: some View {
        Group {
            if vertical {
                VStack(spacing: 6) {
                    HStack {
                        Text("Tabs").font(.headline)
                        Spacer()
                        tabMenu
                    }
                    .padding(10)
                    ScrollView(.vertical, showsIndicators: false) {
                        LazyVStack(spacing: 6) { tabItems }
                            .padding(.horizontal, 8)
                    }
                    Button("New Private Tab", systemImage: "hand.raised") {
                        browser.newPrivateTab()
                    }
                    .buttonStyle(.borderless)
                    .padding(.bottom, 10)
                }
            } else {
                HStack(spacing: 6) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 6) { tabItems }
                            .padding(.leading, 10)
                    }
                    tabMenu
                        .padding(.trailing, 10)
                }
                .frame(height: 44)
                .padding(.top, 4)
            }
        }
        .background(OrionVisualStyle.chromeBackground(for: colorScheme))
        .alert("Rename Tab Group", isPresented: renameGroupPresented) {
            TextField("Group name", text: $renameState.groupName)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                guard let renamingGroupID = renameState.groupID else { return }
                browser.renameGroup(renamingGroupID, to: renameState.groupName)
            }
        }
    }

    @ViewBuilder
    private var tabItems: some View {
        ForEach(browser.tabs.filter { $0.groupID == nil }) { tab in
            tabItem(tab)
        }
        ForEach(browser.tabGroups) { group in
            TabGroupHeader(
                group: group,
                vertical: vertical,
                toggle: { browser.toggleGroup(group.id) },
                rename: {
                    renameState.groupID = group.id
                    renameState.groupName = group.name
                },
                delete: { browser.deleteGroup(group.id) }
            )
            if !group.isCollapsed {
                ForEach(browser.tabs.filter { $0.groupID == group.id }) { tab in
                    tabItem(tab)
                }
            }
        }
    }

    private func tabItem(_ tab: BrowserTab) -> some View {
        TabStripItem(
            browser: browser,
            tab: tab,
            isSelected: tab.id == browser.activeTabID,
            vertical: vertical,
            activate: { browser.activateTab(tab.id) },
            close: { browser.closeTab(tab.id) },
            closeOthers: { browser.closeOtherTabs(keeping: tab.id) }
        )
    }

    private var tabMenu: some View {
        Menu {
            Button("New Tab") { browser.newTab() }
            Button("New Private Tab") { browser.newPrivateTab() }
            Divider()
            Button("Reopen Closed Tab") { browser.reopenClosedTab() }
            Divider()
            Button("Organize Tabs On Device", systemImage: "sparkles") {
                browser.organizeTabsOnDevice()
            }
        } label: {
            Label("New Tab", systemImage: "plus")
        } primaryAction: {
            browser.newTab()
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .buttonStyle(OrionIconButtonStyle(size: 32))
        .help("New tab")
    }

    private var renameGroupPresented: Binding<Bool> {
        Binding(
            get: { renameState.groupID != nil },
            set: { presented in
                if !presented { renameState.groupID = nil }
            }
        )
    }
}

private struct TabStripItem: View {
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject var browser: BrowserState
    @ObservedObject var tab: BrowserTab
    let isSelected: Bool
    let vertical: Bool
    let activate: () -> Void
    let close: () -> Void
    let closeOthers: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Button(action: activate) {
                HStack(spacing: 6) {
                    if tab.navigationState.isLoading {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 14, height: 14)
                    } else {
                        Image(systemName: tab.isPrivate ? "hand.raised.fill" : (tab.navigationState.isUnloaded ? "moon.zzz" : "globe"))
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
        .frame(width: vertical ? 210 : 196, height: 34)
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
            Button("Close Other Tabs", action: closeOthers)
            Divider()
            Menu("Move to Group") {
                Button("No Group") {
                    browser.assignTab(tab.id, to: nil)
                }
                ForEach(browser.tabGroups) { group in
                    Button(group.name) {
                        browser.assignTab(tab.id, to: group.id)
                    }
                }
            }
            Button("New Group") {
                browser.createGroup(name: "", including: tab.id)
            }
        }
    }
}

private struct TabGroupHeader: View {
    let group: TabGroup
    let vertical: Bool
    let toggle: () -> Void
    let rename: () -> Void
    let delete: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 6) {
                Circle()
                    .fill(Color(hex: group.colorHex))
                    .frame(width: 8, height: 8)
                Text(group.name)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Image(systemName: group.isCollapsed ? "chevron.right" : "chevron.down")
                    .font(.caption2)
            }
            .padding(.horizontal, 9)
            .frame(width: vertical ? 210 : nil, height: 28, alignment: .leading)
            .background(Color(hex: group.colorHex).opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Rename Group", action: rename)
            Button(group.isCollapsed ? "Expand Group" : "Collapse Group", action: toggle)
            Divider()
            Button("Delete Group", role: .destructive, action: delete)
        }
    }
}

private extension Color {
    init(hex: String) {
        let normalized = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: normalized).scanHexInt64(&value)
        self.init(
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255
        )
    }
}
