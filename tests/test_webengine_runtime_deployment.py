"""Configure the real Windows bundler with accepted and broken WebEngine inputs."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / "dev/windows/qtwebengine/qtwebengine-6.9.3-d3d11-producer-sync.patch"


class WebEngineDeployment(unittest.TestCase):
    def configure(self, *, empty=False, missing=None, stock=False, version="6.9.3", bad_patch=False):
        with tempfile.TemporaryDirectory(prefix="tigerest-webengine-deploy-") as temporary:
            root = Path(temporary)
            runtime = root / "中文 runtime"
            (runtime / "bin").mkdir(parents=True)
            for name in ("Qt6WebEngineCore.dll", "Qt6WebEngineQuick.dll",
                         "Qt6WebEngineQuickDelegatesQml.dll", "QtWebEngineProcess.exe"):
                if name != missing:
                    (runtime / "bin" / name).write_bytes(
                        b"stock-dll" if stock and name == "Qt6WebEngineCore.dll" else b"patched-runtime")
            for directory in ("resources", "translations", "qml"):
                if directory != missing:
                    (runtime / directory).mkdir()
            if missing != "manifest":
                (runtime / "tigerest-webengine.json").write_text(json.dumps({
                    "qtVersion": version,
                    "patchSha256": "0" * 64 if bad_patch else hashlib.sha256(PATCH.read_bytes()).hexdigest(),
                    "coreSha256": hashlib.sha256(b"patched-runtime").hexdigest(),
                }), encoding="utf-8")
            (root / "CMakeLists.txt").write_text(f'''
cmake_minimum_required(VERSION 3.19)
project(WebEnginePreflight NONE)
set(WIN32 TRUE)
set(APPLE FALSE)
set(CMAKE_SOURCE_DIR "{ROOT.as_posix()}")
set(Qt6Core_VERSION "6.9.3")
include("{ROOT.as_posix()}/CMakeModules/CompleteBundle.cmake")
''', encoding="utf-8")
            generator = []
            ninja = shutil.which("ninja")
            if ninja:
                generator = ["-G", "Ninja", "-DCMAKE_MAKE_PROGRAM=" + ninja]
            # Use CMake's platform default when Ninja is not installed.
            return subprocess.run([
                os.environ.get("CMAKE_COMMAND") or shutil.which("cmake"), *generator,
                "-DTIGEREST_WEBENGINE_RUNTIME=" + ("" if empty else runtime.as_posix()),
                "-S", str(root), "-B", str(root / "build"),
            ], capture_output=True, encoding="utf-8", errors="replace")

    def rejected(self, expected, **kwargs):
        result = self.configure(**kwargs)
        self.assertNotEqual(result.returncode, 0, "Unverified Windows bundle was accepted")
        self.assertIn(expected, result.stderr)

    def test_empty_cached_runtime_cannot_silently_ship_stock_qt(self):
        self.rejected("TIGEREST_WEBENGINE_RUNTIME", empty=True)

    def test_manifest_is_required(self):
        self.rejected("manifest is missing", missing="manifest")

    def test_core_hash_rejects_stock_runtime(self):
        self.rejected("does not match", stock=True)

    def test_source_patch_and_qt_version_are_verified(self):
        self.rejected("does not match", bad_patch=True)
        self.rejected("does not match Qt", version="6.10.3")

    def test_incomplete_companion_files_are_rejected(self):
        self.rejected("Incomplete patched WebEngine", missing="QtWebEngineProcess.exe")
        self.rejected("Incomplete patched WebEngine", missing="resources")

    def test_verified_complete_runtime_configures(self):
        result = self.configure()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
