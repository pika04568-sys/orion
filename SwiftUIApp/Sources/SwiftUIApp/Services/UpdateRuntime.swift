import Combine
import Foundation

@MainActor
final class UpdateRuntime: ObservableObject {
    @Published private(set) var state: UpdateCheckState = .idle

    let currentVersion: String

    init(currentVersion: String = Bundle.main.object(
        forInfoDictionaryKey: "CFBundleShortVersionString"
    ) as? String ?? "1.1.0") {
        self.currentVersion = currentVersion
    }

    func check() async {
        guard state != .checking else { return }
        state = .checking
        do {
            let release = try await UpdateChecker.latestRelease()
            let current = SemanticVersion(currentVersion)
            let latest = SemanticVersion(release.tagName)
            if let current, let latest, latest > current {
                state = .available(version: release.tagName, release.htmlURL)
            } else {
                state = .current(currentVersion)
            }
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
