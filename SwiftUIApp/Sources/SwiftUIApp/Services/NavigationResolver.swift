import Foundation

enum NavigationResolver {
    static func request(for input: String) -> URLRequest? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if trimmed == "about:blank", let url = URL(string: "about:blank") {
            return URLRequest(url: url)
        }

        if let url = webURL(from: trimmed) {
            return URLRequest(url: url)
        }

        return URLRequest(url: BrowserPreferences.searchEngine.searchURL(for: trimmed))
    }

    private static func webURL(from input: String) -> URL? {
        if let directURL = URL(string: input),
           let scheme = directURL.scheme?.lowercased(),
           ["http", "https", "file"].contains(scheme) {
            return directURL
        }

        guard looksLikeWebAddress(input) else { return nil }

        let candidate = "https://\(input)"
        guard let url = URL(string: candidate),
              url.host != nil || input.lowercased().hasPrefix("localhost")
        else {
            return nil
        }

        return url
    }

    private static func looksLikeWebAddress(_ input: String) -> Bool {
        let lowercased = input.lowercased()

        if input.contains(" ") {
            return false
        }

        if lowercased == "localhost" || lowercased.hasPrefix("localhost:") {
            return true
        }

        if input.contains(".") {
            return true
        }

        return false
    }
}
