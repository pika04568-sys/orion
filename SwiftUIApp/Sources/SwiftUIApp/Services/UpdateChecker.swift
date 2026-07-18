import Foundation

struct OrionRelease: Decodable, Sendable {
    let tagName: String
    let htmlURL: URL

    private enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case htmlURL = "html_url"
    }
}

enum UpdateCheckState: Equatable, Sendable {
    case idle
    case checking
    case current(String)
    case available(version: String, URL)
    case failed(String)
}

enum UpdateChecker {
    static let releasesURL = URL(string: "https://api.github.com/repos/pika04568-sys/orion/releases/latest")!

    static func latestRelease(session: URLSession = .shared) async throws -> OrionRelease {
        var request = URLRequest(url: releasesURL)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("Orion-SwiftUI", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode)
        else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(OrionRelease.self, from: data)
    }
}
