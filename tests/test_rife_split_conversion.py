"""Parity gate for explicit ANE encoder / GPU motion graph partitioning."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'dev/macos/rife'))
from split_model import convert_split_model, low_rgb, load_split_reference
from convert_model import load_reference_model, compare_frames

@unittest.skipUnless(os.environ.get('RIFE_TEST_MODEL'),'requires verified model and macOS Core ML')
class SplitConversionTests(unittest.TestCase):
    def test_encoder_and_final_refinement_on_ane_match_reference(self):
        import coremltools as ct
        import numpy as np
        import torch
        source=Path(os.environ['RIFE_TEST_MODEL'])
        reference=load_reference_model(source,grid_scale=.5)
        rng=np.random.default_rng(1044)
        first=rng.random((1,3,112,192),dtype=np.float32)
        with tempfile.TemporaryDirectory(prefix='rife-ane-refine-') as tmp:
            paths=convert_split_model(source,Path(tmp),192,112,.5,offload_refine=True)
            models={name:ct.models.MLModel(str(path),compute_units=(ct.ComputeUnit.CPU_AND_NE
                       if name in ('encoder','refine') else ct.ComputeUnit.CPU_AND_GPU)) for name,path in paths.items()}
            for second in (first.copy(),np.roll(first,4,axis=3),np.roll(first,12,axis=2)):
                a,b=torch.from_numpy(first),torch.from_numpy(second)
                with torch.inference_mode():
                    expected=reference(a,b).numpy();la,lb=low_rgb(a,.5),low_rgb(b,.5)
                fa=models['encoder'].predict({'rgb':la.numpy()})['features']
                fb=models['encoder'].predict({'rgb':lb.numpy()})['features']
                coarse=models['coarse'].predict({'low0':la.numpy(),'low1':lb.numpy(),'features0':fa,'features1':fb})
                fine=models['refine'].predict({'refine_input':coarse['refine_input']})
                actual=models['warp'].predict({'frame0':first,'frame1':second,'coarse_flow':coarse['coarse_flow'],
                                               'delta':fine['delta'],'mask':fine['mask']})['interpolated']
                metrics=compare_frames(expected,actual)
                print('ANE encoder/refinement parity:',metrics,flush=True)
                self.assertTrue(metrics['passed'],metrics)

    def test_split_encoder_on_ane_preserves_reference_motion(self):
        import coremltools as ct
        import numpy as np
        import torch
        source=Path(os.environ['RIFE_TEST_MODEL'])
        reference=load_reference_model(source,grid_scale=.5)
        encoder, motion=load_split_reference(source,192,112,.5)
        rng=np.random.default_rng(1044)
        first=rng.random((1,3,112,192),dtype=np.float32)
        with tempfile.TemporaryDirectory(prefix='rife-ane-split-') as tmp:
            paths=convert_split_model(source,Path(tmp),192,112,.5)
            enc=ct.models.MLModel(str(paths['encoder']),compute_units=ct.ComputeUnit.CPU_AND_NE)
            flow=ct.models.MLModel(str(paths['motion']),compute_units=ct.ComputeUnit.CPU_AND_GPU)
            for second in (first.copy(),np.roll(first,4,axis=3),np.roll(first,12,axis=2)):
                a,b=torch.from_numpy(first),torch.from_numpy(second)
                with torch.inference_mode():
                    expected=reference(a,b).numpy()
                    la,lb=low_rgb(a,.5),low_rgb(b,.5)
                    split=motion(a,b,la,lb,encoder(la),encoder(lb)).numpy()
                self.assertTrue(compare_frames(expected,split)['passed'])
                fa=enc.predict({'rgb':la.numpy()})['features']
                fb=enc.predict({'rgb':lb.numpy()})['features']
                actual=flow.predict({'frame0':first,'frame1':second,'low0':la.numpy(),'low1':lb.numpy(),
                                     'features0':fa,'features1':fb})['interpolated']
                metrics=compare_frames(expected,actual)
                print('ANE encoder + GPU motion parity:',metrics,flush=True)
                self.assertTrue(metrics['passed'],metrics)
                self.assertEqual(actual.shape,first.shape)
            manifest=json.loads((Path(tmp)/'manifest.json').read_text())
            self.assertEqual(manifest['pipeline'],'ane-encoder-gpu-motion')
            self.assertEqual((manifest['low_width'],manifest['low_height']),(128,128))

if __name__=='__main__':unittest.main()
