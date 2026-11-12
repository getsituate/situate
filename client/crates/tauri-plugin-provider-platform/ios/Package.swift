// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "tauri-plugin-provider-platform",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "tauri-plugin-provider-platform", type: .static, targets: ["ProviderPlatform"])
    ],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [
        .target(name: "ProviderPlatform", dependencies: [.byName(name: "Tauri")], path: "Sources"),
        .testTarget(
            name: "ProviderPlatformTests", dependencies: ["ProviderPlatform"], path: "Tests"),
    ]
)
