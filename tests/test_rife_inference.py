"""Opt-in real TensorRT smoke test; an installed host Python cannot satisfy it."""
import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.environ.get('RIFE_TEST_RUNTIME'), 'requires private NVIDIA runtime')
class TensorRtInferenceTests(unittest.TestCase):
    def test_model_generates_a_distinct_motion_frame(self):
        runtime = Path(os.environ['RIFE_TEST_RUNTIME'])
        report = ROOT / 'build/rife/inference-result.json'
        manifest = json.loads((runtime / 'runtime.json').read_text(encoding='utf-8'))
        command = [str(runtime / 'python/python.exe'), '-B', '-I', '-S', '-X', 'utf8',
                   str(ROOT / 'dev/windows/rife/inference_probe.py'),
                   '--runtime', str(runtime), '--cache', str(ROOT / 'build/rife/smoke-engine' / manifest['runtimeId']),
                   '--report', str(report)]
        result = subprocess.run(command, capture_output=True, encoding='utf-8', errors='replace', timeout=900)
        self.assertEqual(result.returncode, 0, result.stderr[-6000:])
        data = json.loads(report.read_text(encoding='utf-8'))
        self.assertTrue(data['ok'], data)
        self.assertEqual(data['model'], 'rife-4.25-lite')
        self.assertEqual(data['implementation'], 2)
        self.assertEqual(data['precision'], 'fp16-fp16-io')
        self.assertGreater(data['differenceFromLeft'], 0.001)
        self.assertGreater(data['differenceFromRight'], 0.001)
        self.assertEqual(data['outputDimensions'], [256, 128])
        self.assertTrue(data['privateLibrariesOnly'])
        self.assertGreater(data['engineBytes'], 1024)


if __name__ == '__main__':
    unittest.main()
