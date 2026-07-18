import Foundation

struct BrowserProfile: Identifiable, Codable, Equatable, Hashable, Sendable {
    static let defaultID = UUID(uuidString: "4F52494F-4E00-4000-8000-000000000001")!
    static let defaultDataStoreID = UUID(uuidString: "4F52494F-4E00-4000-8000-000000000002")!

    static let defaultProfile = BrowserProfile(
        id: defaultID,
        name: "Default",
        dataStoreIdentifier: defaultDataStoreID,
        createdAt: .distantPast
    )

    let id: UUID
    var name: String
    let dataStoreIdentifier: UUID
    let createdAt: Date

    init(
        id: UUID = UUID(),
        name: String,
        dataStoreIdentifier: UUID = UUID(),
        createdAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.dataStoreIdentifier = dataStoreIdentifier
        self.createdAt = createdAt
    }
}
