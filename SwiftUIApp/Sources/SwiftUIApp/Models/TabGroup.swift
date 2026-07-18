import Foundation

struct TabGroup: Identifiable, Codable, Equatable, Hashable, Sendable {
    static let palette = [
        "#0F6BFF", "#7C4DFF", "#00A67E", "#E67E22",
        "#D64562", "#0097A7", "#795548", "#607D8B"
    ]

    let id: UUID
    var name: String
    var colorHex: String
    var isCollapsed: Bool
    let createdAt: Date

    init(
        id: UUID = UUID(),
        name: String,
        colorHex: String = TabGroup.palette[0],
        isCollapsed: Bool = false,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.colorHex = colorHex
        self.isCollapsed = isCollapsed
        self.createdAt = createdAt
    }
}
