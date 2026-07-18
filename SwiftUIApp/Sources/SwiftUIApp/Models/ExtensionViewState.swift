import Combine
import Foundation

@MainActor
final class ExtensionManagerViewState: ObservableObject {
    @Published var webStoreID = ""
    @Published var isInstalling = false
    @Published var pendingRemoval: ExtensionRecord?
}

@MainActor
final class ExtensionInstallButtonState: ObservableObject {
    @Published var isInstalling = false
}
