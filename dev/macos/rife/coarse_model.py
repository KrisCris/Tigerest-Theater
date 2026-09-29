"""FP32 RIFE convolution stages, with spatial operations exposed for Metal.

Experimental: retains the verified Practical-RIFE weights and operation order.
The native backend must pass numerical and full-player qualification separately.
"""
import argparse
from pathlib import Path

from split_model import load_split_reference, low_rgb

SCALES = (32, 16, 8, 4)


def convolution(block):
    from torch import nn
    return nn.Sequential(block.conv0, block.convblock, block.lastconv).eval()


def run_stages(encoder, motion, a, b, fa, fb, predict, observe=None):
    import torch
    from torch.nn import functional as F
    warp = encoder.forward.__globals__["warp"]
    timestep = torch.ones_like(a[:, :1]) * .5
    flow = mask = features = None
    for i, scale in enumerate(SCALES):
        if i == 0:
            packed = torch.cat((a, b, fa, fb, timestep), 1)
        else:
            packed = torch.cat((warp(a, flow[:, :2]), warp(b, flow[:, 2:]),
                                warp(fa, flow[:, :2]), warp(fb, flow[:, 2:]),
                                timestep, mask, features), 1)
        packed = F.interpolate(packed, scale_factor=1/scale, mode="bilinear", align_corners=False)
        if i:
            packed = torch.cat((packed, F.interpolate(flow, scale_factor=1/scale,
                                mode="bilinear", align_corners=False)/scale), 1)
        raw = predict(i, packed)
        full = F.interpolate(raw, scale_factor=scale, mode="bilinear", align_corners=False)
        flow = full[:, :4]*scale if i == 0 else flow + full[:, :4]*scale
        mask, features = full[:, 4:5], full[:, 5:]
        if observe:
            observe(i, packed, raw, torch.cat((flow, mask, features), 1))
    packed = torch.cat((warp(a, flow[:, :2]), warp(b, flow[:, 2:]),
                        warp(fa, flow[:, :2]), warp(fb, flow[:, 2:]),
                        timestep, mask, features, flow), 1)
    return packed, flow


def export_coarse_stages(source, output, width, height):
    import coremltools as ct
    import numpy as np
    import torch
    torch.set_num_threads(4)
    _, motion = load_split_reference(source, width, height, .5)
    low = low_rgb(torch.zeros(1, 3, height, width), .5)
    output.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, scale in enumerate(SCALES):
        sample = torch.zeros(1, 15 if i == 0 else 28, low.shape[-2]//scale, low.shape[-1]//scale)
        with torch.inference_mode():
            traced = torch.jit.trace(convolution(motion.blocks[i]), sample, check_trace=False)
        model = ct.convert(traced, convert_to="mlprogram", minimum_deployment_target=ct.target.macOS15,
                           skip_model_load=True, compute_precision=ct.precision.FLOAT32,
                           inputs=[ct.TensorType(name="packed", shape=sample.shape, dtype=np.float32)],
                           outputs=[ct.TensorType(name="block_output", dtype=np.float32)])
        model.license = "MIT; hzwer/Practical-RIFE"
        model.short_description = f"Tigerest RIFE 4.25 lite FP32 coarse stage {i} (experimental)"
        path = output/f"Stage{i}.mlpackage"
        model.save(str(path))
        paths.append(path)
    return paths


def write_fixtures(source, output):
    import numpy as np
    import torch
    torch.set_num_threads(4)
    encoder, motion = load_split_reference(source, 192, 112, .5)
    first = torch.from_numpy(np.random.default_rng(1740).random((1,3,112,192), dtype=np.float32))
    with torch.inference_mode():
        for case, second in enumerate((first, first.roll(4,3), first.roll(12,2))):
            dest = output/str(case)
            dest.mkdir(parents=True, exist_ok=True)
            a,b = low_rgb(first,.5),low_rgb(second,.5)
            fa,fb = encoder(a),encoder(b)
            def save(name, value):
                value.contiguous().numpy().astype(np.float32).tofile(dest/(name+".f32"))
            for name, value in zip(("low0","low1","features0","features1"),(a,b,fa,fb)):
                save(name,value)
            def observe(i, packed, raw, state):
                save(f"packed{i}",packed); save(f"raw{i}",raw)
            packed,flow = run_stages(encoder,motion,a,b,fa,fb,
                lambda i,x:convolution(motion.blocks[i])(x),observe)
            save("packed4",packed.half().float()); save("flow",flow)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--width", type=int, required=True)
    p.add_argument("--height", type=int, required=True)
    p.add_argument("--fixtures", action="store_true")
    a = p.parse_args()
    print(export_coarse_stages(a.source, a.output, a.width, a.height))
    if a.fixtures:
        write_fixtures(a.source, a.output/"coarse-fixture")
