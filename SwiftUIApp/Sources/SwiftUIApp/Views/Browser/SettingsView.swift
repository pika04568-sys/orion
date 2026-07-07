import SwiftUI

struct SettingsView: View {
    @AppStorage(BrowserPreferenceKeys.homepageURL) private var homepageURL = BrowserPreferences.defaultHomePage
    @AppStorage(BrowserPreferenceKeys.searchEngine) private var searchEngineRawValue = SearchEngine.google.rawValue
    @AppStorage(BrowserPreferenceKeys.recordHistory) private var recordHistory = true
    @AppStorage(BrowserPreferenceKeys.openNewTabsWithHomepage) private var openNewTabsWithHomepage = true

    var body: some View {
        TabView {
            Form {
                TextField("Home page", text: $homepageURL)

                Picker("Search engine", selection: $searchEngineRawValue) {
                    ForEach(SearchEngine.allCases) { engine in
                        Text(engine.displayName)
                            .tag(engine.rawValue)
                    }
                }

                Toggle("Open new tabs with home page", isOn: $openNewTabsWithHomepage)
            }
            .formStyle(.grouped)
            .padding()
            .tabItem {
                Label("General", systemImage: "gearshape")
            }

            Form {
                Toggle("Record browsing history", isOn: $recordHistory)
            }
            .formStyle(.grouped)
            .padding()
            .tabItem {
                Label("Privacy", systemImage: "hand.raised")
            }
        }
        .frame(width: 500, height: 260)
    }
}
