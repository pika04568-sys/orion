import Foundation

struct MemoryTabSample: Equatable, Sendable {
    var id: UUID
    var estimatedBytes: UInt64
    var historicalPeakBytes: UInt64
    var lastActivatedAt: Date
    var isActive: Bool
    var isAudible: Bool
    var isPrivate: Bool
    var isUnloaded: Bool
}

struct MemoryStatus: Equatable, Sendable {
    var mode: RAMLimitMode
    var residentBytes: UInt64
    var estimatedWebKitBytes: UInt64
    var budgetBytes: UInt64
    var lastUnloadedTabID: UUID?

    static let idle = MemoryStatus(
        mode: .automatic,
        residentBytes: 0,
        estimatedWebKitBytes: 0,
        budgetBytes: ProcessInfo.processInfo.physicalMemory / 2,
        lastUnloadedTabID: nil
    )
}

enum AutomaticMemoryController {
    static func candidate(
        from samples: [MemoryTabSample],
        residentBytes: UInt64,
        budgetBytes: UInt64
    ) -> MemoryTabSample? {
        let estimatedWebKitBytes = samples
            .filter { !$0.isUnloaded }
            .reduce(UInt64.zero) { total, sample in
                total + max(sample.estimatedBytes, sample.historicalPeakBytes)
            }
        guard residentBytes + estimatedWebKitBytes > budgetBytes else { return nil }

        return samples
            .filter {
                !$0.isActive
                    && !$0.isAudible
                    && !$0.isPrivate
                    && !$0.isUnloaded
            }
            .sorted {
                if $0.lastActivatedAt != $1.lastActivatedAt {
                    return $0.lastActivatedAt < $1.lastActivatedAt
                }
                return max($0.estimatedBytes, $0.historicalPeakBytes)
                    > max($1.estimatedBytes, $1.historicalPeakBytes)
            }
            .first
    }
}
