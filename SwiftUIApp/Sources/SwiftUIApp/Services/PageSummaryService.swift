import Foundation

enum PageSummaryService {
    struct Source: Sendable {
        let title: String
        let host: String
        let text: String
    }

    static func summarize(_ source: Source, maximumBullets: Int = 5) -> PageSummary? {
        let sentences = splitSentences(source.text)
            .filter { $0.count >= 45 }
        guard !sentences.isEmpty else { return nil }

        let frequencies = wordFrequencies(in: sentences)
        let ranked: [(index: Int, sentence: String, score: Double)] = sentences.enumerated().map { index, sentence in
            let words = tokens(in: sentence)
            let score = words.reduce(0.0) { $0 + frequencies[$1, default: 0] }
                / Double(max(words.count, 1))
            return (index: index, sentence: sentence, score: score)
        }
        .sorted { left, right in
            if left.score == right.score { return left.index < right.index }
            return left.score > right.score
        }

        var selected: [(index: Int, sentence: String)] = []
        for candidate in ranked {
            guard !selected.contains(where: {
                similarity(tokens(in: $0.sentence), tokens(in: candidate.sentence)) > 0.72
            }) else {
                continue
            }
            selected.append((candidate.index, candidate.sentence))
            if selected.count == maximumBullets { break }
        }

        let bullets = selected
            .sorted { $0.index < $1.index }
            .map { normalizedSentence($0.sentence) }
        guard !bullets.isEmpty else { return nil }

        let wordCount = tokens(in: source.text).count
        return PageSummary(
            title: source.title,
            source: source.host,
            bullets: bullets,
            readingTimeMinutes: max(1, Int(ceil(Double(wordCount) / 220.0)))
        )
    }

    private static func splitSentences(_ text: String) -> [String] {
        text
            .replacingOccurrences(of: "\n", with: " ")
            .split(whereSeparator: { ".!?".contains($0) })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private static func wordFrequencies(in sentences: [String]) -> [String: Double] {
        var frequencies: [String: Double] = [:]
        for word in sentences.flatMap({ tokens(in: $0) }) where !stopWords.contains(word) {
            frequencies[word, default: 0] += 1
        }
        let maximum = frequencies.values.max() ?? 1
        return frequencies.mapValues { $0 / maximum }
    }

    private static func tokens(in text: String) -> [String] {
        text.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count >= 3 }
    }

    private static func similarity(_ left: [String], _ right: [String]) -> Double {
        let lhs = Set(left)
        let rhs = Set(right)
        guard !lhs.isEmpty, !rhs.isEmpty else { return 0 }
        return Double(lhs.intersection(rhs).count) / Double(lhs.union(rhs).count)
    }

    private static func normalizedSentence(_ sentence: String) -> String {
        let trimmed = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let last = trimmed.last, !".!?".contains(last) else { return trimmed }
        return trimmed + "."
    }

    private static let stopWords: Set<String> = [
        "the", "and", "for", "that", "with", "this", "from", "are", "was",
        "were", "have", "has", "had", "but", "not", "you", "your", "into",
        "about", "their", "they", "its", "can", "will", "would", "could"
    ]
}
