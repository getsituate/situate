// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "SituateDictation",
    platforms: [.macOS(.v14)],
    products: [.library(name: "SituateDictation", type: .static, targets: ["SituateDictation"])],
    dependencies: [
        .package(
            url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.7", traits: [])
    ],
    targets: [
        .target(
            name: "SituateDictation",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")]),
        .testTarget(name: "SituateDictationTests", dependencies: ["SituateDictation"]),
    ]
)
