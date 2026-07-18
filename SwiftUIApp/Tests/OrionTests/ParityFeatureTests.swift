import Foundation
import Testing
@testable import Orion

@Suite(.serialized)
final class ParityFeatureTests {
    @Test
    func testLegacyBookmarkMigratesToBar() throws {
        let data = Data(
            """
            {
              "id": "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
              "title": "Legacy",
              "urlString": "https://example.com",
              "date": "2024-01-01T00:00:00Z"
            }
            """.utf8
        )
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let bookmark = try decoder.decode(BrowserBookmark.self, from: data)
        XCTAssertEqual(bookmark.destinations, [.bar])
    }

    @Test
    func testBookmarkDestinationsSupportBothSurfaces() {
        let bookmark = BrowserBookmark(
            title: "Example",
            urlString: "https://example.com",
            destinations: [.bar, .newTab]
        )
        XCTAssertTrue(bookmark.destinations.contains(.bar))
        XCTAssertTrue(bookmark.destinations.contains(.newTab))
    }

    @Test
    func testOfflineRotationNeverRepeatsImmediately() {
        var rotation = OfflineGameRotation()
        let first = rotation.next { _ in 0 }
        let second = rotation.next { _ in 0 }
        let third = rotation.next { _ in 0 }
        XCTAssertNotEqual(first, second)
        XCTAssertNotEqual(second, third)
    }

    @Test
    func testMemoryControllerUsesEligibleLRUTab() {
        let now = Date()
        let samples = [
            MemoryTabSample(
                id: UUID(),
                estimatedBytes: 200,
                historicalPeakBytes: 250,
                lastActivatedAt: now.addingTimeInterval(-100),
                isActive: true,
                isAudible: false,
                isPrivate: false,
                isUnloaded: false
            ),
            MemoryTabSample(
                id: UUID(),
                estimatedBytes: 200,
                historicalPeakBytes: 220,
                lastActivatedAt: now.addingTimeInterval(-90),
                isActive: false,
                isAudible: true,
                isPrivate: false,
                isUnloaded: false
            ),
            MemoryTabSample(
                id: UUID(),
                estimatedBytes: 200,
                historicalPeakBytes: 300,
                lastActivatedAt: now.addingTimeInterval(-80),
                isActive: false,
                isAudible: false,
                isPrivate: false,
                isUnloaded: false
            )
        ]
        let selected = AutomaticMemoryController.candidate(
            from: samples,
            residentBytes: 800,
            budgetBytes: 1_000
        )
        XCTAssertEqual(selected?.id, samples[2].id)
    }

    @Test
    func testSemanticVersionsComparePrereleasesAndPrefixes() {
        XCTAssertEqual(SemanticVersion("v1.1.0"), SemanticVersion("1.1.0"))
        XCTAssertGreaterThan(SemanticVersion("1.1.1")!, SemanticVersion("1.1.0")!)
        XCTAssertLessThan(SemanticVersion("1.1.0-beta.2")!, SemanticVersion("1.1.0")!)
        XCTAssertGreaterThan(SemanticVersion("1.1.0-beta.10")!, SemanticVersion("1.1.0-beta.2")!)
    }

    @Test
    func testReaderSnapshotProvidesFrozenSummaryText() {
        let snapshot = ReaderSnapshot(
            sourceURLString: "https://example.com/article",
            title: "Article",
            site: "Example",
            blocks: [
                .init(kind: .heading, text: "Heading"),
                .init(kind: .paragraph, text: "Body copy")
            ],
            images: []
        )
        XCTAssertEqual(snapshot.plainText, "Heading\n\nBody copy")
    }

    @Test
    func testElectronSearchChoicesArePresent() {
        XCTAssertTrue(SearchEngine.allCases.contains(.ecosia))
        XCTAssertTrue(SearchEngine.allCases.contains(.yahooJapan))
        XCTAssertTrue(SearchEngine.allCases.contains(.yandexJapan))
        XCTAssertGreaterThanOrEqual(SearchEngine.allCases.count, 12)
    }

    @Test
    func testManagedExtensionOnlyPermitsNavigationWhenReady() {
        XCTAssertFalse(ManagedExtensionState.idle.permitsRemoteNavigation)
        XCTAssertFalse(ManagedExtensionState.installing.permitsRemoteNavigation)
        XCTAssertFalse(ManagedExtensionState.failed(message: "offline").permitsRemoteNavigation)
        XCTAssertTrue(ManagedExtensionState.ready(version: "1").permitsRemoteNavigation)
    }

    @Test
    func testManagedProtectionGateOnlyQueuesRemoteNavigation() {
        XCTAssertTrue(
            RemoteNavigationPolicy.requiresManagedProtection(
                URL(string: "https://example.com")!
            )
        )
        XCTAssertFalse(
            RemoteNavigationPolicy.requiresManagedProtection(
                URL(string: "http://127.0.0.1:8080/fixture")!
            )
        )
        XCTAssertFalse(
            RemoteNavigationPolicy.requiresManagedProtection(
                URL(string: "http://localhost/fixture")!
            )
        )
        XCTAssertFalse(
            RemoteNavigationPolicy.requiresManagedProtection(
                URL(string: "https://printer.local/status")!
            )
        )
        XCTAssertTrue(
            RemoteNavigationPolicy.requiresManagedProtection(
                URL(string: "https://192.0.2.1/status")!
            )
        )
    }

    @Test
    func testChromeWebStoreResolverFindsModernAndLegacyDetailURLs() {
        let id = "abcdefghijklmnopabcdefghijklmnop"
        XCTAssertEqual(
            ChromeWebStoreResolver.extensionID(
                from: "https://chromewebstore.google.com/detail/example/\(id)"
            ),
            id
        )
        XCTAssertEqual(
            ChromeWebStoreResolver.extensionID(
                from: "https://chrome.google.com/webstore/detail/\(id)"
            ),
            id
        )
        XCTAssertNil(
            ChromeWebStoreResolver.extensionID(
                from: "https://example.com/detail/example/\(id)"
            )
        )
        XCTAssertFalse(ChromeWebStoreResolver.isExtensionID("not-an-extension"))
    }

    @Test
    func testLegacyExtensionRecordDefaultsPermissionGrants() throws {
        let data = Data(
            """
            {
              "id": "fixture",
              "name": "Fixture",
              "version": "1.0",
              "source": "unpacked",
              "rootPath": "/tmp/fixture",
              "permissions": ["storage"],
              "isEnabled": true,
              "isPinned": false,
              "installedAt": 0
            }
            """.utf8
        )
        let record = try JSONDecoder().decode(ExtensionRecord.self, from: data)
        XCTAssertEqual(record.grantedPermissions, [])
        XCTAssertEqual(record.deniedPermissions, [])
        XCTAssertEqual(record.grantedHosts, [])
        XCTAssertEqual(record.deniedHosts, [])
        XCTAssertEqual(record.grantedMatchPatterns, [])
        XCTAssertEqual(record.deniedMatchPatterns, [])
    }

    @Test
    func testExtensionWindowRouteCarriesProfileAndContext() {
        let profileID = UUID()
        let route = BrowserWindowRoute.extensionWindow(
            profileID: profileID,
            extensionID: "extension-id",
            initialURL: "webkit-extension://fixture/options.html"
        )
        XCTAssertEqual(route.kind, .extensionWindow)
        XCTAssertEqual(route.profileID, profileID)
        XCTAssertEqual(route.extensionID, "extension-id")
        XCTAssertFalse(route.isPrivate)
    }

    @Test @MainActor
    func testWebsitePermissionDecisionsCanBeChangedForgottenAndCleared() async {
        let store = WebsitePermissionStore(isPersistent: false)
        await store.load()
        store.set(.allow, origin: "https://example.com", permission: "camera")
        store.set(.deny, origin: "https://example.com", permission: "microphone")
        XCTAssertEqual(store.decisions.count, 2)
        XCTAssertEqual(
            store.decision(origin: "https://example.com", permission: "camera"),
            .allow
        )

        store.remove(origin: "https://example.com", permission: "camera")
        XCTAssertEqual(
            store.decision(origin: "https://example.com", permission: "camera"),
            .ask
        )
        store.clear()
        XCTAssertTrue(store.decisions.isEmpty)
    }

    @Test @MainActor
    func testExtensionsAliasRoutesToNativeSurface() {
        let state = BrowserState(
            library: BrowserLibraryStore(isPersistent: false),
            initialURL: nil
        )
        state.load("chrome://extensions")
        XCTAssertEqual(state.activeTab?.surface, .extensions)
        XCTAssertEqual(
            state.activeTab?.addressText,
            BrowserSurface.extensions.displayURLString
        )
    }

    @Test
    func testExtensionInspectorReportsPermissionsAndUnsupportedAPIs() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("OrionExtension-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let manifest = Data(
            """
            {
              "manifest_version": 3,
              "name": "Fixture",
              "version": "1.2.3",
              "permissions": ["storage", "nativeMessaging"],
              "host_permissions": ["https://example.com/*"]
            }
            """.utf8
        )
        try manifest.write(to: directory.appendingPathComponent("manifest.json"))

        let inspected = try ExtensionManifestInspector.inspect(directory: directory)
        XCTAssertEqual(inspected.name, "Fixture")
        XCTAssertEqual(inspected.permissions, ["nativeMessaging", "storage"])
        XCTAssertEqual(inspected.unsupportedAPIs, ["nativeMessaging"])
    }

    @Test
    func testSettingsPrivacyDefaultsAreEnabled() {
        let defaults = BrowserSettings.defaults
        XCTAssertTrue(defaults.httpsOnlyMode)
        XCTAssertTrue(defaults.antiFingerprinting)
        XCTAssertTrue(defaults.dnsOverHttpsEnabled)
        XCTAssertEqual(defaults.ramLimitMode, .automatic)
    }

    @Test
    func testSOCKSBufferRebasesAfterFragmentedFrameConsumption() {
        var buffer = SOCKS5ByteBuffer()
        let slicedInput = Data([0xff, 0x05, 0x01, 0x02, 0x01, 0x04, 0x75, 0x73, 0x65, 0x72])
            .dropFirst()
        buffer.append(Data(slicedInput))

        XCTAssertEqual(buffer.byte(at: 0), 0x05)
        XCTAssertEqual(buffer.bytes(in: 2..<3), Data([0x02]))
        buffer.consume(3)

        XCTAssertEqual(buffer.byte(at: 0), 0x01)
        XCTAssertEqual(buffer.byte(at: 1), 0x04)
        XCTAssertEqual(buffer.bytes(in: 2..<6), Data("user".utf8))
    }
}
