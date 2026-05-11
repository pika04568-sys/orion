// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "SwiftUIApp",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "SwiftUIApp",
            targets: ["SwiftUIApp"]
        )
    ],
    targets: [
        .executableTarget(
            name: "SwiftUIApp",
            path: "Sources/SwiftUIApp"
        )
    ]
)
