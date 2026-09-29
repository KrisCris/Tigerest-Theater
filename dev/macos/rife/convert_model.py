"""Convert the pinned reference RIFE to a reproducible fixed-shape Core ML model."""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import sys
import types

from prepare_model import SOURCE, verify_source


def compare_frames(expected, actual) -> dict:
    import numpy as np
    if expected.shape != actual.shape or not np.isfinite(actual).all() or not np.isfinite(expected).all():
        return {"passed": False, "reason": "shape or non-finite values"}
    difference = expected.astype(np.float64) - actual.astype(np.float64)
    mse = float(np.mean(difference ** 2))
    mae = float(np.mean(np.abs(difference)))
    psnr = -10 * math.log10(mse) if mse else 1000.0
    return {"passed": psnr >= 40 and mae <= 0.005, "psnr_db": psnr, "mae": mae}


def load_reference_model(source: Path, scale: float = 1.0):
    import torch
    from torch import nn
    from torch.nn import functional as F
    verify_source(source)
    if scale not in (1.0, 0.5, 0.25):
        raise ValueError("Supported inference scales: 1, 0.5, 0.25")
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
    multiple = int(128 / scale)

    class Interpolator(nn.Module):
        def __init__(self):
            super().__init__()
            self.network = network

        def forward(self, frame0, frame1):
            height, width = frame0.shape[-2:]
            pad_h, pad_w = (multiple - height % multiple) % multiple, (multiple - width % multiple) % multiple
            a = F.pad(frame0, (0, pad_w, 0, pad_h))
            b = F.pad(frame1, (0, pad_w, 0, pad_h))
            _, _, merged = self.network(torch.cat((a, b), dim=1), timestep=0.5,
                                        scale_list=[s / scale for s in (32, 16, 8, 4, 1)])
            return merged[-1][:, :, :height, :width]

    return Interpolator().eval()


def convert_model(source: Path, output: Path, width: int, height: int, scale: float,
                  precision: str = "fp32") -> Path:
    import coremltools as ct
    import numpy as np
    import torch
    if width < 2 or height < 2:
        raise ValueError("Frame dimensions must be at least 2")
    network = load_reference_model(source, scale)
    torch.set_num_threads(4)
    sample = torch.zeros(1, 3, height, width)
    with torch.inference_mode():
        traced = torch.jit.trace(network, (sample, sample), check_trace=False)
    model = ct.convert(traced, convert_to="mlprogram", minimum_deployment_target=ct.target.macOS15,
                       inputs=[ct.TensorType(name=n, shape=sample.shape, dtype=np.float32)
                               for n in ("frame0", "frame1")],
                       outputs=[ct.TensorType(name="interpolated", dtype=np.float32)],
                       compute_precision=ct.precision.FLOAT32 if precision == "fp32" else ct.precision.FLOAT16,
                       skip_model_load=True)
    output.mkdir(parents=True, exist_ok=True)
    path = output / "RIFE.mlpackage"
    model.short_description = "Tigerest RIFE 4.25 lite — 2x frame interpolation"
    model.license = "MIT; hzwer/Practical-RIFE"
    model.save(str(path))
    multiple = int(128 / scale)
    manifest = {
        "model": SOURCE["model"], "revision": SOURCE["revision"],
        "weights_sha256": SOURCE["files"]["train_log/flownet.pkl"],
        "width": width, "height": height, "scale": scale, "precision": precision,
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
    parser.add_argument("--precision", choices=("fp32", "fp16"), default="fp32")
    args = parser.parse_args()
    print(convert_model(args.source, args.output, args.width, args.height, args.scale, args.precision))
