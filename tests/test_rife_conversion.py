"""Reference tests for the build-time RIFE converter (no media/server access)."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dev/macos/rife"))
from prepare_model import extract_verified_archive
from convert_model import compare_frames, convert_model, load_reference_model


class ArchiveTests(unittest.TestCase):
    def test_rejects_wrong_hash_before_extracting(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "model.zip"
            archive.write_bytes(b"untrusted content")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                extract_verified_archive(archive, Path(tmp) / "out", "0" * 64)
            self.assertFalse((Path(tmp) / "out").exists())

    def test_rejects_archive_path_escape(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "model.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("../outside", "bad")
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, "path"):
                extract_verified_archive(archive, Path(tmp) / "out", digest)
            self.assertFalse((Path(tmp) / "outside").exists())


class MetricsTests(unittest.TestCase):
    def test_rejects_unknown_precision_before_loading_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "precision"):
                convert_model(Path(tmp), Path(tmp) / "out", 128, 128, 1, precision="typo")

    def test_rejects_nonfinite_and_inaccurate_frames(self):
        import numpy as np
        a = np.zeros((1, 3, 8, 8), np.float32)
        self.assertTrue(compare_frames(a, a)["passed"])
        self.assertFalse(compare_frames(a, a + 0.1)["passed"])
        self.assertFalse(compare_frames(a, a + np.nan)["passed"])


@unittest.skipUnless(os.environ.get("RIFE_TEST_MODEL"), "set RIFE_TEST_MODEL for actual Core ML parity")
class ConversionTests(unittest.TestCase):
    def test_reduced_grid_keeps_full_output_and_matches_coreml(self):
        import coremltools as ct
        import numpy as np
        import torch
        source = Path(os.environ["RIFE_TEST_MODEL"])
        network = load_reference_model(source, grid_scale=0.5)
        rng = np.random.default_rng(2026)
        first = rng.random((1, 3, 112, 192), dtype=np.float32)
        second = np.roll(first, 4, axis=3)
        with tempfile.TemporaryDirectory(prefix="rife-grid-") as tmp:
            path = convert_model(source, Path(tmp), 192, 112, 1.0, grid_scale=0.5)
            model = ct.models.MLModel(str(path), compute_units=ct.ComputeUnit.CPU_AND_GPU)
            result = model.predict({"frame0": first, "frame1": second})["interpolated"]
            with torch.inference_mode():
                expected = network(torch.from_numpy(first), torch.from_numpy(second)).numpy()
            self.assertEqual(result.shape, first.shape)
            metrics = compare_frames(expected, result)
            print("Reduced-grid parity:", metrics, flush=True)
            self.assertTrue(metrics["passed"], metrics)
            manifest = json.loads((Path(tmp) / "manifest.json").read_text())
            self.assertEqual(manifest["grid_scale"], 0.5)

    def test_identical_and_translated_frames_match_reference(self):
        import coremltools as ct
        import numpy as np
        import torch
        source = Path(os.environ["RIFE_TEST_MODEL"])
        network = load_reference_model(source)
        with tempfile.TemporaryDirectory(prefix="rife-conversion-") as tmp:
            model_path = convert_model(source, Path(tmp), width=128, height=128, scale=1.0,
                                       precision=os.environ.get("RIFE_TEST_PRECISION", "fp32"))
            model = ct.models.MLModel(str(model_path), compute_units=ct.ComputeUnit.CPU_AND_GPU)
            rng = np.random.default_rng(712)
            first = rng.random((1, 3, 128, 128), dtype=np.float32)
            for second in (first.copy(), np.roll(first, 3, axis=3)):
                with torch.inference_mode():
                    expected = network(torch.from_numpy(first), torch.from_numpy(second)).numpy()
                result = model.predict({"frame0": first, "frame1": second})["interpolated"]
                self.assertEqual(result.shape, first.shape)
                metrics = compare_frames(expected, result)
                print("Core ML parity:", metrics, flush=True)
                self.assertTrue(metrics["passed"], metrics)
            manifest = json.loads((Path(tmp) / "manifest.json").read_text())
            self.assertEqual(manifest["model"], "rife-4.25-lite")
            self.assertEqual(manifest["width"], 128)
            self.assertEqual(len(manifest["weights_sha256"]), 64)


if __name__ == "__main__":
    unittest.main()
