import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct ExtensionsSurfaceView: View {
    let isPrivate: Bool
    @ObservedObject var browser: BrowserState
    let runtime: ExtensionRuntime?

    var body: some View {
        if isPrivate || runtime == nil {
            ContentUnavailableView {
                Label("Extensions", systemImage: "puzzlepiece.extension")
            } description: {
                Text("Extensions are disabled in private browsing.")
            }
        } else if let runtime {
            ExtensionManagerSurface(browser: browser, runtime: runtime)
        }
    }
}

private struct ExtensionManagerSurface: View {
    @ObservedObject var browser: BrowserState
    @ObservedObject var runtime: ExtensionRuntime
    @StateObject private var form = ExtensionManagerViewState()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                installationCard
                installedExtensions
            }
            .frame(maxWidth: 920, alignment: .leading)
            .padding(32)
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .alert(
            "Extension Error",
            isPresented: Binding(
                get: { runtime.lastError != nil },
                set: { if !$0 { runtime.clearError() } }
            )
        ) {
            Button("OK") { runtime.clearError() }
        } message: {
            Text(runtime.lastError ?? "")
        }
        .confirmationDialog(
            "Remove Extension?",
            isPresented: Binding(
                get: { form.pendingRemoval != nil },
                set: { if !$0 { form.pendingRemoval = nil } }
            ),
            presenting: form.pendingRemoval
        ) { record in
            Button("Remove \(record.name)", role: .destructive) {
                Task { await runtime.remove(record.id) }
                form.pendingRemoval = nil
            }
            Button("Cancel", role: .cancel) {
                form.pendingRemoval = nil
            }
        } message: { record in
            Text("This removes \(record.name) from the current profile.")
        }
        .task { await runtime.load() }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 18) {
            Image(systemName: "puzzlepiece.extension.fill")
                .font(.system(size: 32, weight: .semibold))
                .foregroundStyle(.tint)
                .frame(width: 62, height: 62)
                .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
            VStack(alignment: .leading, spacing: 6) {
                Text("Manage Installed Extensions")
                    .font(.largeTitle.bold())
                Text("Extensions are isolated to \(runtime.profile.name). Review requested permissions before enabling extensions from publishers you trust.")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            managedProtectionBadge
        }
    }

    @ViewBuilder
    private var managedProtectionBadge: some View {
        switch runtime.managedState {
        case .idle, .installing:
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("Preparing Protection")
            }
            .extensionBadgeStyle()
        case let .ready(version):
            Label("Protected · \(version)", systemImage: "shield.checkered")
                .foregroundStyle(.green)
                .extensionBadgeStyle()
        case .failed:
            Button {
                Task { await runtime.retryManagedProtection() }
            } label: {
                Label("Retry Protection", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
        }
    }

    private var installationCard: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Button("Open Chrome Web Store", systemImage: "safari") {
                        browser.load(ChromeWebStoreResolver.storeURL.absoluteString)
                    }
                    .buttonStyle(.borderedProminent)

                    Button("Install Package…", systemImage: "shippingbox") {
                        chooseExtensionPackage()
                    }
                    .buttonStyle(.bordered)

                    Button("Check Extension Updates", systemImage: "arrow.triangle.2.circlepath") {
                        Task { await runtime.updateExtensions() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(runtime.isUpdating)

                    if runtime.isUpdating {
                        ProgressView()
                            .controlSize(.small)
                    }
                }

                HStack {
                    TextField("Chrome Web Store extension ID", text: $form.webStoreID)
                        .textFieldStyle(.roundedBorder)
                    Button("Install") {
                        installWebStoreID()
                    }
                    .disabled(
                        form.isInstalling
                            || !ChromeWebStoreResolver.isExtensionID(
                                form.webStoreID.trimmingCharacters(in: .whitespacesAndNewlines)
                            )
                    )
                }

                if let message = runtime.lastUpdateMessage {
                    Label(message, systemImage: "checkmark.circle.fill")
                        .font(.callout)
                        .foregroundStyle(.green)
                }
            }
            .padding(8)
        } label: {
            Label("Install Extensions", systemImage: "plus.app")
        }
    }

    private var installedExtensions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Installed Extensions")
                .font(.title2.bold())

            if runtime.records.isEmpty {
                ContentUnavailableView(
                    "No extensions installed.",
                    systemImage: "puzzlepiece.extension"
                )
                .frame(maxWidth: .infinity, minHeight: 180)
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(runtime.records) { record in
                        extensionCard(record)
                    }
                }
            }
        }
    }

    private func extensionCard(_ record: ExtensionRecord) -> some View {
        let unsupported = runtime.unsupportedAPIs(for: record)
        return GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 14) {
                    extensionIcon(record)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(record.name)
                                .font(.headline)
                            if record.id == ManagedExtensionState.uBlockOriginLiteID {
                                Text("Managed by Orion")
                                    .font(.caption.bold())
                                    .foregroundStyle(.blue)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(.blue.opacity(0.12), in: Capsule())
                            }
                        }
                        HStack(spacing: 4) {
                            Text(record.version)
                            Text("·")
                            Text(sourceTitle(record.source))
                        }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(record.id)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.tertiary)
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
                    .toggleStyle(.switch)
                    .disabled(record.id == ManagedExtensionState.uBlockOriginLiteID)
                }

                if !record.permissions.isEmpty {
                    LabeledContent("Requested Permissions") {
                        Text(record.permissions.joined(separator: ", "))
                            .multilineTextAlignment(.trailing)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    .font(.callout)
                }

                if !unsupported.isEmpty {
                    Label(
                        "Unsupported WebKit APIs: \(unsupported.joined(separator: ", "))",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                    .font(.callout)
                    .foregroundStyle(.orange)
                }

                HStack {
                    Toggle(
                        "Pinned to Toolbar",
                        isOn: Binding(
                            get: { record.isPinned },
                            set: { value in
                                Task { await runtime.setPinned(value, for: record.id) }
                            }
                        )
                    )
                    .toggleStyle(.checkbox)

                    Spacer()

                    if runtime.context(for: record.id)?.optionsPageURL != nil {
                        Button("Options") {
                            runtime.openOptions(for: record.id, in: browser)
                        }
                    }
                    Button("Remove", role: .destructive) {
                        form.pendingRemoval = record
                    }
                    .disabled(record.id == ManagedExtensionState.uBlockOriginLiteID)
                }
            }
            .padding(8)
        }
    }

    @ViewBuilder
    private func extensionIcon(_ record: ExtensionRecord) -> some View {
        if let icon = runtime.context(for: record.id)?.webExtension.icon(for: CGSize(width: 42, height: 42)) {
            Image(nsImage: icon)
                .resizable()
                .scaledToFit()
                .frame(width: 42, height: 42)
        } else {
            Image(systemName: "puzzlepiece.extension.fill")
                .font(.title2)
                .foregroundStyle(.tint)
                .frame(width: 42, height: 42)
                .background(.tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private func sourceTitle(_ source: ExtensionRecord.Source) -> LocalizedStringKey {
        switch source {
        case .chromeWebStore:
            "Chrome Web Store"
        case .unpacked:
            "Unpacked"
        case .managed:
            "Managed by Orion"
        }
    }

    private func chooseExtensionPackage() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.zip, .data]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        form.isInstalling = true
        Task {
            defer { form.isInstalling = false }
            do {
                let manifest = try await runtime.inspect(sourceURL: url)
                guard ExtensionInstallReview.confirm(manifest) else { return }
                try await runtime.install(from: url)
            } catch {
                runtime.report(error)
            }
        }
    }

    private func installWebStoreID() {
        form.isInstalling = true
        let id = form.webStoreID
        Task {
            defer { form.isInstalling = false }
            do {
                try await runtime.installFromChromeWebStore(id: id)
                form.webStoreID = ""
            } catch {
                runtime.report(error)
            }
        }
    }
}

private extension View {
    func extensionBadgeStyle() -> some View {
        self
            .font(.caption.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.quaternary, in: Capsule())
    }
}
