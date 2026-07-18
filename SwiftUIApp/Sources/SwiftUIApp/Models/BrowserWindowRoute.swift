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

    init(
        id: UUID = UUID(),
        kind: Kind,
        profileID: UUID? = nil,
        initialURL: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.profileID = profileID
        self.initialURL = initialURL
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

    var isPrivate: Bool {
        kind == .incognito
    }
}
