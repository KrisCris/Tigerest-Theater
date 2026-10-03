"""Exercise the native ZIP64 reader using actual sealed and hostile archives."""
import hashlib
import json
import json
import os
from pathlib import Path
import stat
import subprocess
import struct
import unittest
import zipfile

import test_rife_extension_package as fixture_api


class NativeExtensionTests(unittest.TestCase):
    def setUp(self):
        fixture=fixture_api.ExtensionPackageTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.fixture=fixture
        self.root=fixture.root
        self.catalog=fixture.catalog
        self.item=fixture.item
        self.archive=fixture.archive
        self.stage=self.root/'中文 安装暂存'
        self.stage.mkdir()
        self.host=Path(os.environ['RIFE_EXTENSION_ARCHIVE_HOST'])
        self.assertTrue(self.host.is_file(),'Native extension archive host must be built')

    def run_host(self,path=None,*,free='default',cancel=-1,app='2.1.2',package_id='rife-test-win64'):
        catalog=self.root/'trusted-catalog.json'
        catalog.write_text(json.dumps(self.catalog),encoding='utf-8')
        result=subprocess.run([str(self.host),str(path or self.archive),str(catalog),package_id,
            app,str(self.stage),str(free),str(cancel)],capture_output=True,timeout=20)
        self.assertIn(result.returncode,(0,2),result.stderr.decode(errors='replace'))
        report=json.loads(result.stdout)
        self.assertEqual(result.returncode,0 if report['ok'] else 2)
        return report

    def reject(self,path=None,pattern='',**kwargs):
        report=self.run_host(path,**kwargs)
        self.assertFalse(report['ok'],report)
        self.assertRegex(report['error'],pattern)
        return report

    def test_zip64_unicode_path_streams_exact_files(self):
        report=self.run_host()
        self.assertTrue(report['ok'],report)
        with zipfile.ZipFile(self.archive) as archive:
            for info in archive.infolist():
                self.assertEqual((self.stage/info.filename).read_bytes(),archive.read(info))
        self.assertEqual(report['manifest']['runtimeId'],'fixture-r79')

    def test_explicit_app_approval_installs_the_original_sealed_archive(self):
        self.item['compatibleAppVersions'] = ['3.0.0']
        report = self.run_host(app='3.0.0')
        self.assertTrue(report['ok'], report)
        self.assertEqual(report['manifest']['maxAppVersion'], '3.0.0')
        self.reject(app='3.0.1', pattern='application version')

    def test_catalog_cannot_relabel_a_sealed_gpu_architecture(self):
        self.item['gpuArchitecture']='sm89'
        self.reject(pattern='identity')

    def test_unknown_gpu_package_architecture_is_rejected_before_extracting(self):
        self.item['gpuArchitecture']='sm999'
        self.reject(pattern='GPU architecture')
        self.assertEqual(list(self.stage.iterdir()),[])

    def test_legacy_catalog_and_manifest_without_gpu_metadata_still_install(self):
        target=self.root/'legacy.zip'
        with zipfile.ZipFile(self.archive) as source,zipfile.ZipFile(target,'w') as output:
            for info in source.infolist():
                data=source.read(info)
                if info.filename=='extension.json':
                    manifest=json.loads(data);manifest.pop('gpuArchitecture')
                    data=json.dumps(manifest).encode()
                    self.item['manifestSha256']=hashlib.sha256(data).hexdigest()
                output.writestr(info,data)
        self.item.pop('gpuArchitecture')
        self.item['sha256']=hashlib.sha256(target.read_bytes()).hexdigest()
        self.item['downloadSize']=target.stat().st_size
        with zipfile.ZipFile(target) as source:
            self.item['unpackedSize']=sum(x.file_size for x in source.infolist())
        result=self.run_host(target)
        self.assertTrue(result['ok'],result)

    def test_catalog_and_disk_rejection_write_nothing(self):
        self.reject(package_id='unlisted',pattern='uniquely listed')
        self.reject(app='3.0.0',pattern='application version')
        self.item['architecture']='arm64'
        self.reject(pattern='architecture or ABI')
        self.item['architecture']='x64'
        self.item['sha256']='0'*64
        self.reject(pattern='Archive size/hash')
        self.item['sha256']=hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.reject(free=0,pattern='disk space')
        self.assertEqual(list(self.stage.iterdir()),[])

    def test_paths_attributes_and_windows_collisions(self):
        for name in ('../outside','/absolute','C:/outside','runtime/CON.txt','runtime/a.',
                     'runtime/a:b','runtime/NUL','runtime/COM¹.txt'):
            with self.subTest(name=name):
                target=self.fixture.malicious(lambda z:z.writestr(name,b'bad'))
                self.reject(target,pattern='archive file path')
                self.assertEqual(list(self.stage.iterdir()),[])
        for attrs in ((stat.S_IFLNK|0o777)<<16,0x10,0x400):
            info=zipfile.ZipInfo('runtime/link');info.external_attr=attrs
            self.reject(self.fixture.malicious(lambda z:z.writestr(info,b'bad')),pattern='link/non-file')
        self.reject(self.fixture.malicious(lambda z:z.writestr('RUNTIME/FIXTURE.DLL',b'bad')),pattern='Duplicate Windows')
        self.reject(self.fixture.malicious(lambda z:z.writestr('runtime',b'bad')),pattern='file/directory')

    def test_raw_names_and_manifest_anchor(self):
        # Reuse the raw-header generator; replace its verifier to capture each
        # actual hostile file before ZipInfo can truncate embedded NUL bytes.
        fixture=self.fixture
        original=fixture.verify
        def native_verify(path=None):
            report=self.reject(path,pattern='archive file path')
            raise ValueError('Invalid archive file path: '+report['error'])
        fixture.verify=native_verify
        fixture.test_raw_zip_names_cannot_hide_nul_or_windows_backslashes()
        fixture.verify=original
        self.item['sha256']=hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.item['downloadSize']=self.archive.stat().st_size
        self.item['manifestSha256']='0'*64
        self.reject(pattern='manifest hash differs')

    def test_changed_payload_is_rejected_by_inner_hash(self):
        target=self.root/'changed.zip'
        with zipfile.ZipFile(self.archive) as src,zipfile.ZipFile(target,'w') as dst:
            for info in src.infolist():
                dst.writestr(info,b'x'*info.file_size if info.filename=='runtime/fixture.dll' else src.read(info))
        self.item['sha256']=hashlib.sha256(target.read_bytes()).hexdigest()
        self.item['downloadSize']=target.stat().st_size
        self.reject(target,pattern='Corrupt extension file hash')
        self.assertFalse((self.stage/'runtime/fixture.dll').exists())

    def test_local_header_names_must_match_raw_central_names(self):
        with zipfile.ZipFile(self.archive) as archive:
            info=archive.getinfo('runtime/fixture.dll')
        original=self.archive.read_bytes()
        start=info.header_offset+30
        length=struct.unpack_from('<H',original,info.header_offset+26)[0]
        for index,name in enumerate((b'runtime\\fixture.dll',b'../'+b'x'*(length-3),b'runtime/fixture\0dll')):
            with self.subTest(name=name):
                self.stage=self.root/('local-stage-'+str(index));self.stage.mkdir()
                self.assertEqual(len(name),length)
                changed=bytearray(original);changed[start:start+length]=name
                target=self.root/'local-only.zip';target.write_bytes(changed)
                self.item['sha256']=hashlib.sha256(changed).hexdigest()
                self.item['downloadSize']=len(changed)
                self.reject(target,pattern='Local/central archive file path')
                self.assertEqual(list(self.stage.iterdir()),[])

    def test_cancel_during_streaming_discards_incomplete_file(self):
        payload=self.fixture.runtime/'large.bin';payload.write_bytes(b'large-payload-'*100000)
        manifest_path=self.fixture.runtime/'runtime.json'
        manifest=json.loads(manifest_path.read_text())
        manifest['files'].append({'path':payload.name,'size':payload.stat().st_size,
            'sha256':hashlib.sha256(payload.read_bytes()).hexdigest()})
        manifest_path.write_text(json.dumps(manifest))
        target=self.root/'large.zip'
        self.item=self.fixture.build(target)
        self.catalog={'schemaVersion':1,'packages':[self.item]}
        self.reject(target,cancel=32768,pattern='cancelled')
        self.assertFalse((self.stage/'runtime/large.bin').exists())
        self.assertFalse(list(self.stage.rglob('*.tmp')))
        # Entire failed staging cleanup belongs to the manager; complete earlier
        # entries may remain here, but no incomplete file is committed.

    def test_cancel_and_occupied_stage_do_not_overwrite(self):
        self.reject(cancel=0,pattern='cancelled')
        marker=self.stage/'owned.txt';marker.write_bytes(b'preserve')
        self.reject(pattern='empty staging directory')
        self.assertEqual(marker.read_bytes(),b'preserve')


if __name__=='__main__':
    unittest.main()
