import AppKit
import SwiftUI
import UniformTypeIdentifiers

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
                        Text(option.displayName).tag(option.rawValue)
                    }
                }
            }
            Section("Memory") {
                Picker("RAM control", selection: $ramMode) {
                    ForEach(RAMLimitMode.allCases) { mode in
                        Text(LocalizedStringKey(mode.title)).tag(mode.rawValue)
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
                        Text(LocalizedStringKey(option.title)).tag(option.rawValue)
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
            Section("Site Permissions") {
                ForEach(coordinator.profileStore.profiles) { profile in
                    PermissionProfileSection(
                        profile: profile,
                        store: coordinator.runtime(
                            for: .normal(profileID: profile.id)
                        ).permissions
                    )
                }
            }
        }
        .formStyle(.grouped)
        .padding()
        .task { await coordinator.load() }
    }

    private var profilesAndExtensions: some View {
        ProfileSettingsView(store: coordinator.profileStore, coordinator: coordinator)
    }

    private var about: some View {
        UpdateSettingsContent(updates: coordinator.updates)
    }
}

private struct UpdateSettingsContent: View {
    @ObservedObject var updates: UpdateRuntime

    var body: some View {
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
    @StateObject private var form = ProfileSettingsFormState()

    var body: some View {
        Form {
            Section("Profiles") {
                ForEach(store.profiles) { profile in
                    HStack {
                        TextField(
                            profile.name,
                            text: Binding(
                                get: { form.renameValues[profile.id] ?? profile.name },
                                set: { form.renameValues[profile.id] = $0 }
                            )
                        )
                        Button("Rename") {
                            store.renameProfile(
                                profile.id,
                                to: form.renameValues[profile.id] ?? profile.name
                            )
                        }
                        Button("Delete", role: .destructive) {
                            coordinator.deleteProfile(profile.id)
                        }
                        .disabled(profile.id == BrowserProfile.defaultID)
                    }
                }
                HStack {
                    TextField("New profile name", text: $form.newProfileName)
                    Button("Create Profile") {
                        _ = store.addProfile(name: form.newProfileName)
                        form.newProfileName = ""
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
    @StateObject private var form = ExtensionManagerViewState()

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
                    Toggle(
                        "Pinned",
                        isOn: Binding(
                            get: { record.isPinned },
                            set: { value in
                                Task { await runtime.setPinned(value, for: record.id) }
                            }
                        )
                    )
                    .toggleStyle(.checkbox)
                    Button("Remove", role: .destructive) {
                        Task { await runtime.remove(record.id) }
                    }
                    .disabled(record.id == ManagedExtensionState.uBlockOriginLiteID)
                }
            }
            Button("Install Extension Package…") {
                let panel = NSOpenPanel()
                panel.canChooseDirectories = true
                panel.canChooseFiles = true
                panel.allowsMultipleSelection = false
                panel.allowedContentTypes = [.zip, .data]
                guard panel.runModal() == .OK, let url = panel.url else { return }
                Task {
                    do {
                        let manifest = try await runtime.inspect(sourceURL: url)
                        guard ExtensionInstallReview.confirm(manifest) else { return }
                        try await runtime.install(from: url)
                    } catch {
                        runtime.report(error)
                    }
                }
            }
            HStack {
                TextField("Chrome Web Store extension ID", text: $form.webStoreID)
                Button("Install") {
                    let id = form.webStoreID
                    Task {
                        do {
                            try await runtime.installFromChromeWebStore(id: id)
                            form.webStoreID = ""
                        } catch {
                            runtime.report(error)
                        }
                    }
                }
                .disabled(
                    !ChromeWebStoreResolver.isExtensionID(
                        form.webStoreID.trimmingCharacters(in: .whitespacesAndNewlines)
                    )
                )
            }
            Button("Check Extension Updates") {
                Task { await runtime.updateExtensions() }
            }
            .disabled(runtime.isUpdating)
        }
        .task { await runtime.load() }
    }
}

private struct PermissionProfileSection: View {
    let profile: BrowserProfile
    @ObservedObject var store: WebsitePermissionStore

    var body: some View {
        DisclosureGroup(profile.name) {
            if store.decisions.isEmpty {
                Text("No saved site permission decisions.")
                    .foregroundStyle(.secondary)
            }
            ForEach(store.decisions, id: \.self) { decision in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(decision.origin)
                        Text(decision.permission.capitalized)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Picker(
                        "Decision",
                        selection: Binding(
                            get: {
                                store.decision(
                                    origin: decision.origin,
                                    permission: decision.permission
                                )
                            },
                            set: { value in
                                store.set(
                                    value,
                                    origin: decision.origin,
                                    permission: decision.permission
                                )
                            }
                        )
                    ) {
                        ForEach(WebsitePermissionDecision.Value.allCases) { value in
                            Text(LocalizedStringKey(value.title)).tag(value)
                        }
                    }
                    .labelsHidden()
                    .frame(width: 110)
                    Button("Forget", role: .destructive) {
                        store.remove(
                            origin: decision.origin,
                            permission: decision.permission
                        )
                    }
                }
            }
            if !store.decisions.isEmpty {
                Button("Clear Saved Decisions", role: .destructive) {
                    store.clear()
                }
            }
        }
        .task { await store.load() }
    }
}
