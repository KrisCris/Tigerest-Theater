#!/usr/bin/env python3
"""Check runtime-loaded Vulkan dependencies in an installed macOS bundle.

Run after bundling: python3 tests/test_macos_bundle.py 'build/output/Tigerest Theater.app'
"""

import json
from pathlib import Path
import subprocess
import sys


def verify_vulkan_driver(app: Path) -> None:
    app = app.resolve()
    manifest = app / "Contents/Resources/vulkan/icd.d/MoltenVK_icd.json"
    assert manifest.is_file(), "Missing bundled MoltenVK driver manifest"
    icd = json.loads(manifest.read_text())["ICD"]
    relative = Path(icd["library_path"])
    assert not relative.is_absolute(), "Driver manifest points outside the portable bundle"
    library = (manifest.parent / relative).resolve()
    assert library.is_relative_to(app), "Driver manifest escapes the application bundle"
    assert library.is_file(), "Bundled Vulkan driver is missing"
    assert icd["is_portability_driver"] is True
    executable = app / "Contents/MacOS/Tigerest Theater"
    app_archs = set(subprocess.check_output(["lipo", "-archs", str(executable)], text=True).split())
    driver_archs = set(subprocess.check_output(["lipo", "-archs", str(library)], text=True).split())
    assert app_archs <= driver_archs, "Vulkan driver does not support the application architecture"


if __name__ == "__main__":
    verify_vulkan_driver(Path(sys.argv[1]))
    print("PASS: portable MoltenVK manifest, driver and matching architecture")
