"""Real script/format tests: original samples stay unchanged across the RGB path."""
from array import array
from fractions import Fraction
import os
from pathlib import Path
import runpy
import unittest
from test_rife_vapoursynth import RifePluginTests
import vapoursynth as vs


class RifeScriptTests(RifePluginTests):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.build=staticmethod(runpy.run_path(str(Path(__file__).resolve().parents[1]/'resources/mpv/rife/interpolate.vpy'))['build_rife_filter'])

    def script(self,source):
        return self.build(source,{'model_path':str(self.model),'plugin_path':os.environ['RIFE_VS_PLUGIN'],
                                 'fps_num':24000,'fps_den':1001,'streaming':False})

    def raw_planes(self,frame):
        return [bytes(frame[c]) for c in range(frame.format.num_planes)]

    def test_yuv_originals_and_real_generated_middle(self):
        source=self.core.resize.Bicubic(self.source(),format=vs.YUV444P16,matrix=1,range=0)
        output=self.script(source)
        self.assertEqual((output.fps_num,output.fps_den,output.num_frames),(48000,1001,4))
        self.assertEqual(output.format.id,source.format.id)
        for n in (0,2,3):
            self.assertEqual(self.raw_planes(output.get_frame(n)),self.raw_planes(source.get_frame(n//2)))
        middle=output.get_frame(1)
        self.assertEqual(middle.props['_TigerestRifeSynthesized'],1)
        self.assertEqual(middle.props['_Range'],0)
        actual=self.values(self.core.resize.Bicubic(output,format=vs.RGBS).get_frame(1))
        reference=array('f',(self.model/'fixture/reference.f32').read_bytes())
        mse=sum((a-b)**2 for a,b in zip(actual,reference))/len(actual)
        self.assertLessEqual(mse,.0001)
        total=sum((Fraction(f.props['_DurationNum'],f.props['_DurationDen']) for f in output.frames()),Fraction())
        self.assertEqual(total,Fraction(2002,24000))

    def test_hdr_unknown_and_vfr_do_not_enter_rgb_conversion(self):
        source=self.core.resize.Bicubic(self.source(),format=vs.YUV420P10,matrix=1,range=0)
        for clip,reason in [(self.core.std.SetFrameProps(source,_Transfer=16,_Primaries=9,_Matrix=9),'hdr'),
                            (self.core.std.RemoveFrameProps(source,props=['_Transfer']),'unknown-color'),
                            (self.core.std.SetFrameProps(source,_DurationNum=1,_DurationDen=30),'vfr')]:
            with self.subTest(reason=reason):
                output=self.script(clip)
                for n in range(4):
                    frame=output.get_frame(n)
                    self.assertEqual(self.raw_planes(frame),self.raw_planes(clip.get_frame(n//2)))
                    self.assertEqual(frame.props['_TigerestRifeSynthesized'],0)
                    self.assertEqual(frame.props['_TigerestRifeReason'],reason)
                if reason=='vfr':
                    self.assertEqual(Fraction(frame.props['_DurationNum'],frame.props['_DurationDen']),Fraction(1,60))

    def test_crop_is_padded_for_model_and_restored_without_resizing(self):
        source=self.core.std.CropAbs(self.source(),width=112,height=96)
        output=self.script(source)
        self.assertEqual((output.width,output.height),(112,96))
        self.assertEqual(self.raw_planes(output.get_frame(0)),self.raw_planes(source.get_frame(0)))
        self.assertEqual(output.get_frame(1).props['_TigerestRifeSynthesized'],1)

    def test_small_source_cut_on_production_canvas(self):
        # Same 1920x1080 black padding used by the shipped model. A full cut
        # in 640x480 content must not be diluted by the surrounding canvas.
        model=self.model.parent/'1080-split-refine'
        a=self.core.std.BlankClip(width=640,height=480,length=1,format=vs.RGBS,
                                 fpsnum=24000,fpsden=1001,color=[0,0,0])
        b=self.core.std.BlankClip(a,color=[1,1,1])
        clip=self.core.std.SetFrameProps(a+b,_Matrix=0,_Primaries=1,_Transfer=1,_Range=1,
                                       _FieldBased=0,_DurationNum=1001,_DurationDen=24000)
        output=self.build(clip,{'model_path':str(model),'plugin_path':os.environ['RIFE_VS_PLUGIN'],
            'fps_num':24000,'fps_den':1001,'streaming':False,
            'pipeline':'split-coarse-metal','compute_policy':'cpu-ane'})
        middle=output.get_frame(1)
        self.assertEqual(middle.props['_TigerestRifeReason'],'cut')
        self.assertEqual(middle.props['_TigerestRifeSynthesized'],0)
        self.assertEqual(self.raw_planes(middle),self.raw_planes(clip.get_frame(0)))

    def test_ineligible_first_frame_keeps_the_item_bypassed(self):
        source=self.core.resize.Bicubic(self.source(),format=vs.YUV444P16,matrix=1,range=0)
        def vary(n,f):
            out=f.copy()
            if n==0:out.props['_DurationNum']=1;out.props['_DurationDen']=30
            return out
        clip=self.core.std.ModifyFrame(source,clips=source,selector=vary)
        output=self.script(clip)
        for n in range(4):
            frame=output.get_frame(n)
            self.assertEqual(frame.props['_TigerestRifeReason'],'vfr')
            self.assertEqual(self.raw_planes(frame),self.raw_planes(clip.get_frame(n//2)))


if __name__=='__main__':
    # Reuse fixtures/helpers without re-running the inherited plugin cases.
    suite=unittest.TestSuite(RifeScriptTests(name) for name in
        ('test_yuv_originals_and_real_generated_middle','test_hdr_unknown_and_vfr_do_not_enter_rgb_conversion',
         'test_crop_is_padded_for_model_and_restored_without_resizing','test_ineligible_first_frame_keeps_the_item_bypassed',
         'test_small_source_cut_on_production_canvas'))
    result=unittest.TextTestRunner().run(suite)
    raise SystemExit(not result.wasSuccessful())
