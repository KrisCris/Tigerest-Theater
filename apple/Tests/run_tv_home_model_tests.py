#!/usr/bin/env python3
"""Exercise production TVAppModel and AppleCore with isolated playback/network boundaries."""
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="tv-home-model-package-") as directory:
    package = Path(directory)
    sources = package / "Sources/TVHomeModel"
    tests = package / "Tests/TVHomeModelTests"
    sources.mkdir(parents=True)
    tests.mkdir(parents=True)
    (sources / "TVAppModel.swift").symlink_to(ROOT / "TV/TVAppModel.swift")
    (sources / "ServerPresets.swift").symlink_to(ROOT / "App/ServerPresets.swift")
    (sources / "TVHomeModelBoundaries.swift").symlink_to(ROOT / "Tests/TVHomeModelBoundaries.swift")
    (tests / "TVHomeModelTests.swift").symlink_to(ROOT / "Tests/TVHomeModelTests.swift")
    (tests / "TVEpisodeModelTests.swift").symlink_to(ROOT / "Tests/TVEpisodeModelTests.swift")
    (package / "Package.swift").write_text('''// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "TVHomeModelTests", platforms: [.macOS("26.0")],
dependencies: [.package(path: CORE)], targets: [
 .target(name: "TVHomeModel", dependencies: [.product(name: "AppleCore", package: "Core")]),
 .testTarget(name: "TVHomeModelTests", dependencies: ["TVHomeModel", .product(name: "AppleCore", package: "Core")])
], swiftLanguageModes: [.v5])
'''.replace("CORE", json.dumps(str(ROOT / "Core"), ensure_ascii=False)))
    result = subprocess.run(["xcrun", "swift", "test", "--package-path", str(package), "--scratch-path", "/tmp/tv-home-model-tests"])
    raise SystemExit(result.returncode)
