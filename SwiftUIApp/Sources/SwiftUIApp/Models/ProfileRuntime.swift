import Combine
import Foundation
import WebKit

@MainActor
final class ProfileRuntime: ObservableObject {
    let profile: BrowserProfile
    let websiteDataStore: WKWebsiteDataStore
    let webExtensionController: WKWebExtensionController
    let library: BrowserLibraryStore
    let sessionStore: BrowserSessionStore
    let extensions: ExtensionRuntime

    private var didLoad = false

    init(profile: BrowserProfile) {
        self.profile = profile
        let profileDirectory = ApplicationDirectories.profile(profile.id)
        websiteDataStore = WKWebsiteDataStore(forIdentifier: profile.dataStoreIdentifier)
        let controllerConfiguration = WKWebExtensionController.Configuration(
            identifier: profile.id
        )
        controllerConfiguration.defaultWebsiteDataStore = websiteDataStore
        webExtensionController = WKWebExtensionController(
            configuration: controllerConfiguration
        )
        library = BrowserLibraryStore(storageDirectory: profileDirectory)
        sessionStore = BrowserSessionStore(storageDirectory: profileDirectory)
        extensions = ExtensionRuntime(
            profile: profile,
            controller: webExtensionController,
            rootDirectory: profileDirectory.appendingPathComponent("Extensions", isDirectory: true)
        )
    }

    func load() async {
        guard !didLoad else { return }
        didLoad = true
        async let libraryLoad: Void = library.load()
        async let extensionLoad: Void = extensions.load()
        _ = await (libraryLoad, extensionLoad)
    }

    func makeWebView(isPrivate: Bool) -> WKWebView {
        WebViewEnvironment.makeWebView(
            profile: profile,
            isPrivate: isPrivate,
            websiteDataStore: isPrivate ? nil : websiteDataStore,
            webExtensionController: isPrivate ? nil : webExtensionController
        )
    }
}
