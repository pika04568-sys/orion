import Foundation

enum BrowserPreferenceKeys {
    static let homepageURL = "orion.homepageURL"
    static let searchEngine = "orion.searchEngine"
    static let recordHistory = "orion.recordHistory"
    static let openNewTabsWithHomepage = "orion.openNewTabsWithHomepage"
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
            return true
        }
        return defaults.bool(forKey: BrowserPreferenceKeys.openNewTabsWithHomepage)
    }
}
