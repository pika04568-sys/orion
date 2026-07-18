import Combine
import Foundation

@MainActor
final class TabGroupRenameState: ObservableObject {
    @Published var groupID: UUID?
    @Published var groupName = ""
}
