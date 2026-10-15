#!/usr/bin/env python3
"""Exercise the production shared repository/TV host without UIKit or network."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="tv-danmaku-host-package-") as directory:
    package = Path(directory)
    sources = package / "Sources/SharedDanmaku"
    tests = package / "Tests/SharedDanmakuTests"
    sources.mkdir(parents=True)
    tests.mkdir(parents=True)
    for source in [ROOT / "App/Danmaku/DanmakuHost.swift", ROOT / "App/Danmaku/DanmakuRepository.swift", ROOT / "TV/TVDanmakuHost.swift"]:
        (sources / source.name).symlink_to(source)
    (tests / "DanmakuHostTests.swift").symlink_to(ROOT / "Tests/DanmakuHostTests.swift")
    (package / "Package.swift").write_text('''// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "DanmakuHostTests", platforms: [.macOS("26.0")],
dependencies: [.package(path: CORE)], targets: [
 .target(name: "SharedDanmaku", dependencies: [.product(name: "AppleCore", package: "Core")]),
 .testTarget(name: "SharedDanmakuTests", dependencies: ["SharedDanmaku", .product(name: "AppleCore", package: "Core")])
], swiftLanguageModes: [.v5])
'''.replace("CORE", json.dumps(str(ROOT / "Core"), ensure_ascii=False)))
    environment = os.environ.copy()
    result = subprocess.run(["xcrun", "swift", "test", "--package-path", str(package), "--scratch-path", "/tmp/tv-danmaku-core-tests"], env=environment)
    raise SystemExit(result.returncode)
