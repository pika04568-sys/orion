import Foundation

enum TabGroupOrganizer {
    struct Candidate: Sendable {
        let tabID: UUID
        let title: String
        let urlString: String
    }

    struct SuggestedGroup: Equatable, Sendable {
        let name: String
        let tabIDs: [UUID]
    }

    static func organize(_ candidates: [Candidate]) -> [SuggestedGroup] {
        let grouped = Dictionary(grouping: candidates) { candidate in
            siteName(for: candidate.urlString)
        }

        return grouped
            .filter { !$0.key.isEmpty && $0.value.count >= 2 }
            .map { key, members in
                SuggestedGroup(
                    name: key,
                    tabIDs: members.map(\.tabID)
                )
            }
            .sorted {
                if $0.tabIDs.count == $1.tabIDs.count {
                    return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                }
                return $0.tabIDs.count > $1.tabIDs.count
            }
    }

    private static func siteName(for urlString: String) -> String {
        guard var host = URL(string: urlString)?.host?.lowercased(), !host.isEmpty else {
            return ""
        }
        if host.hasPrefix("www.") {
            host.removeFirst(4)
        }
        let components = host.split(separator: ".")
        let token = components.count >= 2 ? components[components.count - 2] : components[0]
        return token
            .replacingOccurrences(of: "-", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}
