import SwiftUI

struct OfflineArcadeView: View {
    let targetURLString: String
    let game: OfflineGame
    let retry: () -> Void

    @State private var score = 0
    @State private var playerOffset: CGFloat = 0

    var body: some View {
        VStack(spacing: 22) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 50, weight: .light))
            Text("You're Offline")
                .font(.largeTitle.bold())
            Text(URL(string: targetURLString)?.host ?? targetURLString)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Button("Try Again", action: retry)
                .buttonStyle(.borderedProminent)

            VStack(spacing: 12) {
                HStack {
                    Label(game.title, systemImage: gameIcon)
                        .font(.headline)
                    Spacer()
                    Text("Score \(score)")
                        .monospacedDigit()
                }

                GeometryReader { geometry in
                    ZStack(alignment: .bottom) {
                        RoundedRectangle(cornerRadius: 14)
                            .fill(Color.black.opacity(0.72))
                        Image(systemName: gameIcon)
                            .font(.system(size: 34))
                            .foregroundStyle(.green)
                            .offset(x: playerOffset)
                            .padding(.bottom, 20)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { location in
                        playerOffset = min(
                            geometry.size.width / 2 - 32,
                            max(-geometry.size.width / 2 + 32, location.x - geometry.size.width / 2)
                        )
                        score += 1
                    }
                }
                .frame(height: 220)

                Text("Click inside the arcade to move and score.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(18)
            .frame(maxWidth: 620)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                colors: [Color.indigo.opacity(0.28), Color.black.opacity(0.06)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
    }

    private var gameIcon: String {
        switch game {
        case .snake: "waveform.path"
        case .tetris: "square.grid.3x3.fill"
        case .pacman: "circle.lefthalf.filled"
        }
    }
}
