"""Build-time benchmark and conservative qualification of actual Core ML output."""
import argparse
import json
import math
from pathlib import Path
import subprocess
import sys


def fixture_matches(directory: Path, manifest: dict) -> bool:
    try:
        if json.loads((directory / "manifest.json").read_text()) != manifest:
            return False
        length = manifest["width"] * manifest["height"] * 3 * 4
        return all((directory / (name + ".f32")).stat().st_size == length
                   for name in ("frame0", "frame1", "reference"))
    except (OSError, ValueError, KeyError):
        return False


def evaluate_gate(report: dict) -> dict:
    reasons = []
    samples = report.get("pair_ms", [])
    valid = len(samples) >= 120 and all(math.isfinite(x) and x > 0 for x in samples)
    if not valid:
        reasons.append("At least 120 finite positive prediction samples required")
    p95 = sorted(samples)[math.ceil(len(samples) * 0.95) - 1] if valid else None
    if p95 is not None and p95 > 26.7:
        reasons.append("1080p prediction p95 exceeds 26.7 ms")
    if report.get("warmup", 0) < 30:
        reasons.append("At least 30 warmup predictions required")
    if report.get("width") != 1920 or report.get("height") != 1080:
        reasons.append("This is not the 1920x1080 qualification case")
    if not report.get("output_finite") or not report.get("parity", {}).get("passed"):
        reasons.append("Numerical output has not passed reference validation")
    return {"passed": not reasons, "reasons": reasons, "p95_ms": p95,
            "ane_verified": report.get("runtime_ane_evidence") is True,
            "scope": "inference only; full player still requires separate qualification"}


def prepare_fixtures(source: Path, directory: Path, width: int, height: int, scale: float, grid_scale: float = 1.0) -> None:
    import numpy as np
    import torch
    from convert_model import load_reference_model
    directory.mkdir(parents=True, exist_ok=True)
    # Smooth textured patterns plus a translated hard-edged object expose
    # flow, coordinates and edge sampling errors at the requested resolution.
    y, x = np.mgrid[:height, :width].astype(np.float32)
    a = np.stack((0.5 + 0.2 * np.sin(x / 19), 0.5 + 0.2 * np.cos(y / 17),
                  0.5 + 0.15 * np.sin((x + y) / 23)))[None].astype(np.float32)
    a[:, :, height//4:height//2, width//3:width//2] = np.array([.9, .3, .1], dtype=np.float32)[None, :, None, None]
    b = np.roll(a, 7, axis=3)
    a.tofile(directory / "frame0.f32")
    b.tofile(directory / "frame1.f32")
    torch.set_num_threads(4)
    model = load_reference_model(source, scale, grid_scale)
    with torch.inference_mode():
        model(torch.from_numpy(a), torch.from_numpy(b)).numpy().tofile(directory / "reference.f32")


def run_benchmark(model_dir: Path, source: Path, binary: Path, compute: str,
                  warmup: int, iterations: int, output: Path) -> dict:
    import numpy as np
    from convert_model import compare_frames
    manifest = json.loads((model_dir / "manifest.json").read_text())
    fixture = model_dir / "fixture"
    if not fixture_matches(fixture, manifest):
        prepare_fixtures(source, fixture, manifest["width"], manifest["height"], manifest["scale"], manifest.get("grid_scale", 1.0))
        (fixture / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [str(binary.resolve()), "--model", str((model_dir / "RIFE.mlpackage").resolve()),
               "--input-a", str((fixture / "frame0.f32").resolve()),
               "--input-b", str((fixture / "frame1.f32").resolve()),
               "--compute", compute, "--warmup", str(warmup), "--iterations", str(iterations),
               "--output", str(output.resolve())]
    subprocess.run(command, check=True, timeout=600)
    report = json.loads(output.read_text())
    expected = np.fromfile(fixture / "reference.f32", dtype=np.float32)
    actual = np.fromfile(output.with_suffix(".f32"), dtype=np.float32)
    report["parity"] = compare_frames(expected, actual)
    report["manifest"] = manifest
    report["gate"] = evaluate_gate(report)
    output.write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--compute", choices=("all", "cpu-ane", "cpu-gpu"), default="all")
    parser.add_argument("--warmup", type=int, default=30)
    parser.add_argument("--iterations", type=int, default=120)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = run_benchmark(args.model_dir, args.source, args.binary, args.compute,
                           args.warmup, args.iterations, args.output)
    print(json.dumps({k: result[k] for k in ("compute", "p50_ms", "p95_ms", "parity", "plan_devices", "gate")}, indent=2))
