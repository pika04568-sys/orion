import Combine
import Foundation

@MainActor
final class ProfileSettingsFormState: ObservableObject {
    @Published var newProfileName = ""
    @Published var renameValues: [UUID: String] = [:]
}
