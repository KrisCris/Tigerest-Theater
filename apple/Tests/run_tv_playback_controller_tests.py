#!/usr/bin/env python3
"""Exercise the production TV controller's recovery/probe with engine doubles."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--scratch-path", default="/tmp/tv-playback-controller-tests")
args = parser.parse_args()

with tempfile.TemporaryDirectory(prefix="tv-playback-controller-package-") as directory:
    package = Path(directory)
    sources = package / "Sources/SharedTVPlayback"
    tests = package / "Tests/SharedTVPlaybackTests"
    sources.mkdir(parents=True)
    tests.mkdir(parents=True)
    for source in [ROOT / "TV/TVPlaybackController.swift", ROOT / "TV/TVSubtitleController.swift", ROOT / "TV/TVFrameStability.swift",
                   ROOT / "Tests/fixtures/TVPlaybackControllerStubs.swift"]:
        (sources / source.name).symlink_to(source)
    (tests / "TVPlaybackControllerTests.swift").symlink_to(ROOT / "Tests/TVPlaybackControllerTests.swift")
    (tests / "TVSubtitleControllerTests.swift").symlink_to(ROOT / "Tests/TVSubtitleControllerTests.swift")
    (package / "Package.swift").write_text('''// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "TVPlaybackControllerTests", platforms: [.macOS("26.0")],
dependencies: [.package(path: CORE)], targets: [
 .target(name: "SharedTVPlayback", dependencies: [.product(name: "AppleCore", package: "Core")]),
 .testTarget(name: "SharedTVPlaybackTests", dependencies: ["SharedTVPlayback", .product(name: "AppleCore", package: "Core")])
], swiftLanguageModes: [.v5])
'''.replace("CORE", json.dumps(str(ROOT / "Core"), ensure_ascii=False)))
    result = subprocess.run(["xcrun", "swift", "test", "--package-path", str(package),
                             "--scratch-path", args.scratch_path], env=os.environ.copy())
    raise SystemExit(result.returncode)
