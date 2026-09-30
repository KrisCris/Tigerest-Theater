import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
PREPARE = ROOT / 'dev/windows/rife/prepare_engine.py'


class EnginePreparationTests(unittest.TestCase):
    @unittest.skipUnless(os.name == 'nt', 'Windows worker supervision')
    def test_timeout_interrupts_blocking_native_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            script = Path(temp) / 'timeout.py'
            script.write_text('import sys, time\n'
                f'sys.path.insert(0, {str(ROOT / "dev/windows/rife")!r})\n'
                'import native_prepare_engine as p\n'
                'from windows_job import attach_cleanup_job\njob = attach_cleanup_job()\n'
                'p.check_inference = lambda *args: time.sleep(60)\n'
                'p.validate_engine(None,None,None,None,0,lambda:False,time.monotonic()-901)\n', encoding='utf-8')
            process = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(script)],
                                     capture_output=True, encoding='utf-8', timeout=2)
            self.assertNotEqual(process.returncode, 0, process.stderr)
            report = json.loads(process.stdout)
            self.assertFalse(report['ready'])
            self.assertIn('15 minutes', report['error'])

    @unittest.skipUnless(os.name == 'nt', 'Windows worker supervision')
    def test_cancel_interrupts_blocking_native_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cancel, started, script = root / 'cancel', root / 'started', root / 'blocked.py'
            script.write_text('import sys, time\nfrom pathlib import Path\n'
                f'sys.path.insert(0, {str(ROOT / "dev/windows/rife")!r})\n'
                'import native_prepare_engine as p\n'
                'from windows_job import attach_cleanup_job\njob = attach_cleanup_job()\n'
                'def blocked(*args):\n'
                f'    Path({str(started)!r}).touch()\n'
                '    time.sleep(60)\n'
                'p.check_inference = blocked\n'
                f'cancel = Path({str(cancel)!r})\n'
                'p.validate_engine(None, None, None, None, 0, cancel.exists, time.monotonic())\n', encoding='utf-8')
            process = subprocess.Popen([sys.executable, '-B', '-X', 'utf8', str(script)],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding='utf-8')
            try:
                deadline = time.monotonic() + 5
                while not started.is_file() and time.monotonic() < deadline and process.poll() is None:
                    time.sleep(.05)
                if not started.is_file():
                    if process.poll() is None:
                        process.kill()
                    self.fail(str(process.communicate(timeout=5)))
                cancel.touch()
                stdout, stderr = process.communicate(timeout=2)
                self.assertNotEqual(process.returncode, 0, stderr)
                report = json.loads(stdout)
                self.assertFalse(report['ready'])
                self.assertIn('cancelled', report['error'])
            finally:
                if process.poll() is None:
                    process.kill()
                process.communicate(timeout=5)

    def run_prepare(self, request, timeout=30):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, result = root / 'request.json', root / 'result.json'
            source.write_text(json.dumps(request), encoding='utf-8')
            process = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(PREPARE), '--request', str(source),
                                      '--result', str(result)], capture_output=True,
                                     encoding='utf-8', timeout=timeout)
            self.assertTrue(result.is_file(), process.stdout + process.stderr)
            return process.returncode, json.loads(result.read_text(encoding='utf-8'))

    def test_missing_private_runtime_cannot_compile_using_host_tensor_rt(self):
        with tempfile.TemporaryDirectory() as temp:
            code, report = self.run_prepare({'runtime': str(Path(temp) / 'missing'),
                'cache': str(Path(temp) / 'cache'), 'model': 'rife-4.25-lite', 'width': 1920, 'height': 1080})
            self.assertNotEqual(code, 0)
            self.assertFalse(report['ready'])
            self.assertIn('manifest is missing', report['error'])

    def test_media_urls_and_arbitrary_compiler_arguments_are_rejected(self):
        for key in ('mediaUrl', 'command', 'customArgs'):
            code, report = self.run_prepare({'runtime': 'missing', 'cache': 'cache',
                                            'model': 'rife-4.25-lite', 'width': 256, 'height': 128, key: 'secret'})
            self.assertNotEqual(code, 0)
            self.assertFalse(report['ready'])
            self.assertIn('Unsupported request fields', report['error'])
            self.assertNotIn('secret', report['error'])

    @unittest.skipUnless(os.environ.get('RIFE_TEST_ENGINE_RUNTIME'), 'requires private runtime and GPU')
    def test_cancelled_build_never_creates_a_ready_cache(self):
        with tempfile.TemporaryDirectory(prefix='取消 引擎 ', dir=ROOT / 'build/rife') as temp:
            root = Path(temp)
            cancel = root / 'cancel'
            cancel.touch()
            code, report = self.run_prepare({'runtime': os.environ['RIFE_TEST_ENGINE_RUNTIME'],
                'cache': str(root / 'cache'), 'cancelFile': str(cancel),
                'model': 'rife-4.25-lite', 'width': 256, 'height': 128}, timeout=60)
            self.assertNotEqual(code, 0)
            self.assertFalse(report['ready'])
            self.assertIn('cancelled', report['error'])
            self.assertEqual(list((root / 'cache').rglob('complete.json')), [])

    @unittest.skipUnless(os.environ.get('RIFE_TEST_ENGINE_RUNTIME'), 'requires private runtime and GPU')
    def test_real_engine_preparation_and_cache_hit_in_chinese_path(self):
        cache = ROOT / 'build/rife/引擎 缓存'
        request = {'runtime': os.environ['RIFE_TEST_ENGINE_RUNTIME'], 'cache': str(cache),
                   'model': 'rife-4.25-lite', 'width': 256, 'height': 128}
        code, report = self.run_prepare(request, timeout=900)
        self.assertEqual(code, 0, report)
        self.assertTrue(report['ready'])
        self.assertTrue(report['validatedInference'])
        self.assertTrue(Path(report['enginePath']).is_file())
        code, hit = self.run_prepare(request, timeout=60)
        self.assertEqual(code, 0, hit)
        self.assertTrue(hit['cacheHit'])
        self.assertEqual(hit['enginePath'], report['enginePath'])
        self.assertEqual(hit['cacheKey'], report['cacheKey'])


if __name__ == '__main__':
    unittest.main()
