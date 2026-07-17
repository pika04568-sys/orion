import Testing
@testable import Orion

struct NavigationStateTests {
    @Test
    func defaultStateRepresentsIdleNewTab() {
        let state = NavigationState()
        #expect(state.title == "New Tab")
        #expect(state.estimatedProgress == 0)
        #expect(!state.isLoading)
        #expect(!state.canGoBack)
        #expect(!state.canGoForward)
        #expect(state.errorMessage == nil)
    }
}
