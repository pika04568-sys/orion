// swift-tools-version: 6.4

import PackageDescription

let package = Package(
    name: "Orion",
    defaultLocalization: "en",
    platforms: [
        .macOS("15.4")
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
            path: "Sources/SwiftUIApp",
            resources: [
                .process("Resources")
            ]
        ),
        .testTarget(
            name: "OrionTests",
            dependencies: ["Orion"]
        )
    ]
)
