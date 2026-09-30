import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PREPARE = ROOT / 'dev/windows/rife/prepare_runtime.py'


class RuntimePreparationTests(unittest.TestCase):
    def run_prepare(self, directory, archives, lock):
        return subprocess.run([sys.executable, str(PREPARE), '--output', str(directory),
                               '--archives', str(archives), '--lock', str(lock), '--offline'],
                              capture_output=True, text=True, timeout=20)

    def test_corrupt_cached_download_does_not_replace_existing_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            output = base / 'existing runtime'
            output.mkdir()
            (output / 'keep.bin').write_bytes(b'existing valid runtime')
            archives = base / 'downloads'
            archives.mkdir()
            (archives / 'python.zip').write_bytes(b'corrupt')
            lock = base / 'lock.json'
            lock.write_text(json.dumps({'schemaVersion': 1, 'runtimeId': 'test',
                'archives': [{'id': 'python', 'file': 'python.zip', 'size': 7,
                              'sha256': hashlib.sha256(b'correct').hexdigest(),
                              'url': 'https://example.invalid/python.zip'}]}))
            result = self.run_prepare(output, archives, lock)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('SHA256', result.stderr)
            self.assertEqual((output / 'keep.bin').read_bytes(), b'existing valid runtime')
            self.assertEqual(list(output.iterdir()), [output / 'keep.bin'])

    def test_offline_missing_archive_reports_dependency_without_using_host(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            lock = base / 'lock.json'
            lock.write_text(json.dumps({'schemaVersion': 1, 'runtimeId': 'test',
                'archives': [{'id': 'python', 'file': 'python.zip', 'size': 7,
                              'sha256': hashlib.sha256(b'correct').hexdigest(),
                              'url': 'https://example.invalid/python.zip'}]}))
            result = self.run_prepare(base / 'new-runtime', base / 'downloads', lock)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Offline archive missing: python.zip', result.stderr)
            self.assertFalse((base / 'new-runtime').exists())


if __name__ == '__main__':
    unittest.main()
