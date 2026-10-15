#!/usr/bin/env python3
"""Test the production comments model with isolated network and token storage."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--scratch-path", default="/tmp/tv-comments-model-tests")
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix="tv-comments-model-package-") as directory:
    package = Path(directory)
    tests = package / "Tests/TVCommentsModelTests"
    tests.mkdir(parents=True)
    # Keep the private production model and its tests in the same Swift file.
    # Only the tvOS view is excluded; no model behavior is rewritten or stubbed.
    source, separator, _ = (ROOT / "TV/TVCommentsView.swift").read_text().partition("\nstruct TVCommentsView: View {")
    if not separator:
        raise RuntimeError("Could not locate the comments model/view boundary")
    (tests / "TVCommentsModelTests.swift").write_text(source + "\n" + (ROOT / "Tests/TVCommentsModelTests.swift").read_text())
    (package / "Package.swift").write_text('''// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "TVCommentsModelTests", platforms: [.macOS("26.0")],
dependencies: [.package(path: CORE)], targets: [
 .testTarget(name: "TVCommentsModelTests", dependencies: [.product(name: "AppleCore", package: "Core")])
], swiftLanguageModes: [.v5])
'''.replace("CORE", json.dumps(str(ROOT / "Core"), ensure_ascii=False)))
    result = subprocess.run(["xcrun", "swift", "test", "--package-path", str(package), "--scratch-path", args.scratch_path])
    raise SystemExit(result.returncode)
