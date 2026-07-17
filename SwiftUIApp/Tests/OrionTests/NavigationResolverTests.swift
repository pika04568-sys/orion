import Foundation
import Testing
@testable import Orion

struct NavigationResolverTests {
    @Test
    func resolvesExplicitAndImplicitWebURLs() {
        #expect(NavigationResolver.request(for: "https://example.com/path")?.url?.absoluteString == "https://example.com/path")
        #expect(NavigationResolver.request(for: "example.com/path")?.url?.absoluteString == "https://example.com/path")
        #expect(NavigationResolver.request(for: "localhost:8080")?.url?.absoluteString == "https://localhost:8080")
    }

    @Test
    func searchesTextAndRejectsEmptyInput() throws {
        #expect(NavigationResolver.request(for: "   ") == nil)
        let url = try #require(NavigationResolver.request(for: "swift webkit performance")?.url)
        #expect(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems != nil)
    }
}
