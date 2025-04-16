// swift-tools-version:5.9

import PackageDescription

let package = Package(
  name: "ApolloSwift",
  platforms: [
    .iOS(.v12),
    .macOS(.v10_14),
    .tvOS(.v12),
    .watchOS(.v5),
  ],
  products: [
    .library(name: "ApolloSwift", targets: ["ApolloSwift"]),
  ],
  dependencies: [
    .package(url: "https://github.com/apollographql/apollo-ios", exact: "1.19.0"),
  ],
  targets: [
    .target(
      name: "ApolloSwift",
      dependencies: [
        .product(name: "ApolloAPI", package: "apollo-ios"),
      ],
      path: "./Sources"
    ),
    .testTarget(
      name: "ApolloSwiftTests",
      dependencies: [
        "ApolloSwift",
        .product(name: "Apollo", package: "apollo-ios"),
      ],
      path: "./Tests"),
  ]
)
