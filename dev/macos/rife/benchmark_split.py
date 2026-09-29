"""Compare the split graph with a cached GPU or ANE feature encoder."""
import argparse
import json
from pathlib import Path
import subprocess

from benchmark import evaluate_gate, fixture_matches, prepare_fixtures
from convert_model import compare_frames, load_reference_model


def run(model_dir, source, binary, output, compute="cpu-ane", warmup=30, iterations=120, reuse=True, reset_at=-1):
    import numpy as np
    import torch
    manifest=json.loads((model_dir/"manifest.json").read_text())
    fixtures=model_dir/"fixture"
    if not fixture_matches(fixtures,manifest) or not (fixtures/"reference-reverse.f32").exists():
        prepare_fixtures(source,fixtures,manifest["width"],manifest["height"],1.,manifest["grid_scale"])
        shape=(1,3,manifest["height"],manifest["width"])
        a=np.fromfile(fixtures/"frame0.f32",dtype=np.float32).reshape(shape)
        b=np.fromfile(fixtures/"frame1.f32",dtype=np.float32).reshape(shape)
        reference=load_reference_model(source,grid_scale=manifest["grid_scale"])
        with torch.inference_mode():
            reference(torch.from_numpy(b),torch.from_numpy(a)).numpy().tofile(fixtures/"reference-reverse.f32")
        (fixtures/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    output.parent.mkdir(parents=True,exist_ok=True)
    subprocess.run([str(binary.resolve()),"--model-dir",str(model_dir.resolve()),"--fixtures",str(fixtures.resolve()),
                    "--output",str(output.resolve()),"--encoder-compute",compute,"--warmup",str(warmup),
                    "--iterations",str(iterations),"--reuse",str(int(reuse)),"--reset-at",str(reset_at)],check=True,timeout=600)
    result=json.loads(output.read_text())
    expected=fixtures/("reference-reverse.f32" if result["final_pair_reversed"] else "reference.f32")
    result["parity"]=compare_frames(np.fromfile(expected,dtype=np.float32),np.fromfile(output.with_suffix(".f32"),dtype=np.float32))
    result["gate"]=evaluate_gate(result)
    output.write_text(json.dumps(result,indent=2)+"\n")
    return result


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model-dir",type=Path,required=True)
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--binary",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--compute",choices=("cpu-ane","cpu-gpu"),default="cpu-ane")
    p.add_argument("--warmup",type=int,default=30)
    p.add_argument("--iterations",type=int,default=120)
    p.add_argument("--no-reuse",action="store_true")
    p.add_argument("--reset-at",type=int,default=-1)
    a=p.parse_args()
    r=run(a.model_dir,a.source,a.binary,a.output,a.compute,a.warmup,a.iterations,not a.no_reuse,a.reset_at)
    keys=("compute","p50_ms","p95_ms","encoder_calls","feature_cache_hits","encoder_plan","motion_plan","parity","gate")
    print(json.dumps({k:r[k] for k in keys},indent=2))
