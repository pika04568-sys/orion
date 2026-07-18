import Foundation
import Testing
@testable import Orion

@Suite(.serialized)
final class NavigationResolverTests {
    @Test
    func testResolvesExplicitAndImplicitWebURLs() {
        XCTAssertEqual(NavigationResolver.request(for: "https://example.com/path")?.url?.absoluteString, "https://example.com/path")
        XCTAssertEqual(NavigationResolver.request(for: "example.com/path")?.url?.absoluteString, "https://example.com/path")
        XCTAssertEqual(NavigationResolver.request(for: "localhost:8080")?.url?.absoluteString, "https://localhost:8080")
    }

    @Test
    func testSearchesTextAndRejectsEmptyInput() throws {
        XCTAssertNil(NavigationResolver.request(for: "   "))
        let url = try XCTUnwrap(NavigationResolver.request(for: "swift webkit performance")?.url)
        XCTAssertNotNil(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
    }
}
