// swift-tools-version:5.9

import PackageDescription

let package = Package(
  name: "TestingApi",
  platforms: [
    .iOS(.v12),
    .macOS(.v10_14),
    .tvOS(.v12),
    .watchOS(.v5),
  ],
  products: [
    .library(name: "TestingApi", targets: ["TestingApi"]),
  ],
  dependencies: [
    .package(url: "https://github.com/apollographql/apollo-ios", exact: "1.19.0"),
  ],
  targets: [
    .target(
      name: "TestingApi",
      dependencies: [
        .product(name: "ApolloAPI", package: "apollo-ios"),
      ],
      path: "./Sources"
    ),
    .testTarget(
      name: "TestingApiTests",
      dependencies: [
        "TestingApi",
        .product(name: "Apollo", package: "apollo-ios"),
      ],
      path: "./Tests"),
  ]
)
