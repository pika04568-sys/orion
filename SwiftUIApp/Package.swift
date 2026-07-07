// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Orion",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "Orion",
            targets: ["Orion"]
        )
    ],
    targets: [
        .executableTarget(
            name: "Orion",
            path: "Sources/SwiftUIApp"
        )
    ]
)
