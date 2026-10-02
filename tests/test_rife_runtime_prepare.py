import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PREPARE = ROOT / 'dev/windows/rife/prepare_runtime.py'


class RuntimePreparationTests(unittest.TestCase):
    def test_copy_architecture_runtime_preserves_original_and_rejects_expansion(self):
        import test_rife_extension_package
        fixture=test_rife_extension_package.ExtensionPackageTests();fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        original=fixture.architecture_runtime()
        output=fixture.root/'sm89 runtime'
        result=subprocess.run([sys.executable,'-B','-X','utf8',str(PREPARE),
            '--from-runtime',str(fixture.runtime),'--output',str(output),'--gpu-architecture','sm89'],
            capture_output=True,encoding='utf-8',timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        manifest=json.loads((output/'runtime.json').read_text())
        self.assertEqual(manifest['gpuArchitecture'],'sm89')
        self.assertEqual(len(manifest['files']),3)
        self.assertEqual(json.loads((fixture.runtime/'runtime.json').read_text()),original)
        self.assertEqual({p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()},
            {'runtime.json','fixture.dll','plugins/vsmlrt-cuda/nvinfer_builder_resource_sm89_10.dll',
             'plugins/vsmlrt-cuda/nvinfer_builder_resource_ptx_10.dll'})
        result=subprocess.run([sys.executable,'-B','-X','utf8',str(PREPARE),
            '--from-runtime',str(output),'--output',str(fixture.root/'invalid'),'--gpu-architecture','full'],
            capture_output=True,encoding='utf-8',timeout=15)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Cannot expand',result.stderr)
        self.assertFalse((fixture.root/'invalid').exists())

    def test_three_v2_models_are_pinned_with_independent_hashes_and_internal_padding(self):
        lock = json.loads((PREPARE.parent / 'runtime-lock.json').read_text(encoding='utf-8'))
        models = {model['id']: model for model in lock['models']}
        self.assertEqual(set(models), {'rife-4.25-lite', 'rife-4.25', 'rife-4.25-heavy'})
        archives = {entry['id']: entry for entry in lock['archives']}
        for identifier in ('rife-4.25-lite', 'rife-4.25', 'rife-4.25-heavy'):
            model = models[identifier]
            self.assertEqual(model['alignment'], 1)
            self.assertEqual(model['implementation'], 2)
            self.assertTrue(model['member'].startswith('rife_v2/'))
            self.assertEqual(len(model['sha256']), 64)
            self.assertIn(model['archive'], archives)
            self.assertEqual(len(archives[model['archive']]['sha256']), 64)

    @unittest.skipUnless(os.environ.get('RIFE_TEST_ARCHIVES'), 'requires pinned archives')
    def test_real_offline_preparation_extracts_only_three_selected_models(self):
        with tempfile.TemporaryDirectory(prefix='三模型 ', dir=ROOT / 'build/rife') as temp:
            output = Path(temp) / '私有 运行库'
            result = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(PREPARE), '--output', str(output),
                                     '--archives', os.environ['RIFE_TEST_ARCHIVES'], '--offline'],
                                    capture_output=True, encoding='utf-8', timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            manifest = json.loads((output / 'runtime.json').read_text(encoding='utf-8'))
            self.assertEqual(len(manifest['models']), 3)
            self.assertEqual({p.relative_to(output).as_posix() for p in output.rglob('*.onnx')},
                             {m['path'] for m in manifest['models']})
            for model in manifest['models']:
                self.assertEqual(hashlib.sha256((output / model['path']).read_bytes()).hexdigest(),
                                 model['sha256'])

    def run_prepare(self, directory, archives, lock):
        return subprocess.run([sys.executable, '-B', '-X', 'utf8', str(PREPARE), '--output', str(directory),
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
