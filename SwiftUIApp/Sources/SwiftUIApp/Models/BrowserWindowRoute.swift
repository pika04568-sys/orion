import Foundation

struct BrowserWindowRoute: Codable, Hashable, Identifiable, Sendable {
    enum Kind: String, Codable, Sendable {
        case normal
        case incognito
        case popup
        case extensionWindow
    }

    let id: UUID
    var kind: Kind
    var profileID: UUID?
    var initialURL: String?
    var extensionID: String?

    init(
        id: UUID = UUID(),
        kind: Kind,
        profileID: UUID? = nil,
        initialURL: String? = nil,
        extensionID: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.profileID = profileID
        self.initialURL = initialURL
        self.extensionID = extensionID
    }

    static func normal(
        profileID: UUID = BrowserProfile.defaultID,
        initialURL: String? = nil
    ) -> BrowserWindowRoute {
        BrowserWindowRoute(kind: .normal, profileID: profileID, initialURL: initialURL)
    }

    static func incognito(initialURL: String? = nil) -> BrowserWindowRoute {
        BrowserWindowRoute(kind: .incognito, initialURL: initialURL)
    }

    static func extensionWindow(
        profileID: UUID,
        extensionID: String,
        initialURL: String?
    ) -> BrowserWindowRoute {
        BrowserWindowRoute(
            kind: .extensionWindow,
            profileID: profileID,
            initialURL: initialURL,
            extensionID: extensionID
        )
    }

    var isPrivate: Bool {
        kind == .incognito
    }
}
