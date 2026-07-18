import Foundation

enum ChromeWebStoreResolver {
    static let storeURL = URL(string: "https://chromewebstore.google.com/")!

    static func extensionID(from input: String) -> String? {
        guard let url = URL(string: input) else { return nil }
        return extensionID(from: url)
    }

    static func extensionID(from url: URL) -> String? {
        let host = url.host?.lowercased()
        guard host == "chromewebstore.google.com"
                || host == "chrome.google.com"
        else {
            return nil
        }

        let pathComponents = url.pathComponents.filter { $0 != "/" }
        guard let detailIndex = pathComponents.firstIndex(of: "detail"),
              pathComponents.indices.contains(detailIndex + 1)
        else {
            return nil
        }

        let candidates = pathComponents[(detailIndex + 1)...].reversed()
        return candidates.first(where: isExtensionID)
    }

    static func isExtensionID(_ value: String) -> Bool {
        let normalized = value.lowercased()
        return normalized.count == 32
            && normalized.allSatisfy { ("a"..."p").contains(String($0)) }
    }
}
