"""Reference parity for FP32 coarse convolutions separated from spatial ops."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'dev/macos/rife'))
from coarse_model import export_coarse_stages, run_stages
from split_model import load_split_reference, refinement_parts, low_rgb

@unittest.skipUnless(os.environ.get('RIFE_TEST_MODEL'),'requires verified model and Core ML')
class CoarseConversionTests(unittest.TestCase):
    def test_staged_convolutions_match_original_coarse_graph(self):
        import coremltools as ct
        import numpy as np
        import torch
        torch.set_num_threads(4)
        source=Path(os.environ['RIFE_TEST_MODEL'])
        encoder,motion=load_split_reference(source,192,112,.5)
        coarse,_,_=refinement_parts(encoder,motion,192,112,.5)
        first=np.random.default_rng(1740).random((1,3,112,192),dtype=np.float32)
        with tempfile.TemporaryDirectory(prefix='rife-coarse-') as tmp:
            paths=export_coarse_stages(source,Path(tmp),192,112)
            models=[ct.models.MLModel(str(p),compute_units=ct.ComputeUnit.CPU_AND_GPU) for p in paths]
            def predict(i,x):
                return torch.from_numpy(models[i].predict({'packed':x.numpy()})['block_output'])
            for second in (first.copy(),np.roll(first,4,axis=3),np.roll(first,12,axis=2)):
                with torch.inference_mode():
                    a,b=low_rgb(torch.from_numpy(first),.5),low_rgb(torch.from_numpy(second),.5)
                    fa,fb=encoder(a),encoder(b)
                    expected=coarse(a,b,fa,fb)
                    actual=run_stages(encoder,motion,a,b,fa,fb,predict)
                for reference,result in zip(expected,actual):
                    difference=(reference-result).abs()
                    self.assertLess(float(difference.max()),.01)
                    self.assertLess(float(difference.mean()),.0001)

if __name__=='__main__':unittest.main()
