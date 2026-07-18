import Foundation

enum BrowserPreferenceKeys {
    static let homepageURL = "orion.homepageURL"
    static let searchEngine = "orion.searchEngine"
    static let recordHistory = "orion.recordHistory"
    static let openNewTabsWithHomepage = "orion.openNewTabsWithHomepage"
    static let verticalTabs = "orion.verticalTabs"
    static let showBookmarksBar = "orion.showBookmarksBar"
    static let showSeconds = "orion.showSeconds"
    static let preferredColorScheme = "orion.preferredColorScheme"
    static let accentColor = "orion.accentColor"
    static let httpsOnlyMode = "orion.httpsOnlyMode"
    static let antiFingerprinting = "orion.antiFingerprinting"
    static let dnsOverHttpsEnabled = "orion.dnsOverHttpsEnabled"
    static let automaticTabUnloading = "orion.automaticTabUnloading"
    static let ramLimitMode = "orion.ramLimitMode"
    static let interfaceLanguage = "orion.interfaceLanguage"
    static let onboardingCompleted = "orion.onboardingCompleted"
    static let hiddenDefaultShortcuts = "orion.hiddenDefaultShortcuts"
    static let readerTheme = "orion.readerTheme"
    static let readerFontScale = "orion.readerFontScale"
}

enum BrowserPreferences {
    static let defaultHomePage = "https://www.google.com"

    static var homepageURL: String {
        let value = UserDefaults.standard.string(forKey: BrowserPreferenceKeys.homepageURL)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? defaultHomePage : value
    }

    static var searchEngine: SearchEngine {
        let rawValue = UserDefaults.standard.string(forKey: BrowserPreferenceKeys.searchEngine) ?? SearchEngine.google.rawValue
        return SearchEngine(rawValue: rawValue) ?? .google
    }

    static var recordHistory: Bool {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: BrowserPreferenceKeys.recordHistory) == nil {
            return true
        }
        return defaults.bool(forKey: BrowserPreferenceKeys.recordHistory)
    }

    static var openNewTabsWithHomepage: Bool {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: BrowserPreferenceKeys.openNewTabsWithHomepage) == nil {
            return false
        }
        return defaults.bool(forKey: BrowserPreferenceKeys.openNewTabsWithHomepage)
    }

    static var httpsOnlyMode: Bool {
        defaultEnabledValue(forKey: BrowserPreferenceKeys.httpsOnlyMode)
    }

    static var antiFingerprinting: Bool {
        defaultEnabledValue(forKey: BrowserPreferenceKeys.antiFingerprinting)
    }

    static var dnsOverHttpsEnabled: Bool {
        defaultEnabledValue(forKey: BrowserPreferenceKeys.dnsOverHttpsEnabled)
    }

    static var automaticTabUnloading: Bool {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: BrowserPreferenceKeys.automaticTabUnloading) == nil {
            return true
        }
        return defaults.bool(forKey: BrowserPreferenceKeys.automaticTabUnloading)
    }

    static var ramLimitMode: RAMLimitMode {
        let rawValue = UserDefaults.standard.string(forKey: BrowserPreferenceKeys.ramLimitMode)
        if let rawValue, let mode = RAMLimitMode(rawValue: rawValue) {
            return mode
        }
        return automaticTabUnloading ? .automatic : .off
    }

    static var interfaceLanguage: InterfaceLanguage {
        let rawValue = UserDefaults.standard.string(forKey: BrowserPreferenceKeys.interfaceLanguage)
        return rawValue.flatMap(InterfaceLanguage.init(rawValue:)) ?? .resolvedDefault
    }

    private static func defaultEnabledValue(forKey key: String) -> Bool {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: key) == nil {
            return true
        }
        return defaults.bool(forKey: key)
    }
}
