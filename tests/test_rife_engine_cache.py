import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class EngineCacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('rife_engine_cache', ROOT / 'dev/windows/rife/engine_cache.py')
        cls.cache = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.cache)

    def identity(self):
        return self.cache.engine_identity(
            {'runtimeId': 'private-1', 'versions': {'tensorrt': '10.16'},
             'files': [{'path': 'plugin.dll', 'sha256': '1'*64, 'size': 12}]},
            {'id': 'rife-4.25-lite', 'sha256': '2'*64, 'alignment': 128, 'implementation': 1},
            {'uuid': '3'*32, 'driverVersion': '616.64', 'computeCapability': '8.9'}, 1920, 1080)

    def test_cache_is_specific_to_gpu_driver_runtime_weight_precision_and_shape(self):
        identity = self.identity()
        original = self.cache.cache_key(identity)
        for field, value in (('gpu', {'uuid': '4'*32}), ('modelSha256', '4'*64),
                             ('runtimeFingerprint', '4'*64), ('precision', 'fp32'),
                             ('shape', [1, 11, 2176, 3840])):
            changed = copy.deepcopy(identity)
            changed[field] = value
            self.assertNotEqual(self.cache.cache_key(changed), original, field)
        changed = copy.deepcopy(identity)
        changed['gpu']['driverVersion'] = '617.0'
        self.assertNotEqual(self.cache.cache_key(changed), original)
        self.assertEqual(identity['shape'], [1, 11, 1152, 1920])

    def test_partial_corrupt_or_mismatched_engines_are_never_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            identity = self.identity()
            self.assertIsNone(self.cache.read_cache(root, identity))

            stage = root / 'building.engine'
            stage.write_bytes(b'engine' * 500)
            ready = self.cache.commit_cache(root, identity, stage)
            self.assertEqual(self.cache.read_cache(root, identity), ready)
            ready.write_bytes(b'corrupt' * 500)
            self.assertIsNone(self.cache.read_cache(root, identity))
            stage.write_bytes(b'engine' * 500)
            ready = self.cache.commit_cache(root, identity, stage)
            marker = ready.parent / 'complete.json'
            record = json.loads(marker.read_text())
            record['identity']['gpu']['driverVersion'] = 'old-driver'
            marker.write_text(json.dumps(record))
            self.assertIsNone(self.cache.read_cache(root, identity))
            marker.unlink()
            self.assertIsNone(self.cache.read_cache(root, identity))

    def test_v2_internal_padding_uses_seven_half_planes_and_actual_dimensions(self):
        identity = self.cache.engine_identity(
            {'runtimeId': 'private-v2', 'versions': {'tensorrt': '10.13'}, 'files': []},
            {'id': 'rife-4.25-lite', 'sha256': '2'*64, 'alignment': 1, 'implementation': 2},
            {'uuid': '3'*32, 'driverVersion': '616.64', 'computeCapability': '8.9'}, 1920, 1080)
        self.assertEqual(identity['shape'], [1, 7, 1080, 1920])
        self.assertEqual(identity['precision'], 'fp16-fp16-io')
        self.assertEqual(identity['implementation'], 2)

    def test_tiny_failed_build_cannot_destroy_a_valid_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / 'building.engine'
            stage.write_bytes(b'engine' * 500)
            ready = self.cache.commit_cache(root, self.identity(), stage)
            stage.write_bytes(b'failed build')
            with self.assertRaisesRegex(ValueError, 'complete engine'):
                self.cache.commit_cache(root, self.identity(), stage)
            self.assertEqual(self.cache.read_cache(root, self.identity()), ready)

    def test_build_lock_releases_after_failure_and_cancel_does_not_enter(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            key = self.cache.cache_key(self.identity())
            with self.assertRaisesRegex(RuntimeError, 'failed'):
                with self.cache.build_lock(root, key, cancelled=lambda: False):
                    raise RuntimeError('failed')
            with self.cache.build_lock(root, key, cancelled=lambda: False):
                with self.assertRaises(TimeoutError):
                    with self.cache.build_lock(root, key, cancelled=lambda: False, timeout=0.1):
                        self.fail('same engine cannot have two builders')
            with self.assertRaisesRegex(InterruptedError, 'cancelled'):
                with self.cache.build_lock(root, key, cancelled=lambda: True):
                    self.fail('cancelled preparation cannot enter build')


if __name__ == '__main__':
    unittest.main()
