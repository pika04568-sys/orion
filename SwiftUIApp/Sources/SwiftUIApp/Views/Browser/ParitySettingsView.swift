import AppKit
import SwiftUI

struct ParitySettingsView: View {
    @EnvironmentObject private var coordinator: AppCoordinator
    @AppStorage(BrowserPreferenceKeys.homepageURL) private var homepageURL = BrowserPreferences.defaultHomePage
    @AppStorage(BrowserPreferenceKeys.searchEngine) private var searchEngineRawValue = SearchEngine.google.rawValue
    @AppStorage(BrowserPreferenceKeys.recordHistory) private var recordHistory = true
    @AppStorage(BrowserPreferenceKeys.openNewTabsWithHomepage) private var openNewTabsWithHomepage = false
    @AppStorage(BrowserPreferenceKeys.verticalTabs) private var verticalTabs = false
    @AppStorage(BrowserPreferenceKeys.showSeconds) private var showSeconds = false
    @AppStorage(BrowserPreferenceKeys.showBookmarksBar) private var showBookmarksBar = true
    @AppStorage(BrowserPreferenceKeys.preferredColorScheme) private var colorScheme = "system"
    @AppStorage(BrowserPreferenceKeys.accentColor) private var accent = OrionAccent.blue.rawValue
    @AppStorage(BrowserPreferenceKeys.interfaceLanguage) private var language = InterfaceLanguage.resolvedDefault.rawValue
    @AppStorage(BrowserPreferenceKeys.httpsOnlyMode) private var httpsOnly = true
    @AppStorage(BrowserPreferenceKeys.antiFingerprinting) private var antiFingerprinting = true
    @AppStorage(BrowserPreferenceKeys.dnsOverHttpsEnabled) private var dnsOverHTTPS = true
    @AppStorage(BrowserPreferenceKeys.ramLimitMode) private var ramMode = RAMLimitMode.automatic.rawValue
    @StateObject private var updates = UpdateRuntime()

    var body: some View {
        TabView {
            general.tabItem { Label("General", systemImage: "gearshape") }
            appearance.tabItem { Label("Appearance", systemImage: "paintbrush") }
            privacy.tabItem { Label("Privacy", systemImage: "hand.raised") }
            profilesAndExtensions.tabItem { Label("Profiles", systemImage: "person.2") }
            about.tabItem { Label("Updates", systemImage: "arrow.triangle.2.circlepath") }
        }
        .frame(width: 650, height: 520)
        .environment(\.locale, Locale(identifier: language))
    }

    private var general: some View {
        Form {
            Section("Startup") {
                TextField("Home page", text: $homepageURL)
                Toggle("Open new tabs with home page", isOn: $openNewTabsWithHomepage)
            }
            Section("Search") {
                Picker("Search engine", selection: $searchEngineRawValue) {
                    ForEach(SearchEngine.allCases) { engine in
                        Text(engine.displayName).tag(engine.rawValue)
                    }
                }
            }
            Section("Language") {
                Picker("Interface language", selection: $language) {
                    ForEach(InterfaceLanguage.allCases) { option in
                        Text(option.title).tag(option.rawValue)
                    }
                }
            }
            Section("Memory") {
                Picker("RAM control", selection: $ramMode) {
                    ForEach(RAMLimitMode.allCases) { mode in
                        Text(mode.title).tag(mode.rawValue)
                    }
                }
                Text("Automatic uses half of physical RAM and unloads one least-recently-used background tab at a time.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    private var appearance: some View {
        Form {
            Section("Theme") {
                Picker("Appearance", selection: $colorScheme) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                Picker("Accent", selection: $accent) {
                    ForEach(OrionAccent.allCases) { option in
                        Text(option.title).tag(option.rawValue)
                    }
                }
            }
            Section("Browser chrome") {
                Toggle("Vertical tabs", isOn: $verticalTabs)
                Toggle("Show bookmarks bar", isOn: $showBookmarksBar)
                Toggle("Show seconds on New Tab", isOn: $showSeconds)
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    private var privacy: some View {
        Form {
            Section("Browsing data") {
                Toggle("Record browsing history", isOn: $recordHistory)
            }
            Section("Protection") {
                Toggle("HTTPS-only mode", isOn: $httpsOnly)
                Toggle("Anti-fingerprinting", isOn: $antiFingerprinting)
                Toggle("Cloudflare encrypted DNS", isOn: $dnsOverHTTPS)
                Text("HTTPS failures never fall back to plaintext. Private windows use memory-only website data and load no extensions.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    private var profilesAndExtensions: some View {
        ProfileSettingsView(store: coordinator.profileStore, coordinator: coordinator)
    }

    private var about: some View {
        Form {
            Section("Orion") {
                LabeledContent("Version", value: updates.currentVersion)
                updateStatus
                Button("Check for Updates") {
                    Task { await updates.check() }
                }
                .disabled(updates.state == .checking)
            }
        }
        .formStyle(.grouped)
        .padding()
        .task {
            if updates.state == .idle {
                try? await Task.sleep(for: .seconds(2))
                await updates.check()
            }
        }
    }

    @ViewBuilder
    private var updateStatus: some View {
        switch updates.state {
        case .idle:
            Text("Updates have not been checked.")
        case .checking:
            HStack { ProgressView(); Text("Checking…") }
        case let .current(version):
            Label("Orion \(version) is current.", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case let .available(version, url):
            HStack {
                Label("Orion \(version) is available.", systemImage: "arrow.down.circle.fill")
                Spacer()
                Link("Open Release", destination: url)
            }
        case let .failed(message):
            Label(message, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.secondary)
        }
    }
}

private struct ProfileSettingsView: View {
    @ObservedObject var store: ProfileStore
    let coordinator: AppCoordinator
    @State private var newProfileName = ""
    @State private var renameValues: [UUID: String] = [:]

    var body: some View {
        Form {
            Section("Profiles") {
                ForEach(store.profiles) { profile in
                    HStack {
                        TextField(
                            profile.name,
                            text: Binding(
                                get: { renameValues[profile.id] ?? profile.name },
                                set: { renameValues[profile.id] = $0 }
                            )
                        )
                        Button("Rename") {
                            store.renameProfile(
                                profile.id,
                                to: renameValues[profile.id] ?? profile.name
                            )
                        }
                    }
                }
                HStack {
                    TextField("New profile name", text: $newProfileName)
                    Button("Create Profile") {
                        _ = store.addProfile(name: newProfileName)
                        newProfileName = ""
                    }
                }
            }
            Section("WebExtensions") {
                ForEach(store.profiles) { profile in
                    ExtensionProfileRow(
                        profile: profile,
                        runtime: coordinator.runtime(for: .normal(profileID: profile.id)).extensions
                    )
                }
            }
        }
        .formStyle(.grouped)
        .padding()
        .task { await coordinator.load() }
    }
}

private struct ExtensionProfileRow: View {
    let profile: BrowserProfile
    @ObservedObject var runtime: ExtensionRuntime

    var body: some View {
        DisclosureGroup(profile.name) {
            if runtime.records.isEmpty {
                Text("No extensions installed.")
                    .foregroundStyle(.secondary)
            }
            ForEach(runtime.records) { record in
                HStack {
                    VStack(alignment: .leading) {
                        Text(record.name)
                        Text(record.version)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle(
                        "Enabled",
                        isOn: Binding(
                            get: { record.isEnabled },
                            set: { value in
                                Task { await runtime.setEnabled(value, for: record.id) }
                            }
                        )
                    )
                    .labelsHidden()
                    Button("Remove", role: .destructive) {
                        Task { await runtime.remove(record.id) }
                    }
                    .disabled(record.id == ManagedExtensionState.uBlockOriginLiteID)
                }
            }
            Button("Load Unpacked Extension…") {
                let panel = NSOpenPanel()
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.allowsMultipleSelection = false
                guard panel.runModal() == .OK, let url = panel.url else { return }
                Task { try? await runtime.install(from: url) }
            }
        }
        .task { await runtime.load() }
    }
}
