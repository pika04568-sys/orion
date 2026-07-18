import Testing
@testable import Orion

@Suite(.serialized)
final class NavigationStateTests {
    @Test
    func testDefaultStateRepresentsIdleNewTab() {
        let state = NavigationState()
        XCTAssertEqual(state.title, "New Tab")
        XCTAssertEqual(state.estimatedProgress, 0)
        XCTAssertFalse(state.isLoading)
        XCTAssertFalse(state.canGoBack)
        XCTAssertFalse(state.canGoForward)
        XCTAssertNil(state.errorMessage)
    }
}
