"""Actual patched Windows libmpv EOF and tiny TensorRT streaming, not rendering."""
from fractions import Fraction
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dev/windows/rife'))
from probe_runtime import verify_manifest
from engine_cache import engine_identity, read_cache

INSPECT = '''import json
from pathlib import Path
import vapoursynth as vs
report=Path(user_data)
def inspect(n,f):
    props=f.props
    row={'n':n,'last':props.get('_TigerestLastFrame',-1),
        'known':props.get('_TigerestColorKnown',-1), 'matrix':props.get('_Matrix',-1),
        'primaries':props.get('_Primaries',-1),'transfer':props.get('_Transfer',-1),
        'dn':props.get('_DurationNum',-1),'dd':props.get('_DurationDen',-1),
        'synthesized':props.get('_TigerestRifeSynthesized',0)}
    with report.open('a',encoding='utf-8') as out:out.write(json.dumps(row)+'\\n')
    return f
vs.core.std.ModifyFrame(video_in,clips=video_in,selector=inspect).set_output()
'''


@unittest.skipUnless(os.environ.get('RIFE_TEST_EOF_MPV_DLL') and os.environ.get('RIFE_TEST_STREAM_HOST'),
                     'requires explicit EOF-aware DLL and fresh native stream host')
class WindowsStreamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = Path(os.environ['RIFE_TEST_RUNTIME']).resolve()
        cls.manifest = verify_manifest(cls.runtime)
        cls.dll = Path(os.environ['RIFE_TEST_EOF_MPV_DLL']).resolve()
        cls.host = Path(os.environ['RIFE_TEST_STREAM_HOST']).resolve()
        cls.ffmpeg = os.environ.get('RIFE_TEST_FFMPEG', 'ffmpeg')
        cls.ffprobe = os.environ.get('RIFE_TEST_FFPROBE', str(Path(cls.ffmpeg).with_name('ffprobe'+Path(cls.ffmpeg).suffix)))

    def video(self, root, count, fps, known=True):
        path = root / '颜色 样本.mkv'
        command = [self.ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', f'testsrc2=size=256x128:rate={fps}',
            '-frames:v', str(count), '-c:v', 'ffv1']
        if known:
            command += ['-vf','setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
                '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
        subprocess.run(command + [str(path)], check=True, timeout=30, capture_output=True)
        probe = subprocess.run([self.ffprobe,'-v','error','-show_entries',
            'stream=color_range,color_space,color_transfer,color_primaries','-of','json',str(path)],
            check=True, timeout=30, capture_output=True)
        tags = json.loads(probe.stdout)['streams'][0]
        if known:
            self.assertEqual([tags.get(key) for key in ('color_range','color_space','color_transfer','color_primaries')],
                             ['tv','bt709','bt709','bt709'])
        else:
            self.assertTrue(any(key not in tags for key in ('color_space','color_transfer','color_primaries')))
        return path

    def run_clip(self, root, video, code, data, monitor=False):
        script, request, result = root / 'inspect.vpy', root / 'request.json', root / 'result.json'
        script.write_text(code, encoding='utf-8')
        request.write_text(json.dumps({'runtime': str(self.runtime), 'mpv': str(self.dll), 'media': str(video),
            'script': str(script), 'userData': data, 'monitor': monitor, 'result': str(result)}), encoding='utf-8')
        run = subprocess.run([str(self.host), str(request)], capture_output=True, timeout=30)
        report = json.loads(result.read_text(encoding='utf-8')) if result.exists() else {}
        if run.returncode:
            failure = ROOT / 'build/rife/stream-failures' / root.name
            failure.parent.mkdir(parents=True,exist_ok=True)
            shutil.copytree(root,failure)
            (failure/'stderr.txt').write_bytes(run.stderr)
        self.assertEqual(run.returncode, 0, {'report': report, 'stderr': run.stderr.decode('utf-8', errors='replace')})
        self.assertTrue(report['loaded'] and report['ended'], report)
        self.assertEqual((report['endReason'], report['endError']), (0, 0), report)
        return report

    def test_actual_single_two_and_three_frame_eof_and_colors(self):
        for count, fps in ((1, '24000/1001'), (2, '24'), (3, '60')):
            with self.subTest(count=count), tempfile.TemporaryDirectory(prefix='RIFE 尾帧 ') as temp:
                root = Path(temp)
                frames = root / 'frames.jsonl'
                self.run_clip(root, self.video(root, count, fps), INSPECT, str(frames))
                rows = [json.loads(line) for line in frames.read_text(encoding='utf-8').splitlines()]
                self.assertEqual(sorted((r['n'], r['last']) for r in rows), [(n, int(n == count-1)) for n in range(count)])
                self.assertTrue(all((r['known'], r['matrix'], r['primaries'], r['transfer']) == (1, 1, 1, 1) for r in rows), rows)

    def test_untagged_source_remains_unknown(self):
        with tempfile.TemporaryDirectory(prefix='RIFE 未标色彩 ') as temp:
            root = Path(temp)
            frames = root / 'frames.jsonl'
            self.run_clip(root, self.video(root, 2, '24', False), INSPECT, str(frames))
            rows = [json.loads(line) for line in frames.read_text(encoding='utf-8').splitlines()]
            self.assertEqual(len(rows), 2)
            self.assertTrue(all(r['known'] == 0 for r in rows), rows)

    @unittest.skipUnless(os.environ.get('RIFE_TEST_STREAM_PREPARED') and os.environ.get('RIFE_TEST_MONITOR_PLUGIN'),
                         'requires explicit validated tiny engine and Monitor plugin')
    def test_real_tiny_trt_multi_factor_stream_duration_and_tail(self):
        prepared = json.loads(Path(os.environ['RIFE_TEST_STREAM_PREPARED']).read_text(encoding='utf-8'))
        model = next(m for m in self.manifest['models'] if m['id'] == prepared['model'])
        identity = engine_identity(self.manifest, model, prepared['gpu'], 256, 128)
        engine = Path(prepared['enginePath']).resolve()
        self.assertTrue(prepared['ready'])
        self.assertEqual(prepared['identity'], identity)
        self.assertEqual(read_cache(engine.parent.parent, identity), engine)
        bridge = ROOT / 'resources/mpv/rife/interpolate_trt.vpy'
        plugin = Path(os.environ['RIFE_TEST_MONITOR_PLUGIN']).resolve()
        for count, factor in ((1, 2), (2, 5), (3, 10)):
            with self.subTest(count=count, factor=factor), tempfile.TemporaryDirectory(prefix='RIFE 补帧尾帧 ') as temp:
                root = Path(temp)
                frames = root / 'frames.jsonl'
                options = {'runtime_path': str(self.runtime), 'engine_path': prepared['enginePath'],
                    'plugin_path': str(plugin), 'trt_plugin_path': str(self.runtime / self.manifest['entrypoints']['plugin']),
                    'fps_num': 24000, 'fps_den': 1001, 'factor': factor, 'alignment': model['alignment'],
                    'implementation': model['implementation'], 'num_streams': 2, 'streaming': True, 'device_id': 0}
                # Run the production bridge, then inspect exactly the output
                # requested by mpv; no separate offline clip can satisfy this.
                code = "exec(compile(Path(" + json.dumps(str(bridge)) + ").read_text(encoding='utf-8')," + json.dumps(str(bridge)) + ", 'exec'))\n"
                code = 'from pathlib import Path\n__file__=' + json.dumps(str(bridge)) + '\n' + code + "clip=vs.get_output(0).clip\n"
                callback = INSPECT[INSPECT.index('def inspect'):]
                callback = callback.replace('ModifyFrame(video_in,clips=video_in', 'ModifyFrame(clip,clips=clip')
                code += 'report=Path(' + json.dumps(str(frames)) + ')\n' + callback
                report = self.run_clip(root, self.video(root, count, '24000/1001'), code, options, True)
                rows = [json.loads(line) for line in frames.read_text(encoding='utf-8').splitlines()]
                self.assertEqual(sorted(r['n'] for r in rows), list(range(count*factor)), rows)
                self.assertEqual(sum(Fraction(r['dn'], r['dd']) for r in rows), Fraction(count*1001,24000))
                self.assertTrue(all(Fraction(r['dn'], r['dd']) == Fraction(1001,24000*factor) for r in rows), rows)
                self.assertEqual(sorted((r['n'], r['synthesized']) for r in rows),
                    [(n, int(n%factor != 0 and n//factor < count-1)) for n in range(count*factor)], rows)
                generated = sum(r['synthesized'] for r in rows)
                self.assertEqual(generated, (count-1)*(factor-1), rows)
                self.assertEqual(report['generated'], generated, report)
                self.assertEqual(report['pairs'], count, report)
                self.assertGreater(report['epoch'], 0, report)
                self.assertFalse(report['timingAvailable'], report)


if __name__ == '__main__':
    unittest.main()
