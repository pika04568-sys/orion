import SwiftUI

struct ContentView: View {
    @SceneStorage("selectedSection") private var selectedSectionID = StarterSection.overview.rawValue

    private var selectedSection: StarterSection {
        StarterSection(rawValue: selectedSectionID) ?? .overview
    }

    var body: some View {
        NavigationSplitView {
            SidebarView(selectedSectionID: $selectedSectionID)
        } detail: {
            DetailView(section: selectedSection)
        }
        .frame(minWidth: 760, minHeight: 520)
    }
}

private struct SidebarView: View {
    @Binding var selectedSectionID: String

    var body: some View {
        List(selection: $selectedSectionID) {
            Section("Project") {
                ForEach(StarterSection.allCases) { section in
                    Label(section.title, systemImage: section.systemImage)
                        .tag(section.rawValue)
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("SwiftUIApp")
    }
}

private struct DetailView: View {
    let section: StarterSection

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HeaderView(section: section)

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 220), spacing: 16)],
                    alignment: .leading,
                    spacing: 16
                ) {
                    ForEach(section.cards) { card in
                        StarterCard(card: card)
                    }
                }
            }
            .padding(28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(section.title)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    selectedAction(section)
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .help("Refresh this section")
            }
        }
    }

    private func selectedAction(_ section: StarterSection) {
        // Hook up app-specific behavior here as the project grows.
    }
}

private struct HeaderView: View {
    let section: StarterSection

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: section.systemImage)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.tint)

            Text(section.title)
                .font(.largeTitle.bold())

            Text(section.summary)
                .font(.title3)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct StarterCard: View {
    let card: StarterCardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(card.title, systemImage: card.systemImage)
                .font(.headline)

            Text(card.detail)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct SettingsView: View {
    @AppStorage("showWelcomeHints") private var showWelcomeHints = true

    var body: some View {
        Form {
            Toggle("Show welcome hints", isOn: $showWelcomeHints)
        }
        .formStyle(.grouped)
        .padding()
        .frame(width: 360)
    }
}

private enum StarterSection: String, CaseIterable, Identifiable {
    case overview
    case workspace
    case nextSteps

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview:
            "Overview"
        case .workspace:
            "Workspace"
        case .nextSteps:
            "Next Steps"
        }
    }

    var systemImage: String {
        switch self {
        case .overview:
            "sparkles"
        case .workspace:
            "sidebar.left"
        case .nextSteps:
            "checklist"
        }
    }

    var summary: String {
        switch self {
        case .overview:
            "A clean native macOS SwiftUI starting point, ready for app-specific features."
        case .workspace:
            "A split-view layout with scene storage, settings, toolbar actions, and adaptive system styling."
        case .nextSteps:
            "Replace the starter cards with your first real workflow when the product direction is set."
        }
    }

    var cards: [StarterCardModel] {
        switch self {
        case .overview:
            [
                StarterCardModel(title: "Native Window", detail: "Uses SwiftUI scenes and macOS window sizing without storyboards or nibs.", systemImage: "macwindow"),
                StarterCardModel(title: "Adaptive Styling", detail: "Relies on semantic colors and materials so Light and Dark Mode work automatically.", systemImage: "circle.lefthalf.filled"),
                StarterCardModel(title: "SwiftPM Build", detail: "Builds from the command line and stages a launchable app bundle locally.", systemImage: "shippingbox")
            ]
        case .workspace:
            [
                StarterCardModel(title: "Sidebar Selection", detail: "Keeps navigation stable with a native source-list sidebar and scene-scoped selection.", systemImage: "list.bullet"),
                StarterCardModel(title: "Settings Scene", detail: "Includes a dedicated SwiftUI settings window for user preferences.", systemImage: "gearshape"),
                StarterCardModel(title: "Toolbar Ready", detail: "Provides a toolbar action slot where real app commands can land.", systemImage: "hammer")
            ]
        case .nextSteps:
            [
                StarterCardModel(title: "Add Models", detail: "Move durable app data into Models and Stores as the starter evolves.", systemImage: "tray.full"),
                StarterCardModel(title: "Add Services", detail: "Put networking, persistence, or process clients behind focused service types.", systemImage: "point.3.connected.trianglepath.dotted"),
                StarterCardModel(title: "Add Tests", detail: "Introduce unit tests once the first real behavior replaces this placeholder content.", systemImage: "testtube.2")
            ]
        }
    }
}

private struct StarterCardModel: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let systemImage: String
}
