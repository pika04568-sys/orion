import Combine
import Foundation
import WebKit

@MainActor
final class ProfileRuntime: ObservableObject {
    let profile: BrowserProfile
    let library: BrowserLibraryStore
    let sessionStore: BrowserSessionStore
    let encryptedDNSProxy = EncryptedDNSProxyRuntime()
    let permissions: WebsitePermissionStore

    private let profileDirectory: URL
    private var didLoad = false

    lazy var websiteDataStore = WKWebsiteDataStore(
        forIdentifier: profile.dataStoreIdentifier
    )

    private lazy var extensionComponents: (
        controller: WKWebExtensionController,
        delegate: WebExtensionControllerCoordinator,
        runtime: ExtensionRuntime
    ) = {
        let configuration = WKWebExtensionController.Configuration(
            identifier: profile.id
        )
        configuration.defaultWebsiteDataStore = websiteDataStore
        let controller = WKWebExtensionController(configuration: configuration)
        let delegate = WebExtensionControllerCoordinator()
        let runtime = ExtensionRuntime(
            profile: profile,
            controller: controller,
            rootDirectory: profileDirectory.appendingPathComponent(
                "Extensions",
                isDirectory: true
            )
        )
        delegate.runtime = runtime
        controller.delegate = delegate
        return (controller, delegate, runtime)
    }()

    var webExtensionController: WKWebExtensionController {
        extensionComponents.controller
    }

    var webExtensionDelegate: WebExtensionControllerCoordinator {
        extensionComponents.delegate
    }

    var extensions: ExtensionRuntime {
        extensionComponents.runtime
    }

    init(profile: BrowserProfile) {
        self.profile = profile
        let profileDirectory = ApplicationDirectories.profile(profile.id)
        self.profileDirectory = profileDirectory
        library = BrowserLibraryStore(storageDirectory: profileDirectory)
        sessionStore = BrowserSessionStore(storageDirectory: profileDirectory)
        permissions = WebsitePermissionStore(storageDirectory: profileDirectory)
    }

    func load() async {
        guard !didLoad else { return }
        didLoad = true
        await encryptedDNSProxy.start(for: websiteDataStore)
        async let libraryLoad: Void = library.load()
        async let extensionLoad: Void = extensions.load()
        async let permissionLoad: Void = permissions.load()
        _ = await (libraryLoad, extensionLoad, permissionLoad)
    }

    func makeWebView(isPrivate: Bool) -> WKWebView {
        WebViewEnvironment.makeWebView(
            profile: profile,
            isPrivate: isPrivate,
            websiteDataStore: isPrivate ? nil : websiteDataStore,
            webExtensionController: isPrivate ? nil : webExtensionController
        )
    }

    func shutdown() {
        extensions.shutdown()
        encryptedDNSProxy.stop(for: websiteDataStore)
    }
}
