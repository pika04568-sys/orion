import Combine
import Foundation

@MainActor
final class WebsitePermissionStore: ObservableObject {
    @Published private(set) var decisions: [WebsitePermissionDecision] = []

    private let store: JSONFileStore<[WebsitePermissionDecision]>
    private let isPersistent: Bool
    private var didLoad = false

    init(storageDirectory: URL? = nil, isPersistent: Bool = true) {
        store = JSONFileStore(
            filename: "website-permissions.json",
            storageDirectory: storageDirectory
        )
        self.isPersistent = isPersistent
    }

    func load() async {
        guard !didLoad else { return }
        didLoad = true
        decisions = isPersistent ? await store.load(defaultValue: []) : []
    }

    func decision(origin: String, permission: String) -> WebsitePermissionDecision.Value {
        decisions.first {
            $0.origin == origin && $0.permission == permission
        }?.value ?? .ask
    }

    func set(
        _ value: WebsitePermissionDecision.Value,
        origin: String,
        permission: String
    ) {
        decisions.removeAll {
            $0.origin == origin && $0.permission == permission
        }
        decisions.append(
            WebsitePermissionDecision(
                origin: origin,
                permission: permission,
                value: value,
                updatedAt: Date()
            )
        )
        guard isPersistent else { return }
        let snapshot = decisions
        Task { try? await store.save(snapshot) }
    }

    func remove(origin: String, permission: String) {
        decisions.removeAll {
            $0.origin == origin && $0.permission == permission
        }
        persist()
    }

    func clear() {
        decisions.removeAll()
        persist()
    }

    private func persist() {
        guard isPersistent else { return }
        let snapshot = decisions
        Task { try? await store.save(snapshot) }
    }
}
