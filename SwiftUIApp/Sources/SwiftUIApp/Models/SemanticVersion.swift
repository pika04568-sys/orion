import Foundation

struct SemanticVersion: Comparable, Equatable, Sendable {
    var major: Int
    var minor: Int
    var patch: Int
    var prerelease: [String]

    init?(_ rawValue: String) {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let withoutPrefix = trimmed.hasPrefix("v") ? String(trimmed.dropFirst()) : trimmed
        let versionAndBuild = withoutPrefix.split(separator: "+", maxSplits: 1)
        let coreAndPrerelease = versionAndBuild[0].split(separator: "-", maxSplits: 1)
        let components = coreAndPrerelease[0].split(separator: ".")
        guard (1...3).contains(components.count),
              let major = Int(components[0]),
              let minor = components.count > 1 ? Int(components[1]) : 0,
              let patch = components.count > 2 ? Int(components[2]) : 0
        else {
            return nil
        }
        self.major = major
        self.minor = minor
        self.patch = patch
        prerelease = coreAndPrerelease.count > 1
            ? coreAndPrerelease[1].split(separator: ".").map(String.init)
            : []
    }

    static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        let lhsCore = [lhs.major, lhs.minor, lhs.patch]
        let rhsCore = [rhs.major, rhs.minor, rhs.patch]
        if lhsCore != rhsCore {
            return lhsCore.lexicographicallyPrecedes(rhsCore)
        }
        if lhs.prerelease.isEmpty != rhs.prerelease.isEmpty {
            return !lhs.prerelease.isEmpty
        }
        for (left, right) in zip(lhs.prerelease, rhs.prerelease) where left != right {
            if let leftNumber = Int(left), let rightNumber = Int(right) {
                return leftNumber < rightNumber
            }
            if Int(left) != nil { return true }
            if Int(right) != nil { return false }
            return left < right
        }
        return lhs.prerelease.count < rhs.prerelease.count
    }
}
