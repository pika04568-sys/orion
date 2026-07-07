import SwiftUI

enum OrionVisualStyle {
    static func pageBackground(for scheme: ColorScheme) -> LinearGradient {
        if scheme == .dark {
            return LinearGradient(
                colors: [Color(red: 0.06, green: 0.11, blue: 0.20), Color(red: 0.04, green: 0.08, blue: 0.15)],
                startPoint: .top,
                endPoint: .bottom
            )
        }

        return LinearGradient(
            colors: [Color(red: 0.97, green: 0.98, blue: 1.0), Color(red: 0.94, green: 0.96, blue: 0.99)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    static func chromeBackground(for scheme: ColorScheme) -> LinearGradient {
        if scheme == .dark {
            return LinearGradient(
                colors: [Color(red: 0.07, green: 0.12, blue: 0.22).opacity(0.96), Color(red: 0.06, green: 0.10, blue: 0.19).opacity(0.82)],
                startPoint: .top,
                endPoint: .bottom
            )
        }

        return LinearGradient(
            colors: [Color.white.opacity(0.92), Color(red: 0.96, green: 0.98, blue: 1.0).opacity(0.78)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    static func buttonFace(for scheme: ColorScheme, active: Bool = false) -> LinearGradient {
        if active {
            return LinearGradient(
                colors: [Color(red: 0.45, green: 0.70, blue: 1.0), Color(red: 0.08, green: 0.39, blue: 0.84)],
                startPoint: .top,
                endPoint: .bottom
            )
        }

        if scheme == .dark {
            return LinearGradient(
                colors: [Color(red: 0.18, green: 0.29, blue: 0.45), Color(red: 0.10, green: 0.18, blue: 0.30)],
                startPoint: .top,
                endPoint: .bottom
            )
        }

        return LinearGradient(
            colors: [Color.white, Color(red: 0.86, green: 0.93, blue: 1.0), Color(red: 0.68, green: 0.81, blue: 0.96)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    static func addressBackground(for scheme: ColorScheme) -> LinearGradient {
        if scheme == .dark {
            return LinearGradient(
                colors: [Color(red: 0.08, green: 0.13, blue: 0.24).opacity(0.88), Color(red: 0.10, green: 0.16, blue: 0.28).opacity(0.68)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }

        return LinearGradient(
            colors: [Color.white.opacity(0.84), Color.white.opacity(0.58)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static func tabBackground(for scheme: ColorScheme, active: Bool) -> Color {
        if scheme == .dark {
            return active
                ? Color(red: 0.12, green: 0.20, blue: 0.32)
                : Color(red: 0.08, green: 0.15, blue: 0.25)
        }

        return active
            ? Color.white.opacity(0.96)
            : Color(red: 0.95, green: 0.98, blue: 1.0).opacity(0.92)
    }

    static func border(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.17, green: 0.27, blue: 0.41) : Color(red: 0.84, green: 0.90, blue: 0.96)
    }

    static func primaryText(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.95, green: 0.97, blue: 1.0) : Color(red: 0.06, green: 0.13, blue: 0.23)
    }

    static func secondaryText(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.60, green: 0.70, blue: 0.82) : Color(red: 0.37, green: 0.45, blue: 0.55)
    }

    static var accent: Color {
        Color(red: 0.06, green: 0.42, blue: 1.0)
    }
}

struct OrionIconButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme
    var active = false
    var size: CGFloat = 34

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .labelStyle(.iconOnly)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(active ? Color.white : OrionVisualStyle.primaryText(for: colorScheme))
            .frame(width: size, height: size)
            .background {
                RoundedRectangle(cornerRadius: 11)
                    .fill(OrionVisualStyle.buttonFace(for: colorScheme, active: active))
                    .overlay(alignment: .top) {
                        RoundedRectangle(cornerRadius: 11)
                            .stroke(Color.white.opacity(colorScheme == .dark ? 0.12 : 0.82), lineWidth: 1)
                    }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 11)
                    .stroke(
                        active
                            ? Color(red: 0.13, green: 0.34, blue: 0.70)
                            : OrionVisualStyle.border(for: colorScheme).opacity(colorScheme == .dark ? 0.72 : 0.9),
                        lineWidth: 1
                    )
            }
            .shadow(color: Color.black.opacity(colorScheme == .dark ? 0.28 : 0.12), radius: 8, y: 4)
            .opacity(configuration.isPressed ? 0.82 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}
