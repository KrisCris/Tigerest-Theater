"""Exercise the Windows TLS preflight and byte-verified deployment in CMake."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CMAKE = os.environ.get("CMAKE_COMMAND") or shutil.which("cmake")


class OpenSSLDeployment(unittest.TestCase):
    def test_windows_bundle_requires_verified_tls_runtime(self):
        with tempfile.TemporaryDirectory(prefix="tigerest-tls-configure-") as temporary:
            root = Path(temporary)
            runtime = root / "webengine"
            (runtime / "bin").mkdir(parents=True)
            for name in ("Qt6WebEngineCore.dll", "Qt6WebEngineQuick.dll",
                         "Qt6WebEngineQuickDelegatesQml.dll", "QtWebEngineProcess.exe"):
                (runtime / "bin" / name).write_bytes(b"patched-runtime")
            for directory in ("resources", "translations", "qml"):
                (runtime / directory).mkdir()
            patch = ROOT / "dev/windows/qtwebengine/qtwebengine-6.9.3-d3d11-producer-sync.patch"
            (runtime / "tigerest-webengine.json").write_text(json.dumps({
                "qtVersion": "6.9.3",
                "patchSha256": hashlib.sha256(patch.read_bytes()).hexdigest(),
                "coreSha256": hashlib.sha256(b"patched-runtime").hexdigest(),
            }), encoding="utf-8")
            (root / "CMakeLists.txt").write_text(f'''
cmake_minimum_required(VERSION 3.19)
project(TlsPreflight NONE)
set(WIN32 TRUE)
set(APPLE FALSE)
set(CMAKE_SOURCE_DIR "{ROOT.as_posix()}")
set(Qt6Core_VERSION "6.9.3")
include("{ROOT.as_posix()}/CMakeModules/CompleteBundle.cmake")
''', encoding="utf-8")
            result = subprocess.run([CMAKE, "-G", "Ninja",
                "-DTIGEREST_WEBENGINE_RUNTIME=" + runtime.as_posix(),
                "-DTIGEREST_OPENSSL_RUNTIME_DIR=", "-S", str(root), "-B", str(root / "build")],
                capture_output=True, encoding="utf-8", errors="replace")
            self.assertNotEqual(result.returncode, 0, "Windows bundle accepted missing OpenSSL")
            self.assertIn("TIGEREST_OPENSSL_RUNTIME_DIR", result.stderr)

    def run_runtime(self, *, missing=None, corrupt=None, stale=False, configure=False):
        with tempfile.TemporaryDirectory(prefix="tigerest-tls-deploy-") as temporary:
            root = Path(temporary)
            runtime = root / "中文 TLS runtime"
            qt = root / "qt"
            (qt / "plugins/tls").mkdir(parents=True)
            if missing != "qopensslbackend.dll":
                (qt / "plugins/tls/qopensslbackend.dll").write_bytes(b"matching-qt-plugin")
            runtime.mkdir()
            originals = {"libssl-3-x64.dll": b"pinned-ssl", "libcrypto-3-x64.dll": b"pinned-crypto", "libcrypto-3.dll": b"pinned-crypto-dependency",
                         "LICENSE.OpenSSL.txt": b"OpenSSL license", "LICENSE.Python.txt": b"Python license"}
            lock = {"schemaVersion": 1, "files": {}}
            for name, payload in originals.items():
                lock["files"][name] = {"size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
                if name != missing:
                    (runtime / name).write_bytes(b"wrong" if name == corrupt else payload)
            lock_path = root / "lock.json"
            lock_path.write_text(json.dumps(lock), encoding="utf-8")
            output = root / "bundle"
            if stale:
                output.mkdir()
                (output / "libssl-3-x64.dll").write_bytes(b"stale-dll")
                stat = (runtime / "libssl-3-x64.dll").stat()
                os.utime(output / "libssl-3-x64.dll", ns=(stat.st_atime_ns, stat.st_mtime_ns))
            script = root / "run.cmake"
            script.write_text(f'''
include("{ROOT.as_posix()}/CMakeModules/DeployWindowsOpenSSL.cmake")
tigerest_validate_openssl("{runtime.as_posix()}" "{qt.as_posix()}" "{lock_path.as_posix()}")
''' + ("" if configure else f'''
tigerest_deploy_openssl("{runtime.as_posix()}" "{qt.as_posix()}" "{lock_path.as_posix()}" "{output.as_posix()}")
'''), encoding="utf-8")
            result = subprocess.run([CMAKE, "-P", str(script)], capture_output=True,
                                    encoding="utf-8", errors="replace")
            files = {p.relative_to(output).as_posix(): p.read_bytes() for p in output.rglob("*") if p.is_file()}
            return result, files

    def test_exact_dlls_matching_plugin_and_licenses_are_deployed(self):
        result, files = self.run_runtime()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(files["libssl-3-x64.dll"], b"pinned-ssl")
        self.assertEqual(files["libcrypto-3-x64.dll"], b"pinned-crypto")
        self.assertEqual(files["libcrypto-3.dll"], b"pinned-crypto-dependency")
        self.assertEqual(files["tls/qopensslbackend.dll"], b"matching-qt-plugin")
        self.assertIn("licenses/openssl/LICENSE.OpenSSL.txt", files)
        self.assertIn("licenses/openssl/LICENSE.Python.txt", files)
        self.assertIn("licenses/openssl/runtime-lock.json", files)

    def test_missing_or_corrupt_files_fail_before_deploying_any_tls_file(self):
        for name in ("libssl-3-x64.dll", "libcrypto-3-x64.dll", "libcrypto-3.dll", "LICENSE.OpenSSL.txt", "LICENSE.Python.txt"):
            for mode in ("missing", "corrupt"):
                with self.subTest(file=name, mode=mode):
                    result, files = self.run_runtime(**{mode: name})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("Verified OpenSSL", result.stderr)
                    self.assertEqual(files, {})

    def test_missing_matching_qt_backend_is_terminal_preflight_error(self):
        result, files = self.run_runtime(missing="qopensslbackend.dll")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("qopensslbackend.dll", result.stderr)
        self.assertEqual(files, {})

    def test_corrupt_dll_is_rejected_at_configure(self):
        result, _ = self.run_runtime(corrupt="libssl-3-x64.dll", configure=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum/size mismatch", result.stderr)

    def test_stale_same_timestamp_destination_is_replaced(self):
        result, files = self.run_runtime(stale=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(files["libssl-3-x64.dll"], b"pinned-ssl")

    def test_preparation_rejects_unverified_archive_without_staging(self):
        with tempfile.TemporaryDirectory(prefix="tigerest-tls-prepare-") as temporary:
            root = Path(temporary)
            archives = root / "archives"
            archives.mkdir()
            (archives / "python-3.13.16-embed-amd64.zip").write_bytes(b"unverified-archive")
            result = subprocess.run([sys.executable, str(ROOT / "dev/windows/tls/prepare_openssl_runtime.py"),
                "--output", str(root / "runtime"), "--archives", str(archives), "--offline"],
                capture_output=True, encoding="utf-8", errors="replace")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("checksum/size mismatch", result.stderr)
            self.assertFalse((root / "runtime").exists())

    def test_preparation_missing_offline_archive_is_terminal(self):
        with tempfile.TemporaryDirectory(prefix="tigerest-tls-prepare-") as temporary:
            root = Path(temporary)
            result = subprocess.run([sys.executable, str(ROOT / "dev/windows/tls/prepare_openssl_runtime.py"),
                "--output", str(root / "runtime"), "--archives", str(root / "archives"), "--offline"],
                capture_output=True, encoding="utf-8", errors="replace")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Offline archive missing", result.stderr)
            self.assertFalse((root / "runtime").exists())


if __name__ == "__main__":
    unittest.main()
