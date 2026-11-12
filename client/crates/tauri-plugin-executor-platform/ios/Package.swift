// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "tauri-plugin-executor-platform",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "tauri-plugin-executor-platform", type: .static, targets: ["ExecutorPlatform"])
    ],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [
        .target(name: "ExecutorPlatform", dependencies: [.byName(name: "Tauri")], path: "Sources")
    ]
)
