import Foundation

enum InterfaceLanguage: String, Codable, CaseIterable, Identifiable, Sendable {
    case english = "en"
    case french = "fr"
    case german = "de"
    case japanese = "ja"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .english:
            "English"
        case .french:
            "Français"
        case .german:
            "Deutsch"
        case .japanese:
            "日本語"
        }
    }

    static var resolvedDefault: InterfaceLanguage {
        let preferred = Locale.preferredLanguages.first?
            .split(separator: "-")
            .first
            .map(String.init)
        return InterfaceLanguage(rawValue: preferred ?? "") ?? .english
    }
}

enum RAMLimitMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case off
    case automatic

    var id: String { rawValue }

    var title: String {
        switch self {
        case .off: "Off"
        case .automatic: "Automatic"
        }
    }
}

enum OrionAccent: String, Codable, CaseIterable, Identifiable, Sendable {
    case blue
    case purple
    case pink
    case orange
    case green
    case graphite

    var id: String { rawValue }

    var title: String {
        rawValue.capitalized
    }
}

struct BrowserSettings: Codable, Equatable, Sendable {
    var homepageURL: String
    var searchEngine: SearchEngine
    var verticalTabs: Bool
    var showBookmarksBar: Bool
    var showSeconds: Bool
    var preferredColorScheme: String
    var accent: OrionAccent
    var httpsOnlyMode: Bool
    var antiFingerprinting: Bool
    var dnsOverHttpsEnabled: Bool
    var ramLimitMode: RAMLimitMode
    var interfaceLanguage: InterfaceLanguage
    var onboardingCompleted: Bool

    static let defaults = BrowserSettings(
        homepageURL: BrowserPreferences.defaultHomePage,
        searchEngine: .google,
        verticalTabs: false,
        showBookmarksBar: true,
        showSeconds: false,
        preferredColorScheme: "system",
        accent: .blue,
        httpsOnlyMode: true,
        antiFingerprinting: true,
        dnsOverHttpsEnabled: true,
        ramLimitMode: .automatic,
        interfaceLanguage: .resolvedDefault,
        onboardingCompleted: false
    )
}
