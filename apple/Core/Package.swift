// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "AppleCore", platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [.library(name: "AppleCore", targets: ["AppleCore"])],
    targets: [.target(name: "AppleCore"), .testTarget(name: "AppleCoreTests", dependencies: ["AppleCore"])])
