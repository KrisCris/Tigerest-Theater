import hashlib
import json
import mmap
import os
from pathlib import Path
import subprocess
import unittest
import test_rife_extension_package as fixture_api


class NativeManagerTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixture_api.ExtensionPackageTests();self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root=self.fixture.root
        self.data=self.root/'共享扩展'
        self.catalog=self.root/'catalog.json'
        self.host=os.environ['RIFE_EXTENSION_MANAGER_HOST']

    def run_host(self,action=None,*,free='default',option='',catalog=None):
        value=dict(catalog or self.fixture.catalog,testArchive=str(self.fixture.archive))
        self.catalog.write_text(json.dumps(value),encoding='utf-8')
        result=subprocess.run([self.host,str(action or self.fixture.archive),str(self.catalog),
            str(self.data),'2.1.2',str(free),option],capture_output=True,timeout=25)
        self.assertEqual(result.returncode,0,result.stderr.decode(errors='replace'))
        return json.loads(result.stdout)

    def test_atomic_import_restart_and_shared_single_copy(self):
        report=self.run_host()
        self.assertTrue(report['ok'],report)
        self.assertEqual(report['status']['state'],'restartRequired')
        self.assertEqual(report['paths'],{})
        before=(self.data/'active.json').read_bytes()
        loaded=self.run_host('initialize')
        self.assertTrue(loaded['ok'],loaded)
        self.assertEqual(loaded['status']['state'],'ready')
        runtime=Path(loaded['paths']['runtime'])
        self.assertEqual((runtime/'fixture.dll').read_bytes(),b'isolated-runtime-test-fixture')
        self.assertTrue(self.run_host()['ok'])
        self.assertEqual((self.data/'active.json').read_bytes(),before)
        self.assertEqual(len(list((self.data/'versions').iterdir())),1)

    def test_failures_cancel_and_space_preserve_active(self):
        self.assertTrue(self.run_host()['ok'])
        before=(self.data/'active.json').read_bytes()
        item=dict(self.fixture.item,sha256='0'*64)
        bad=self.run_host(catalog={'schemaVersion':1,'packages':[item]})
        self.assertFalse(bad['ok']);self.assertIn('trusted catalog',bad['error'])
        self.assertFalse(self.run_host(free=0)['ok'])
        cancelled=self.run_host(option='cancel')
        self.assertFalse(cancelled['ok']);self.assertIn('cancelled',cancelled['error'])
        self.assertEqual((self.data/'active.json').read_bytes(),before)

    def test_startup_rehash_rejects_corruption_and_extra_file(self):
        self.assertTrue(self.run_host()['ok'])
        loaded=self.run_host('initialize');runtime=Path(loaded['paths']['runtime'])
        payload=runtime/'fixture.dll';original=payload.read_bytes()
        payload.write_bytes(b'x'*len(original))
        bad=self.run_host('initialize')
        self.assertFalse(bad['ok']);self.assertIn('hash',bad['error']);self.assertEqual(bad['paths'],{})
        payload.write_bytes(original)
        (runtime/'unlisted.py').write_bytes(b'bad')
        bad=self.run_host('initialize')
        self.assertFalse(bad['ok']);self.assertIn('Unlisted',bad['error'])

    def test_unchanged_warm_start_reuses_verified_files(self):
        self.assertTrue(self.run_host()['ok'])
        cold=self.run_host('initialize')
        self.assertTrue(cold['ok'],cold)
        self.assertGreater(cold['status'].get('verificationHashedBytes',0),0)
        warm=self.run_host('initialize')
        self.assertTrue(warm['ok'],warm)
        self.assertEqual(warm['status'].get('verificationHashedBytes'),0)
        self.assertGreater(warm['status'].get('verificationCachedFiles',0),0)

    def test_cached_file_write_with_restored_mtime_is_revalidated(self):
        self.assertTrue(self.run_host()['ok'])
        loaded=self.run_host('initialize')
        payload=Path(loaded['paths']['runtime'])/'fixture.dll'
        before=payload.stat()
        payload.write_bytes(b'x'*before.st_size)
        os.utime(payload,ns=(before.st_atime_ns,before.st_mtime_ns))
        failed=self.run_host('initialize')
        self.assertFalse(failed['ok'],failed)
        self.assertIn('hash',failed['error'])
        self.assertEqual(failed['paths'],{})

    def test_modified_receipt_requires_full_verification(self):
        self.assertTrue(self.run_host()['ok'])
        self.assertTrue(self.run_host('initialize')['ok'])
        receipts=list((self.data/'verification').glob('*.bin'))
        self.assertEqual(len(receipts),1)
        receipts[0].write_bytes(b'forged verification record')
        loaded=self.run_host('initialize')
        self.assertTrue(loaded['ok'],loaded)
        self.assertGreater(loaded['status']['verificationHashedBytes'],0)
        self.assertEqual(loaded['status']['verificationCachedFiles'],0)

    def test_cached_mapped_write_is_revalidated(self):
        self.assertTrue(self.run_host()['ok'])
        loaded=self.run_host('initialize')
        payload=Path(loaded['paths']['runtime'])/'fixture.dll'
        with payload.open('r+b') as file:
            with mmap.mmap(file.fileno(),0,access=mmap.ACCESS_WRITE) as view:
                view[:]=b'x'*len(view)
                view.flush()
        failed=self.run_host('initialize')
        self.assertFalse(failed['ok'],failed)
        self.assertIn('hash',failed['error'])
        self.assertEqual(failed['paths'],{})

    def test_live_mapped_writer_cannot_create_or_reuse_receipts(self):
        self.assertTrue(self.run_host()['ok'])
        loaded=self.run_host('initialize')
        payload=Path(loaded['paths']['runtime'])/'fixture.dll'
        original=payload.read_bytes()
        with payload.open('r+b') as file:
            with mmap.mmap(file.fileno(),0,access=mmap.ACCESS_WRITE) as view:
                for content in [original,b'x'*len(original),original]:
                    view[:]=content
                    view.flush()
                    held=self.run_host('initialize')
                    self.assertFalse(held['ok'],held)
                    self.assertEqual(held['paths'],{})
        self.assertTrue(self.run_host('initialize')['ok'])

    def test_corrupt_trusted_extension_can_be_removed_and_imported_again(self):
        self.assertTrue(self.run_host()['ok'])
        loaded=self.run_host('initialize');runtime=Path(loaded['paths']['runtime'])
        (runtime/'fixture.dll').write_bytes(b'corrupt')
        failed=self.run_host('initialize')
        self.assertFalse(failed['ok']);self.assertEqual(failed['paths'],{})
        self.assertEqual(failed['status'].get('installedVersion'),loaded['paths']['versionKey'])
        removed=self.run_host('remove',option=failed['status']['installedVersion'])
        self.assertTrue(removed['ok']);self.assertFalse(removed['status'].get('installedVersion'))
        self.assertTrue(self.run_host()['ok'])
        self.assertTrue(self.run_host('initialize')['ok'])

    def test_untrusted_active_identity_does_not_expose_a_removal_key(self):
        self.assertTrue(self.run_host()['ok'])
        active=json.loads((self.data/'active.json').read_text())
        active['sha256']='0'*64
        (self.data/'active.json').write_text(json.dumps(active))
        failed=self.run_host('initialize')
        self.assertFalse(failed['ok']);self.assertEqual(failed['paths'],{})
        self.assertNotIn('installedVersion',failed['status'])

    def test_same_manager_clears_key_after_removing_corrupt_extension(self):
        self.assertTrue(self.run_host()['ok'])
        loaded=self.run_host('initialize');runtime=Path(loaded['paths']['runtime'])
        (runtime/'fixture.dll').write_bytes(b'corrupt')
        report=self.run_host('initialize',option='corruptRemove')
        self.assertFalse(report['ok']);self.assertTrue(report['removalOk'],report)
        self.assertFalse(report['removalStatus'].get('installedVersion'),report)

    def test_leased_version_is_retained_then_removed_on_next_start(self):
        self.assertTrue(self.run_host()['ok'])
        report=self.run_host('initialize',option='lease')
        self.assertTrue(report['heldRuntimeExists'],report)
        self.assertEqual(report['paths']['runtime'],report['secondPaths']['runtime'])
        self.assertTrue(report['removalStatus']['removalPending'])
        self.assertTrue(self.run_host('initialize')['ok'])
        self.assertEqual(list((self.data/'versions').iterdir()),[])
        self.assertFalse((self.data/'active.json').exists())

    def test_removal_rejects_foreign_path(self):
        self.assertTrue(self.run_host()['ok'])
        before=(self.data/'active.json').read_bytes()
        report=self.run_host('remove',option='../outside')
        self.assertFalse(report['ok']);self.assertIn('installed version',report['error'])
        self.assertEqual((self.data/'active.json').read_bytes(),before)

    def test_reinstall_cancels_pending_removal(self):
        self.assertTrue(self.run_host()['ok'])
        report=self.run_host('initialize',option='reinstall')
        self.assertTrue(report['reinstallOk'],report)
        loaded=self.run_host('initialize')
        self.assertTrue(loaded['ok'],loaded)
        self.assertTrue(Path(loaded['paths']['runtime']).is_dir())

    def test_completion_status_reentry_keeps_new_operation_busy(self):
        report=self.run_host(option='reenter')
        self.assertTrue(report['ok'],report)
        self.assertFalse(report['busyLostWhileInstalling'],report)

    def test_duplicate_request_does_not_finish_the_active_install(self):
        report=self.run_host(option='duplicate')
        self.assertTrue(report['ok'],report)
        self.assertEqual(report['completions'],1,report)
        self.assertEqual(report['rejections'],1,report)
        self.assertFalse(report['status']['busy'],report)
        self.assertTrue((self.data/'active.json').is_file())

    def test_loaded_runtime_cannot_be_reinitialized_without_restart(self):
        self.assertTrue(self.run_host()['ok'])
        report=self.run_host('initialize',option='doubleInitialize')
        self.assertFalse(report['secondOk'],report)
        self.assertIn('restart',report['secondError'])
        self.assertEqual(report['paths'],report['secondPaths'])

    def test_busy_initialize_with_loaded_lease_does_not_finish_active_install(self):
        self.assertTrue(self.run_host()['ok'])
        report=self.run_host('initialize',option='busyInitialize')
        self.assertTrue(report['secondOk'],report)
        self.assertEqual(report['secondCompletions'],1,report)
        self.assertEqual(report['rejections'],1,report)
        self.assertEqual(report['paths'],report['secondPaths'])

    def test_cancelled_startup_does_not_remove_pending_version(self):
        self.assertTrue(self.run_host()['ok'])
        self.assertTrue(self.run_host('initialize',option='lease')['heldRuntimeExists'])
        report=self.run_host('initialize',option='cancel')
        self.assertFalse(report['ok'],report)
        self.assertIn('cancelled',report['error'])
        self.assertEqual(len(list((self.data/'versions').iterdir())),1)

    def test_actual_other_process_lease_prevents_removal(self):
        self.assertTrue(self.run_host()['ok'])
        holder=subprocess.Popen([self.host,'initialize',str(self.catalog),str(self.data),'2.1.2','default','hold'],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            report=json.loads(holder.stdout.readline())
            self.assertTrue(report['ok'],report)
            key=report['paths']['versionKey'];runtime=Path(report['paths']['runtime'])
            removed=self.run_host('remove',option=key)
            self.assertTrue(removed['ok'],removed)
            self.assertTrue(removed['status']['removalPending'])
            self.assertTrue(runtime.is_dir())
        finally:
            try:holder.communicate(input=b'\n',timeout=5)
            except subprocess.TimeoutExpired:
                holder.kill();holder.communicate()
        self.assertEqual(holder.returncode,0)
        self.assertTrue(self.run_host('initialize')['ok'])
        self.assertFalse(runtime.exists())


if __name__=='__main__':unittest.main()
