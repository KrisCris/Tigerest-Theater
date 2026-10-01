"""Run the real CMake deployment with good, mismatched and missing kernels."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class MpvDeployment(unittest.TestCase):
    def deploy(self, primary=b"accepted-primary", fallback=b"accepted-fallback", stale=False):
        with tempfile.TemporaryDirectory(prefix="tigerest-kernel-deploy-") as temporary:
            root = Path(temporary)
            runtime = root / "中文 kernels"
            runtime.mkdir()
            lock = {"schemaVersion": 1}
            for role, name, original, payload in (
                ("primary", "libmpv-2.dll", b"accepted-primary", primary),
                ("fallback", "libmpv-fallback.dll", b"accepted-fallback", fallback),
            ):
                lock[role] = {"sha256": hashlib.sha256(original).hexdigest(), "size": len(original)}
                if payload is not None:
                    (runtime / name).write_bytes(payload)
            lock_path = root / "lock.json"
            lock_path.write_text(json.dumps(lock), encoding="utf-8")
            output = root / "bundle"
            if stale:
                output.mkdir()
                for name in ("libmpv-2.dll", "libmpv-fallback.dll"):
                    old = output / name
                    original = runtime / name
                    old.write_bytes(b"stale-unaccepted-kernel")
                    stat = original.stat()
                    os.utime(old, ns=(stat.st_atime_ns, stat.st_mtime_ns))
            result = subprocess.run([
                os.environ.get("CMAKE_COMMAND") or shutil.which("cmake"),
                "-DMPV_RUNTIME_DIR=" + runtime.as_posix(),
                "-DMPV_LOCK_FILE=" + lock_path.as_posix(),
                "-DMPV_INSTALL_DIR=" + output.as_posix(),
                "-P", str(ROOT / "CMakeModules/DeployWindowsMpv.cmake"),
            ], capture_output=True, encoding="utf-8", errors="replace")
            return result, {p.relative_to(output).as_posix(): p.read_bytes()
                            for p in output.rglob("*") if p.is_file()}

    def test_exact_kernels_and_lock_are_deployed(self):
        result, files = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(files["libmpv-2.dll"], b"accepted-primary")
        self.assertEqual(files["libmpv-fallback.dll"], b"accepted-fallback")
        self.assertIn("licenses/mpv-rife/mpv-runtime-lock.json", files)

    def test_stock_primary_is_rejected_without_partial_deployment(self):
        result, files = self.deploy(primary=b"stock-dll")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum/size mismatch", result.stderr)
        self.assertEqual(files, {})

    def test_same_timestamp_stale_bundle_is_replaced_and_verified(self):
        result, files = self.deploy(stale=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(files["libmpv-2.dll"], b"accepted-primary")
        self.assertEqual(files["libmpv-fallback.dll"], b"accepted-fallback")

    def test_missing_fallback_does_not_restore_stock_or_deploy_primary(self):
        result, files = self.deploy(fallback=None)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DLL is missing", result.stderr)
        self.assertEqual(files, {})


if __name__ == "__main__":
    unittest.main()
