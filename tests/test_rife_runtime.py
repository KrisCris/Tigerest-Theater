"""Private runtime validation; never use installed Python as the RIFE backend."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "dev/windows/rife/probe_runtime.py"


class PrivateRuntimeTests(unittest.TestCase):
    def test_foreign_dll_with_defender_name_is_not_trusted(self):
        spec = importlib.util.spec_from_file_location('native_probe', PROBE.with_name('native_probe.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'private'
            root.mkdir()
            foreign = Path(temp) / 'MpOAV.dll'
            foreign.write_bytes(b'unsigned foreign DLL')
            with self.assertRaisesRegex(RuntimeError, 'outside the private runtime'):
                module.audit_libraries(root, [str(foreign)])

    def probe(self, runtime, *, verify_only=False, env=None):
        report = runtime.parent / "probe-result.json"
        command = [sys.executable, str(PROBE), "--runtime", str(runtime),
                   "--report", str(report)]
        if verify_only:
            command.append("--verify-only")
        result = subprocess.run(command, capture_output=True, text=True,
                                timeout=20, env=env)
        self.assertTrue(report.is_file(), result.stderr)
        return result.returncode, json.loads(report.read_text(encoding="utf-8"))

    def manifest(self, root, entries=None):
        root.mkdir(parents=True)
        data = b"private fixture"
        (root / "fixture.bin").write_bytes(data)
        files = entries if entries is not None else [{
            "path": "fixture.bin", "size": 15,
            "sha256": "f9ab170aaeb3b4b3403a20b5bf10c0a8705ace6008249119ebd941e182694201",
        }]
        # Hash is fixture data, independently computed; size/hash checked by tool.
        if entries is None:
            files[0]["sha256"] = hashlib.sha256(data).hexdigest()
        (root / "runtime.json").write_text(json.dumps({
            "schemaVersion": 1, "backend": "windows-nvidia-trt",
            "runtimeId": "test-runtime", "files": files,
            "model": {"id": "rife-4.25-lite"},
        }), encoding="utf-8")
        return root

    def test_missing_private_root_reports_failure_without_system_fallback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "不存在的 私有运行库"
            environment = os.environ.copy()
            environment["PYTHONHOME"] = sys.prefix
            environment["PYTHONPATH"] = str(Path(sys.executable).parent)
            code, report = self.probe(root, env=environment)
            self.assertNotEqual(code, 0)
            self.assertFalse(report["ok"])
            self.assertEqual(report["errors"][0]["code"], "manifest-missing")
            self.assertEqual(report["loadedLibraries"], [])

    def test_valid_manifest_in_unicode_and_space_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            for name in ("中文 运行库", "另一个 路径"):
                root = self.manifest(Path(temp) / name)
                code, report = self.probe(root, verify_only=True)
                self.assertEqual(code, 0, report)
                self.assertEqual(report["stage"], "manifest")
                self.assertFalse(report["ok"], "manifest verification is not runtime loading")
                self.assertTrue(report["manifestValid"])

    def test_corrupt_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.manifest(Path(temp) / "runtime")
            (root / "fixture.bin").write_bytes(b"corrupt runtime")
            code, report = self.probe(root, verify_only=True)
            self.assertNotEqual(code, 0)
            self.assertFalse(report["manifestValid"])
            self.assertEqual(report["errors"][0]["code"], "file-hash")

    def test_unlisted_python_module_cannot_bypass_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.manifest(Path(temp) / 'runtime')
            (root / 'unverified.py').write_text('unexpected code')
            code, report = self.probe(root, verify_only=True)
            self.assertNotEqual(code, 0)
            self.assertEqual(report['errors'][0]['code'], 'file-unlisted')

    def test_manifest_cannot_reference_files_outside_private_root(self):
        with tempfile.TemporaryDirectory() as temp:
            outside = Path(temp) / "outside.dll"
            outside.write_bytes(b"outside")
            for path in ("../outside.dll", str(outside.resolve()), "C:/Windows/system32/kernel32.dll"):
                root = Path(temp) / "runtime"
                if root.exists():
                    (root / "runtime.json").unlink()
                    (root / "fixture.bin").unlink()
                    root.rmdir()
                self.manifest(root, [{"path": path, "size": 7,
                                      "sha256": hashlib.sha256(b"outside").hexdigest()}])
                code, report = self.probe(root, verify_only=True)
                self.assertNotEqual(code, 0)
                self.assertEqual(report["errors"][0]["code"], "file-path")

    def test_manifest_does_not_hide_missing_python_executable(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.manifest(Path(temp) / "runtime")
            code, report = self.probe(root)
            self.assertNotEqual(code, 0)
            self.assertEqual(report["errors"][0]["code"], "python-missing")
            self.assertEqual(report["loadedLibraries"], [])

    @unittest.skipUnless(os.environ.get("RIFE_TEST_RUNTIME"), "requires prepared private NVIDIA runtime")
    def test_real_runtime_loads_vapoursynth_and_tensorrt_in_private_python(self):
        root = Path(os.environ["RIFE_TEST_RUNTIME"])
        code, report = self.probe(root)
        self.assertEqual(code, 0, report)
        self.assertTrue(report["ok"])
        self.assertIn("79", report["vsVersion"])
        self.assertIn("10.16", report["trtVersion"])
        self.assertIn("NVIDIA", report["gpu"]["name"])
        self.assertTrue(report["loadedLibraries"])
        self.assertTrue(report["privateLibrariesOnly"])
        self.assertTrue(report['autoloadDisabled'])
        self.assertNotIn('com.vapoursynth.avisynth', report['plugins'])
        repeated_code, repeated = self.probe(root)
        self.assertEqual(repeated_code, 0, repeated)


if __name__ == "__main__":
    unittest.main()
