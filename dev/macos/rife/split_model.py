"""Experimental contiguous ANE encoder + FP32 GPU motion graph.

Motion ordering is derived from the hash-verified Practical-RIFE inference
source (hzwer, MIT); weights and original license are supplied by prepare_model.
This does not constitute a qualified playback backend until native tests pass.
"""
import argparse
import json
import math
from pathlib import Path

from convert_model import load_reference_model
from prepare_model import SOURCE


def low_rgb(frame, grid_scale):
    from torch.nn import functional as F
    if grid_scale not in (1., .5, .25):
        raise ValueError("Unsupported motion grid")
    h, w = frame.shape[-2:]
    multiple = int(128 / grid_scale)
    frame = F.pad(frame, (0, (multiple-w % multiple) % multiple, 0, (multiple-h % multiple) % multiple))
    return frame if grid_scale == 1 else F.interpolate(frame, scale_factor=grid_scale, mode="bilinear", align_corners=False)


def load_split_reference(source: Path, width: int, height: int, grid_scale: float):
    import torch
    from torch import nn
    from torch.nn import functional as F
    original = load_reference_model(source, grid_scale=grid_scale).network
    warp = original.forward.__globals__["warp"]
    multiple = int(128 / grid_scale)
    pad_h, pad_w = (multiple-height % multiple) % multiple, (multiple-width % multiple) % multiple

    class Motion(nn.Module):
        def __init__(self):
            super().__init__()
            self.blocks = nn.ModuleList([getattr(original, f"block{i}") for i in range(5)])

        def forward(self, frame0, frame1, low0, low1, features0, features1):
            timestep = torch.ones_like(low0[:, :1]) * .5
            warped0, warped1 = low0, low1
            flow = mask = features = None
            for i, block in enumerate(self.blocks):
                if i == 0:
                    flow, mask, features = block(torch.cat((low0, low1, features0, features1, timestep), 1),
                                                  None, scale=32)
                else:
                    wf0, wf1 = warp(features0, flow[:, :2]), warp(features1, flow[:, 2:4])
                    delta, mask, features = block(torch.cat((warped0, warped1, wf0, wf1, timestep, mask, features), 1),
                                                 flow, scale=(32,16,8,4,1)[i])
                    flow = flow + delta
                if i < 4:
                    warped0, warped1 = warp(low0, flow[:, :2]), warp(low1, flow[:, 2:4])
            if grid_scale != 1:
                flow = F.interpolate(flow, scale_factor=1/grid_scale, mode="bilinear", align_corners=False) / grid_scale
                mask = F.interpolate(mask, scale_factor=1/grid_scale, mode="bilinear", align_corners=False)
            mask = torch.sigmoid(mask)
            a, b = F.pad(frame0,(0,pad_w,0,pad_h)), F.pad(frame1,(0,pad_w,0,pad_h))
            output = warp(a,flow[:, :2])*mask + warp(b,flow[:, 2:4])*(1-mask)
            return output[:, :, :height, :width]

    return original.encode.eval(), Motion().eval()


def refinement_parts(encoder, motion, width, height, grid_scale):
    import torch
    from torch import nn
    from torch.nn import functional as F
    warp=encoder.forward.__globals__["warp"]
    multiple=int(128/grid_scale)
    pad_h,pad_w=(multiple-height%multiple)%multiple,(multiple-width%multiple)%multiple

    class Coarse(nn.Module):
        def __init__(self):
            super().__init__();self.blocks=nn.ModuleList(list(motion.blocks)[:4])
        def forward(self,low0,low1,features0,features1):
            timestep=torch.ones_like(low0[:,:1])*.5
            warped0,warped1=low0,low1
            flow=mask=features=None
            for i,block in enumerate(self.blocks):
                if i==0:
                    flow,mask,features=block(torch.cat((low0,low1,features0,features1,timestep),1),None,scale=32)
                else:
                    wf0,wf1=warp(features0,flow[:,:2]),warp(features1,flow[:,2:4])
                    delta,mask,features=block(torch.cat((warped0,warped1,wf0,wf1,timestep,mask,features),1),
                                              flow,scale=(32,16,8,4)[i])
                    flow=flow+delta
                warped0,warped1=warp(low0,flow[:,:2]),warp(low1,flow[:,2:4])
            wf0,wf1=warp(features0,flow[:,:2]),warp(features1,flow[:,2:4])
            return torch.cat((warped0,warped1,wf0,wf1,timestep,mask,features,flow),1),flow

    class Refine(nn.Module):
        def __init__(self):
            super().__init__();self.block=motion.blocks[4]
        def forward(self,refine_input):
            # The final official IFBlock uses scale=1. Move its input concat
            # into the GPU graph so this is one uninterrupted ANE conv block.
            features=self.block.conv0(refine_input)
            features=self.block.convblock(features)
            result=self.block.lastconv(features)
            return result[:,:4],result[:,4:5]

    class Warp(nn.Module):
        def forward(self,frame0,frame1,coarse_flow,delta,mask):
            flow=coarse_flow+delta
            if grid_scale!=1:
                flow=F.interpolate(flow,scale_factor=1/grid_scale,mode="bilinear",align_corners=False)/grid_scale
                mask=F.interpolate(mask,scale_factor=1/grid_scale,mode="bilinear",align_corners=False)
            mask=torch.sigmoid(mask)
            a,b=F.pad(frame0,(0,pad_w,0,pad_h)),F.pad(frame1,(0,pad_w,0,pad_h))
            result=warp(a,flow[:,:2])*mask+warp(b,flow[:,2:4])*(1-mask)
            return result[:,:,:height,:width]

    return Coarse().eval(),Refine().eval(),Warp().eval()


def convert_split_model(source: Path, output: Path, width: int, height: int, grid_scale: float = .5,
                        offload_refine: bool = False):
    import coremltools as ct
    import numpy as np
    import torch
    if width < 2 or height < 2:
        raise ValueError("Invalid dimensions")
    torch.set_num_threads(4)
    encoder, motion = load_split_reference(source, width, height, grid_scale)
    full = torch.zeros(1,3,height,width)
    low = low_rgb(full,grid_scale)
    with torch.inference_mode():
        features = encoder(low)
        traced_encoder = torch.jit.trace(encoder, (low,), check_trace=False)
    common = dict(convert_to="mlprogram", minimum_deployment_target=ct.target.macOS15, skip_model_load=True)
    encoder_model = ct.convert(traced_encoder, inputs=[ct.TensorType(name="rgb",shape=low.shape,dtype=np.float32)],
                               outputs=[ct.TensorType(name="features",dtype=np.float32)],
                               compute_precision=ct.precision.FLOAT16, **common)
    models={"encoder":encoder_model}
    def convert_part(module,samples,names,dtypes,outputs,precision):
        with torch.inference_mode():
            traced=torch.jit.trace(module,samples,check_trace=False)
        return ct.convert(traced,inputs=[ct.TensorType(name=n,shape=t.shape,dtype=d) for n,t,d in zip(names,samples,dtypes)],
                          outputs=[ct.TensorType(name=n,dtype=d) for n,d in outputs],compute_precision=precision,**common)
    if offload_refine:
        coarse,refine,warp=refinement_parts(encoder,motion,width,height,grid_scale)
        with torch.inference_mode():
            packed,flow=coarse(low,low,features,features)
            delta,mask=refine(packed)
        models["coarse"]=convert_part(coarse,(low,low,features,features),
            ("low0","low1","features0","features1"),(np.float32,)*4,
            (("refine_input",np.float16),("coarse_flow",np.float32)),ct.precision.FLOAT32)
        models["refine"]=convert_part(refine,(packed,),("refine_input",),(np.float16,),
            (("delta",np.float16),("mask",np.float16)),ct.precision.FLOAT16)
        models["warp"]=convert_part(warp,(full,full,flow,delta,mask),
            ("frame0","frame1","coarse_flow","delta","mask"),(np.float32,)*3+(np.float16,)*2,
            (("interpolated",np.float32),),ct.precision.FLOAT32)
    else:
        models["motion"]=convert_part(motion,(full,full,low,low,features,features),
            ("frame0","frame1","low0","low1","features0","features1"),(np.float32,)*6,
            (("interpolated",np.float32),),ct.precision.FLOAT32)
    output.mkdir(parents=True,exist_ok=True)
    paths={name:output/(name.title()+".mlpackage") for name in models}
    for name,model in models.items():
        model.license="MIT; hzwer/Practical-RIFE"
        model.short_description=f"Tigerest RIFE 4.25 lite split {name} (experimental)"
        model.save(str(paths[name]))
    manifest={"model":SOURCE["model"],"revision":SOURCE["revision"],
              "weights_sha256":SOURCE["files"]["train_log/flownet.pkl"],
              "pipeline":"ane-encoder-refine-gpu-motion" if offload_refine else "ane-encoder-gpu-motion","width":width,"height":height,
              "grid_scale":grid_scale,"scale":1.0,
              "low_width":int(low.shape[-1]),"low_height":int(low.shape[-2]),
              "precision":{name:("fp16" if name in ("encoder","refine") else "fp32") for name in models},
              "layout":"NCHW","dtype":"float32","artifacts":{k:v.name for k,v in paths.items()},
              "tools":{"torch":torch.__version__,"coremltools":ct.__version__,"numpy":np.__version__}}
    (output/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    return paths


if __name__ == "__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--width",type=int,required=True)
    p.add_argument("--height",type=int,required=True)
    p.add_argument("--grid-scale",type=float,default=.5)
    p.add_argument("--offload-refine",action="store_true")
    a=p.parse_args()
    print(convert_split_model(a.source,a.output,a.width,a.height,a.grid_scale,a.offload_refine))
