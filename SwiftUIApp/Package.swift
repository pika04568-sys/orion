// swift-tools-version: 6.4

import PackageDescription
import Foundation

let developerDirectory = ProcessInfo.processInfo.environment["DEVELOPER_DIR"]
    ?? "/Library/Developer/CommandLineTools"
let testingFrameworksPath = "\(developerDirectory)/Library/Developer/Frameworks"
let testingLibraryPath = "\(developerDirectory)/Library/Developer/usr/lib"

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
            dependencies: ["Orion"],
            swiftSettings: [
                .unsafeFlags(["-F", testingFrameworksPath])
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-F", testingFrameworksPath,
                    "-Xlinker", "-rpath",
                    "-Xlinker", testingFrameworksPath,
                    "-Xlinker", "-rpath",
                    "-Xlinker", testingLibraryPath
                ])
            ]
        )
    ]
)
