import SwiftUI

struct LanguageOnboardingView: View {
    @AppStorage(BrowserPreferenceKeys.interfaceLanguage) private var language = InterfaceLanguage.resolvedDefault.rawValue
    @AppStorage(BrowserPreferenceKeys.onboardingCompleted) private var onboardingCompleted = false

    var body: some View {
        VStack(spacing: 22) {
            Image(systemName: "globe")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(.tint)
            Text("Welcome to Orion")
                .font(.largeTitle.bold())
            Text("Choose the language used by the browser. You can change it later in Settings.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 400)
            Picker("Language", selection: $language) {
                ForEach(InterfaceLanguage.allCases) { option in
                    Text(option.displayName).tag(option.rawValue)
                }
            }
            .pickerStyle(.radioGroup)
            .frame(maxWidth: 260, alignment: .leading)
            Button("Continue") {
                onboardingCompleted = true
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(42)
        .frame(width: 520, height: 440)
        .environment(\.locale, Locale(identifier: language))
        .interactiveDismissDisabled()
    }
}

struct ProfileMenuView: View {
    @ObservedObject var profileStore: ProfileStore
    let activeProfile: BrowserProfile
    let isPrivate: Bool
    let openProfile: (BrowserProfile) -> Void
    let createProfile: () -> Void

    var body: some View {
        Menu {
            if isPrivate {
                Label("Private Browsing", systemImage: "hand.raised.fill")
                Divider()
            }
            ForEach(profileStore.profiles) { profile in
                Button {
                    openProfile(profile)
                } label: {
                    if profile.id == activeProfile.id, !isPrivate {
                        Label(profile.name, systemImage: "checkmark")
                    } else {
                        Text(profile.name)
                    }
                }
            }
            Divider()
            Button("Create Profile", systemImage: "person.badge.plus", action: createProfile)
            SettingsLink {
                Label("Manage Profiles", systemImage: "gearshape")
            }
        } label: {
            Label(
                isPrivate ? "Private" : activeProfile.name,
                systemImage: isPrivate ? "hand.raised.fill" : "person.crop.circle.fill"
            )
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .padding(.trailing, 10)
    }
}
