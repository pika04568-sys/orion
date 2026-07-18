import Foundation

struct NavigationState: Equatable, Sendable {
    var title = "New Tab"
    var urlString = ""
    var isLoading = false
    var estimatedProgress = 0.0
    var canGoBack = false
    var canGoForward = false
    var isReaderMode = false
    var isUnloaded = false
    var errorMessage: String?
}
