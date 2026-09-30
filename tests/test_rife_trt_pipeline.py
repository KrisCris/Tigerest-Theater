"""Real frame graph tests run with private Python, VS and a prepared engine."""
from array import array
from fractions import Fraction
import os
from pathlib import Path
import runpy
import subprocess
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = '--native' in sys.argv


@unittest.skipUnless(not NATIVE and os.environ.get('RIFE_TEST_RUNTIME'), 'requires private runtime')
class PrivatePipelineLauncher(unittest.TestCase):
    def test_real_frame_graph(self):
        runtime = Path(os.environ['RIFE_TEST_RUNTIME'])
        result = subprocess.run([str(runtime / 'python/python.exe'), '-B', '-I', '-S', '-X', 'utf8',
                                 str(Path(__file__).resolve()), '--native'],
                                capture_output=True, encoding='utf-8', timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('OK', result.stderr)
        self.assertNotIn('skipped', result.stderr)


@unittest.skipUnless(NATIVE, 'run through private interpreter')
class FrameGraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        runtime = Path(os.environ['RIFE_TEST_RUNTIME'])
        cls.dll_dirs = [os.add_dll_directory(str(runtime / relative)) for relative in
                        ('python', 'python/Lib/site-packages/vapoursynth', 'plugins', 'plugins/vsmlrt-cuda')]
        sys.path.insert(0, str(runtime / 'scripts'))
        sys.path.insert(0, str(runtime / 'plugins'))
        from native_probe import private_vapoursynth
        cls.vs = private_vapoursynth()
        cls.core = cls.vs.core
        cls.core.num_threads = 2
        cls.core.std.LoadPlugin(path=str(runtime / 'plugins/vstrt.dll'))
        cls.build = staticmethod(runpy.run_path(str(ROOT / 'resources/mpv/rife/trt_pipeline.py'))['build_rife_filter'])
        cls.engine = Path(os.environ.get('RIFE_TEST_ENGINE_PATH', str(ROOT / 'build/rife/smoke-engine/78326f97.engine')))
        implementation = int(os.environ.get('RIFE_TEST_IMPLEMENTATION', '1'))
        cls.options = {'engine_path': str(cls.engine), 'fps_num': 24, 'fps_den': 1,
                       'streaming': False, 'monitor': False, 'implementation': implementation,
                       'alignment': 1 if implementation == 2 else 128, 'num_streams': 2}

    def source(self, rate=Fraction(24), count=3):
        blank = self.core.std.BlankClip(width=256, height=128, format=self.vs.RGBS,
                                        length=count, fpsnum=rate.numerator, fpsden=rate.denominator)
        def motion(n, f):
            output = f.copy()
            for plane in range(3):
                for y in range(128):
                    row = array('f', [0.1] * 256)
                    if 32 <= y < 96:
                        row[64+n*16:128+n*16] = array('f', [0.8] * 64)
                    memoryview(output[plane]).cast('B')[y * output.get_stride(plane):
                        y * output.get_stride(plane) + 1024] = row.tobytes()
            output.props.update({'_Matrix': 0, '_Primaries': 1, '_Transfer': 1, '_Range': 1,
                                 '_FieldBased': 0, '_DurationNum': rate.denominator,
                                 '_DurationDen': rate.numerator, '_TigerestColorKnown': 1})
            return output
        return self.core.std.ModifyFrame(blank, clips=blank, selector=motion)

    def bytes(self, frame):
        return [bytes(frame[p]) for p in range(frame.format.num_planes)]

    def test_rates_originals_and_distinct_intermediate(self):
        for rate in (Fraction(24000, 1001), Fraction(24), Fraction(30)):
            source = self.source(rate)
            output = self.build(source, dict(self.options, fps_num=rate.numerator, fps_den=rate.denominator))
            self.assertEqual(Fraction(output.fps_num, output.fps_den), 2 * rate)
            frames = list(output.frames())
            self.assertEqual(len(frames), 6)
            self.assertEqual(sum((Fraction(f.props['_DurationNum'], f.props['_DurationDen']) for f in frames)), 3 / rate)
            for n in (0, 2, 4, 5):
                self.assertEqual(self.bytes(frames[n]), self.bytes(source.get_frame(n//2)))
                self.assertEqual(frames[n].props['_TigerestRifeSynthesized'], 0)
            self.assertNotEqual(self.bytes(frames[1]), self.bytes(source.get_frame(0)))
            self.assertNotEqual(self.bytes(frames[1]), self.bytes(source.get_frame(1)))
            self.assertEqual(frames[1].props['_TigerestRifeSynthesized'], 1)
            self.assertEqual(frames[1].props['_TigerestRifeTimingAvailable'], 0)
            self.assertNotIn('_TigerestRifeTimeMs', frames[1].props)

    def test_mpv_script_bridge_loads_private_plugins_and_returns_real_frames(self):
        plugin = ROOT / 'build/src/player/interpolation/tigerest-rife-vs.dll'
        options = dict(self.options, runtime_path=os.environ['RIFE_TEST_RUNTIME'],
                       trt_plugin_path=str(Path(os.environ['RIFE_TEST_RUNTIME']) / 'plugins/vstrt.dll'),
                       plugin_path=str(plugin), monitor=True)
        import json
        source = self.source(count=2)
        namespace = runpy.run_path(str(ROOT / 'resources/mpv/rife/interpolate_trt.vpy'),
                                  init_globals={'video_in': source, 'user_data': json.dumps(options)})
        output = self.vs.get_output(0).clip
        try:
            self.assertEqual(self.bytes(output.get_frame(0)), self.bytes(source.get_frame(0)))
            self.assertEqual(output.get_frame(1).props['_TigerestRifeSynthesized'], 1)
            self.assertEqual(output.get_frame(3).props['_TigerestRifeReason'], 'eof')
        finally:
            self.vs.clear_output(0)

    def test_yuv_original_pixels_and_range_survive_conversion(self):
        source = self.core.resize.Bicubic(self.source(), format=self.vs.YUV420P10, matrix=1, range=0)
        output = self.build(source, self.options)
        for n in (0, 2, 4, 5):
            self.assertEqual(self.bytes(output.get_frame(n)), self.bytes(source.get_frame(n//2)))
        middle = output.get_frame(1)
        self.assertEqual(middle.format.id, source.format.id)
        self.assertEqual(middle.props['_Range'], 0)
        self.assertEqual(middle.props['_TigerestRifeSynthesized'], 1)

    def test_integer_multiples_keep_originals_duration_and_distinct_timepoints(self):
        for rate, factor in ((Fraction(24000, 1001), 5), (Fraction(24), 10),
                             (Fraction(30), 8), (Fraction(60), 2), (Fraction(30), 4)):
            source = self.source(rate)
            output = self.build(source, dict(self.options, fps_num=rate.numerator,
                                            fps_den=rate.denominator, factor=factor))
            self.assertEqual(Fraction(output.fps_num, output.fps_den), factor * rate)
            frames = list(output.frames())
            self.assertEqual(len(frames), 3 * factor)
            self.assertEqual(sum(Fraction(f.props['_DurationNum'], f.props['_DurationDen'])
                                 for f in frames), 3 / rate)
            for n in range(3):
                self.assertEqual(self.bytes(frames[n*factor]), self.bytes(source.get_frame(n)))
            pixels = []
            for n in range(1, factor):
                f = frames[n]
                self.assertEqual(f.props['_TigerestRifeSynthesized'], 1)
                self.assertNotEqual(self.bytes(f), self.bytes(source.get_frame(0)))
                self.assertNotEqual(self.bytes(f), self.bytes(source.get_frame(1)))
                pixels.append(self.bytes(f))
            self.assertEqual(len({tuple(p) for p in pixels}), factor - 1)
            for f in frames[2*factor + 1:]:
                self.assertEqual(self.bytes(f), self.bytes(source.get_frame(2)))
                self.assertEqual(f.props['_TigerestRifeReason'], 'eof')
                self.assertEqual(f.props['_TigerestRifeSynthesized'], 0)

    def test_multiplied_streaming_eof_never_fetches_a_missing_neighbour(self):
        source = self.source(count=2).std.Loop(times=4)
        def truncate(n, f):
            if n >= 2:
                raise RuntimeError('Requested a nonexistent streaming neighbour')
            output = f.copy()
            output.props['_TigerestLastFrame'] = int(n == 1)
            return output
        source = self.core.std.ModifyFrame(source, clips=source, selector=truncate)
        output = self.build(source, dict(self.options, streaming=True, factor=10))
        for n in range(1, 10):
            self.assertEqual(output.get_frame(n).props['_TigerestRifeSynthesized'], 1)
        for n in range(11, 20):
            last = output.get_frame(n)
            self.assertEqual(last.props['_TigerestRifeReason'], 'eof')
            self.assertEqual(self.bytes(last), self.bytes(source.get_frame(1)))

    def test_4k60_single_frame_uses_original_resolution_and_exact_duration(self):
        source = self.core.std.BlankClip(width=3840, height=2160, format=self.vs.YUV420P10,
                                        length=1, fpsnum=60, fpsden=1)
        source = self.core.std.SetFrameProps(source, _Matrix=1, _Primaries=1, _Transfer=1,
                                            _Range=0, _FieldBased=0, _DurationNum=1, _DurationDen=60)
        output = self.build(source, dict(self.options, fps_num=60, factor=2))
        self.assertEqual((output.width, output.height), (3840, 2160))
        self.assertEqual(Fraction(output.fps_num, output.fps_den), 120)
        frames = list(output.frames())
        self.assertEqual(len(frames), 2)
        self.assertEqual(sum(Fraction(f.props['_DurationNum'], f.props['_DurationDen'])
                             for f in frames), Fraction(1, 60))
        for f in frames:
            self.assertEqual(self.bytes(f), self.bytes(source.get_frame(0)))
            self.assertEqual(f.props['_TigerestRifeSynthesized'], 0)

    def test_invalid_multipliers_cannot_overflow_mpv_virtual_frame_count(self):
        for factor in (1, 16, 0, -2, 2.5, '2', True):
            with self.assertRaisesRegex(ValueError, 'integer factor'):
                self.build(self.source(), dict(self.options, factor=factor))

    def test_cut_and_single_frame_do_not_claim_inference(self):
        first = self.core.std.BlankClip(width=256, height=128, format=self.vs.RGBS, length=1, color=[0.,0.,0.])
        second = self.core.std.BlankClip(first, color=[1.,1.,1.])
        source = self.core.std.SetFrameProps(first+second, _Matrix=0, _Primaries=1, _Transfer=1,
                                            _Range=1, _FieldBased=0, _DurationNum=1, _DurationDen=24)
        output = self.build(source, self.options)
        self.assertEqual(output.get_frame(1).props['_TigerestRifeReason'], 'cut')
        self.assertEqual(output.get_frame(1).props['_TigerestRifeSynthesized'], 0)
        for f in self.build(source[:1], self.options).frames():
            self.assertEqual(f.props['_TigerestRifeSynthesized'], 0)
        self.assertEqual(output.get_frame(3).props['_TigerestRifeReason'], 'eof')

    def test_streaming_last_marker_prevents_requesting_missing_neighbour(self):
        source = self.source(count=2).std.Loop(times=4)
        def truncate(n, f):
            if n >= 2:
                raise RuntimeError('Requested a nonexistent streaming neighbour')
            output = f.copy()
            output.props['_TigerestLastFrame'] = int(n == 1)
            return output
        source = self.core.std.ModifyFrame(source, clips=source, selector=truncate)
        output = self.build(source, dict(self.options, streaming=True))
        self.assertEqual(output.get_frame(1).props['_TigerestRifeSynthesized'], 1)
        last = output.get_frame(3)
        self.assertEqual(last.props['_TigerestRifeReason'], 'eof')
        self.assertEqual(self.bytes(last), self.bytes(source.get_frame(1)))

    def test_invalid_color_and_timing_keep_item_bypassed(self):
        for props, reason in (({'_Transfer':16}, 'hdr'), ({'_TigerestColorKnown':0}, 'unknown-color'),
                              ({'_FieldBased':1}, 'interlaced'),
                              ({'_DurationNum':1, '_DurationDen':60}, 'vfr')):
            source = self.core.std.SetFrameProps(self.source(), **props)
            output = self.build(source, self.options)
            for n, f in enumerate(output.frames()):
                self.assertEqual(self.bytes(f), self.bytes(source.get_frame(n//2)))
                self.assertEqual(f.props['_TigerestRifeReason'], reason)
                self.assertEqual(f.props['_TigerestRifeSynthesized'], 0)

    def test_padding_restores_content_dimensions_without_resizing(self):
        source = self.core.std.CropAbs(self.source(), width=240, height=112)
        options = dict(self.options)
        if options['implementation'] == 2:
            options['engine_path'] = os.environ['RIFE_TEST_UNALIGNED_ENGINE_PATH']
        output = self.build(source, options)
        self.assertEqual((output.width, output.height), (240, 112))
        self.assertEqual(self.bytes(output.get_frame(0)), self.bytes(source.get_frame(0)))
        self.assertEqual(output.get_frame(1).props['_TigerestRifeSynthesized'], 1)

    def test_missing_engine_is_rejected_without_compiling_during_playback(self):
        with self.assertRaisesRegex(ValueError, 'complete prepared RIFE engine'):
            self.build(self.source(), dict(self.options, engine_path=str(self.engine.parent / 'missing.engine')))

    def test_coordinate_inputs_match_upstream_at_repeated_frame_indices(self):
        import vsmlrt
        helper = runpy.run_path(str(ROOT / 'resources/mpv/rife/trt_pipeline.py'))['rife_inputs']
        source = self.source()
        expected = vsmlrt.get_rife_input(source)
        actual = helper(source)
        self.assertEqual(len(actual), 4)
        for original, replacement in zip(expected, actual):
            self.assertEqual(self.bytes(original.get_frame(0)), self.bytes(replacement.get_frame(0)))
            for n in (1, 2, 0):
                self.assertEqual(self.bytes(original.get_frame(n)), self.bytes(replacement.get_frame(n)))

    def test_parallel_frame_requests_construct_one_engine_context(self):
        namespace = runpy.run_path(str(ROOT / 'resources/mpv/rife/trt_pipeline.py'))
        native_vs, native_core = self.vs, self.core
        calls = []
        class TrtProxy:
            def Model(self, *args, **kwargs):
                calls.append(1)
                if len(calls) > 1:
                    raise RuntimeError('Duplicate concurrent engine construction')
                time.sleep(.1)  # Native creation releases the GIL too.
                return native_core.trt.Model(*args, **kwargs)
        class CoreProxy:
            trt = TrtProxy()
            def __getattr__(self, name):
                return getattr(native_core, name)
        class VsProxy:
            core = CoreProxy()
            def __getattr__(self, name):
                return getattr(native_vs, name)
        build = namespace['build_rife_filter']
        build.__globals__['vs'] = VsProxy()
        output = build(self.source(count=4), dict(self.options, factor=10))
        self.assertEqual(len(list(output.frames(prefetch=4))), 40)
        self.assertEqual(len(calls), 1)

    def test_cfr_tracker_accepts_timestamp_quantization_and_rejects_drift(self):
        tracker_class = runpy.run_path(str(ROOT / 'resources/mpv/rife/trt_pipeline.py'))['CfrTiming']
        rate = Fraction(24000, 1001)
        tracker = tracker_class(rate)
        for n in range(18000):
            start, end = round(n * 1000 / rate), round((n+1) * 1000 / rate)
            self.assertTrue(tracker.accept(n, Fraction(end-start, 1000)))
            self.assertTrue(tracker.accept(n, Fraction(end-start, 1000)))
        tracker = tracker_class(rate)
        self.assertTrue(tracker.accept(0, Fraction(41, 1000)))
        self.assertFalse(tracker.accept(1, Fraction(41, 1000)))

    def test_cfr_tracker_deduplicates_lookahead_and_parallel_request_order(self):
        tracker_class = runpy.run_path(str(ROOT / 'resources/mpv/rife/trt_pipeline.py'))['CfrTiming']
        tracker = tracker_class(Fraction(30))
        self.assertTrue(tracker.accept(1, Fraction(33, 1000)))
        self.assertTrue(tracker.accept(0, Fraction(33, 1000)))
        for _ in range(10):
            self.assertTrue(tracker.accept(0, Fraction(33, 1000)))
            self.assertTrue(tracker.accept(1, Fraction(33, 1000)))
        self.assertTrue(tracker.accept(2, Fraction(33, 1000)))
        self.assertFalse(tracker.accept(3, Fraction(33, 1000)))

    def test_multiplied_graph_rejects_cumulative_timing_drift(self):
        source = self.core.std.SetFrameProps(self.source(Fraction(30), count=6),
                                            _DurationNum=33, _DurationDen=1000)
        output = self.build(source, dict(self.options, fps_num=30, factor=10))
        frames = list(output.frames(prefetch=4))
        self.assertEqual(frames[-1].props['_TigerestRifeReason'], 'vfr')
        self.assertEqual(frames[-1].props['_TigerestRifeSynthesized'], 0)

    def test_qualified_cfr_normalizes_rounded_container_durations(self):
        rate = Fraction(24000, 1001)
        source = self.source(rate).std.Loop(times=44)[:131]
        def quantize(n, f):
            output = f.copy()
            output.props['_DurationNum'] = round((n+1) * 1000 / rate) - round(n * 1000 / rate)
            output.props['_DurationDen'] = 1000
            return output
        source = self.core.std.ModifyFrame(source, clips=source, selector=quantize)
        output = self.build(source, dict(self.options, fps_num=rate.numerator, fps_den=rate.denominator))
        durations = [Fraction(f.props['_DurationNum'], f.props['_DurationDen']) for f in output.frames()]
        self.assertEqual(sum(durations), 131 / rate)
        self.assertEqual(set(durations), {1 / (2 * rate)})


if __name__ == '__main__':
    if NATIVE:
        sys.argv.remove('--native')
        unittest.main(defaultTest='FrameGraphTests')
    else:
        unittest.main(defaultTest='PrivatePipelineLauncher')
