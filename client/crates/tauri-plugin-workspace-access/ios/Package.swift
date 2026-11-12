// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "tauri-plugin-workspace-access",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "tauri-plugin-workspace-access", type: .static, targets: ["WorkspaceAccess"])
    ],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [
        .target(name: "WorkspaceAccess", dependencies: [.byName(name: "Tauri")], path: "Sources")
    ]
)
