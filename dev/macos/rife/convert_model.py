"""Convert the pinned reference RIFE to a reproducible fixed-shape Core ML model."""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import sys
import types

from prepare_model import SOURCE, verify_source

PRECISIONS = ("fp32", "fp16", "mixed", "mixed-last", "mixed-flow", "mixed-encode", "mixed-fine", "mixed-balanced", "hybrid")


def compare_frames(expected, actual) -> dict:
    import numpy as np
    if expected.shape != actual.shape or not np.isfinite(actual).all() or not np.isfinite(expected).all():
        return {"passed": False, "reason": "shape or non-finite values"}
    difference = expected.astype(np.float64) - actual.astype(np.float64)
    mse = float(np.mean(difference ** 2))
    mae = float(np.mean(np.abs(difference)))
    psnr = -10 * math.log10(mse) if mse else 1000.0
    return {"passed": psnr >= 40 and mae <= 0.005, "psnr_db": psnr, "mae": mae}


def load_reference_model(source: Path, scale: float = 1.0, grid_scale: float = 1.0):
    import torch
    from torch import nn
    from torch.nn import functional as F
    verify_source(source)
    if scale not in (1.0, 0.5, 0.25):
        raise ValueError("Supported inference scales: 1, 0.5, 0.25")
    if grid_scale not in (1.0, 0.5, 0.25) or (grid_scale != 1.0 and scale != 1.0):
        raise ValueError("Grid scale must be 1, 0.5, 0.25; do not combine reduced grid and inference scales")
    # Import only hash-verified official inference code, avoiding its training
    # optimizer, losses, GPU auto-selection and arbitrary pickle objects.
    package = types.ModuleType("model")
    package.__path__ = [str(source.resolve() / "model")]
    sys.modules["model"] = package
    sys.modules.pop("model.warplayer", None)
    spec = importlib.util.spec_from_file_location("tigerest_rife_reference", source / "train_log/IFNet_HDv3.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    network = module.IFNet().cpu().eval()
    weights = torch.load(source / "train_log/flownet.pkl", map_location="cpu", weights_only=True)
    weights = {k.removeprefix("module."): v for k, v in weights.items()}
    # The official checkpoint includes the teacher and timestep estimator,
    # which its inference source explicitly omits. Keep strict checks for
    # every remaining inference tensor instead of silently ignoring errors.
    weights = {k: v for k, v in weights.items() if not k.startswith(("teacher.", "caltime."))}
    network.load_state_dict(weights, strict=True)
    multiple = int(128 / scale / grid_scale)

    class Interpolator(nn.Module):
        def __init__(self):
            super().__init__()
            self.network = network

        def forward(self, frame0, frame1):
            height, width = frame0.shape[-2:]
            pad_h, pad_w = (multiple - height % multiple) % multiple, (multiple - width % multiple) % multiple
            a = F.pad(frame0, (0, pad_w, 0, pad_h))
            b = F.pad(frame1, (0, pad_w, 0, pad_h))
            frames = torch.cat((a, b), dim=1)
            if grid_scale != 1.0:
                frames = F.interpolate(frames, scale_factor=grid_scale, mode="bilinear", align_corners=False)
            flows, logits, merged = self.network(frames, timestep=0.5,
                                                scale_list=[s / scale for s in (32, 16, 8, 4, 1)])
            if grid_scale != 1.0:
                # Estimate at a smaller grid, but warp the original RGB frames.
                # This is a distinct quality mode, not the upstream block scale.
                flow = F.interpolate(flows[-1], scale_factor=1 / grid_scale,
                                     mode="bilinear", align_corners=False) / grid_scale
                mask = torch.sigmoid(F.interpolate(logits, scale_factor=1 / grid_scale,
                                                  mode="bilinear", align_corners=False))
                result = module.warp(a, flow[:, :2]) * mask + module.warp(b, flow[:, 2:4]) * (1 - mask)
            else:
                result = merged[-1]
            return result[:, :, :height, :width]

    return Interpolator().eval()


def convert_model(source: Path, output: Path, width: int, height: int, scale: float,
                  precision: str = "fp32", grid_scale: float = 1.0) -> Path:
    if precision not in PRECISIONS:
        raise ValueError(f"Unknown precision: {precision}")
    import coremltools as ct
    import numpy as np
    import torch
    if width < 2 or height < 2:
        raise ValueError("Frame dimensions must be at least 2")
    network = load_reference_model(source, scale, grid_scale)
    torch.set_num_threads(4)
    sample = torch.zeros(1, 3, height, width)
    with torch.inference_mode():
        traced = torch.jit.trace(network, (sample, sample), check_trace=False)
    if precision in ("mixed", "mixed-last", "mixed-flow", "mixed-encode", "mixed-fine", "mixed-balanced", "hybrid"):
        # Keep spatial coordinates, warps and flow accumulation in float32.
        # Plain fp16 distorts motion on the translated reference fixture.
        from coremltools.converters.mil.mil.scope import ScopeSource
        def use_half(op):
            scope = op.scopes.get(ScopeSource.TORCHSCRIPT_MODULE_NAME, [])
            fine = any(s in ("block1", "block2", "block3", "block4") for s in scope)
            if precision == "hybrid":
                return fine or "encode" in scope
            selected = (precision == "mixed" or
                        precision == "mixed-last" and "block4" in scope or
                        precision == "mixed-flow" and any(s.startswith("block") for s in scope) or
                        precision == "mixed-fine" and fine or
                        precision == "mixed-balanced" and (fine or "encode" in scope) or
                        precision == "mixed-encode" and "encode" in scope)
            return op.op_type in ("conv", "conv_transpose", "leaky_relu") and selected
        compute_precision = ct.transform.FP16ComputePrecision(op_selector=use_half)
    else:
        compute_precision = ct.precision.FLOAT32 if precision == "fp32" else ct.precision.FLOAT16
    model = ct.convert(traced, convert_to="mlprogram", minimum_deployment_target=ct.target.macOS15,
                       inputs=[ct.TensorType(name=n, shape=sample.shape, dtype=np.float32)
                               for n in ("frame0", "frame1")],
                       outputs=[ct.TensorType(name="interpolated", dtype=np.float32)],
                       compute_precision=compute_precision,
                       skip_model_load=True)
    output.mkdir(parents=True, exist_ok=True)
    path = output / "RIFE.mlpackage"
    model.short_description = "Tigerest RIFE 4.25 lite — 2x frame interpolation"
    model.license = "MIT; hzwer/Practical-RIFE"
    model.save(str(path))
    multiple = int(128 / scale / grid_scale)
    manifest = {
        "model": SOURCE["model"], "revision": SOURCE["revision"],
        "weights_sha256": SOURCE["files"]["train_log/flownet.pkl"],
        "width": width, "height": height, "scale": scale, "precision": precision, "grid_scale": grid_scale,
        "padded_width": math.ceil(width / multiple) * multiple,
        "padded_height": math.ceil(height / multiple) * multiple,
        "inputs": ["frame0", "frame1"], "output": "interpolated", "layout": "NCHW", "dtype": "float32",
        "tools": {"torch": torch.__version__, "coremltools": ct.__version__, "numpy": np.__version__},
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--grid-scale", type=float, default=1.0)
    parser.add_argument("--precision", choices=PRECISIONS, default="fp32")
    args = parser.parse_args()
    print(convert_model(args.source, args.output, args.width, args.height, args.scale, args.precision, args.grid_scale))
