import Foundation

enum SearchEngine: String, CaseIterable, Codable, Identifiable {
    case google
    case bing
    case yahoo
    case duckDuckGo
    case brave
    case yandex
    case baidu
    case startpage
    case naver
    case ecosia
    case yahooJapan
    case yandexJapan

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .google:
            "Google"
        case .duckDuckGo:
            "DuckDuckGo"
        case .bing:
            "Bing"
        case .yahoo:
            "Yahoo"
        case .brave:
            "Brave"
        case .yandex:
            "Yandex"
        case .baidu:
            "Baidu"
        case .startpage:
            "StartPage"
        case .naver:
            "Naver"
        case .ecosia:
            "Ecosia"
        case .yahooJapan:
            "Yahoo! Japan"
        case .yandexJapan:
            "Yandex Japan"
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
        case .yahoo:
            components = URLComponents(string: "https://search.yahoo.com/search")!
        case .brave:
            components = URLComponents(string: "https://search.brave.com/search")!
        case .yandex:
            components = URLComponents(string: "https://yandex.com/search/")!
        case .baidu:
            components = URLComponents(string: "https://www.baidu.com/s")!
        case .startpage:
            components = URLComponents(string: "https://www.startpage.com/do/search")!
        case .naver:
            components = URLComponents(string: "https://search.naver.com/search.naver")!
        case .ecosia:
            components = URLComponents(string: "https://www.ecosia.org/search")!
        case .yahooJapan:
            components = URLComponents(string: "https://search.yahoo.co.jp/search")!
        case .yandexJapan:
            components = URLComponents(string: "https://yandex.co.jp/search/")!
        }

        let queryName: String
        switch self {
        case .yahoo, .yahooJapan:
            queryName = "p"
        case .yandex, .yandexJapan:
            queryName = "text"
        case .baidu:
            queryName = "wd"
        case .naver:
            queryName = "query"
        default:
            queryName = "q"
        }
        components.queryItems = [URLQueryItem(name: queryName, value: query)]
        return components.url!
    }
}
