// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "apollo-swift",
    platforms: [
        .macOS(.v13),
        .iOS(.v13)
    ],
    products: [
        .library(
            name: "apollo-swift",
            targets: ["apollo-swift"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apollographql/apollo-ios.git", from: "1.9.0")
    ],
    targets: [
        .target(
            name: "apollo-swift",
            dependencies: [
                .product(name: "Apollo", package: "apollo-ios")
            ]),
        .testTarget(
            name: "apollo-swiftTests",
            dependencies: [
                "apollo-swift",
                .product(name: "Apollo", package: "apollo-ios")
            ]),
    ]
) 