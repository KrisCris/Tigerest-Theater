import math
import json
import sys
import tempfile
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dev/macos/rife"))
from benchmark import evaluate_gate, fixture_matches


class BenchmarkGateTests(unittest.TestCase):
    def test_fixture_cache_rejects_changed_grid_and_truncated_tensor(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            manifest = {"width": 4, "height": 2, "grid_scale": 1, "weights_sha256": "a" * 64}
            (directory / "manifest.json").write_text(json.dumps(manifest))
            for name in ("frame0", "frame1", "reference"):
                (directory / (name + ".f32")).write_bytes(b"\0" * 4 * 2 * 3 * 4)
            self.assertTrue(fixture_matches(directory, manifest))
            self.assertFalse(fixture_matches(directory, manifest | {"grid_scale": 0.5}))
            (directory / "frame1.f32").write_bytes(b"\0")
            self.assertFalse(fixture_matches(directory, manifest))

    def report(self):
        return {"width": 1920, "height": 1080, "warmup": 30, "iterations": 120,
                "pair_ms": [20.0] * 120, "output_finite": True,
                "parity": {"passed": True}, "compute": "all",
                "runtime_ane_evidence": False}

    def test_accepts_fast_finite_accurate_1080p_output(self):
        result = evaluate_gate(self.report())
        self.assertTrue(result["passed"])
        self.assertFalse(result["ane_verified"])

    def test_rejects_missing_samples_slow_and_nan(self):
        for replacement in ({"pair_ms": []}, {"pair_ms": [28.] * 120},
                            {"output_finite": False}, {"pair_ms": [math.nan] * 120},
                            {"parity": {"passed": False}}, {"width": 128}):
            with self.subTest(replacement=replacement):
                self.assertFalse(evaluate_gate(self.report() | replacement)["passed"])

    def test_compute_configuration_is_not_ane_runtime_evidence(self):
        report = self.report() | {"compute": "cpu-ane", "ane_verified": True,
                                  "plan_devices": {"MLNeuralEngineComputeDevice": 200}}
        self.assertFalse(evaluate_gate(report)["ane_verified"])


if __name__ == "__main__":
    unittest.main()
