import Foundation

enum SearchEngine: String, CaseIterable, Codable, Identifiable {
    case google
    case duckDuckGo
    case bing
    case brave
    case startpage

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .google:
            "Google"
        case .duckDuckGo:
            "DuckDuckGo"
        case .bing:
            "Bing"
        case .brave:
            "Brave"
        case .startpage:
            "Startpage"
        }
    }

    func searchURL(for query: String) -> URL {
        var components: URLComponents

        switch self {
        case .google:
            components = URLComponents(string: "https://www.google.com/search")!
        case .duckDuckGo:
            components = URLComponents(string: "https://duckduckgo.com/")!
        case .bing:
            components = URLComponents(string: "https://www.bing.com/search")!
        case .brave:
            components = URLComponents(string: "https://search.brave.com/search")!
        case .startpage:
            components = URLComponents(string: "https://www.startpage.com/sp/search")!
        }

        components.queryItems = [URLQueryItem(name: "q", value: query)]
        return components.url!
    }
}
