"""Actual local TLS transfers: range/ETag/cancel/error isolation; no public network."""
import hashlib
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import os
from pathlib import Path
import ssl
import subprocess
import threading
import time
import unittest
import test_rife_extension_package as fixture_api


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixture_api.ExtensionPackageTests();self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups);self.root=self.fixture.root
        payload=self.fixture.runtime/'large.bin';payload.write_bytes(os.urandom(600000))
        manifest_path=self.fixture.runtime/'runtime.json';manifest=json.loads(manifest_path.read_text())
        manifest['files'].append({'path':payload.name,'size':payload.stat().st_size,'sha256':hashlib.sha256(payload.read_bytes()).hexdigest()})
        manifest_path.write_text(json.dumps(manifest))
        self.archive=self.root/'large.zip';self.item=self.fixture.build(self.archive)
        self.body=self.archive.read_bytes();self.requests=[];self.http_requests=[];self.mode='normal'
        self.etag='"fixture-v1"';self.slow=False
        fixtures=Path(__file__).parent/'fixtures/rife-download'
        self.ca=fixtures/'loopback-cert.pem';key_path=fixtures/'loopback-test-key.pem'
        test=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                destination=test.http_requests if self.server is test.http_server else test.requests
                destination.append({key.lower():value for key,value in self.headers.items()})
                if test.mode=='downgrade' and self.server is test.server:
                    self.send_response(302);self.send_header('Location',f'http://127.0.0.1:{test.http_server.server_port}/extension.zip')
                    self.send_header('Content-Length','0');self.end_headers();return
                offset=int(self.headers.get('Range','bytes=0-')[6:].split('-')[0])
                ranged='Range' in self.headers and test.mode!='ignore-range'
                self.send_response(206 if ranged else 200)
                self.send_header('ETag','"fixture-v2"' if ranged and test.mode=='changed-etag' else test.etag)
                if ranged:self.send_header('Content-Range',f'bytes {offset}-{len(test.body)-1}/{len(test.body)}')
                else:offset=0
                self.send_header('Content-Length',str(len(test.body)-offset));self.end_headers()
                try:
                    for start in range(offset,len(test.body),16384):
                        block=test.body[start:start+16384]
                        if test.mode=='corrupt':block=bytes(b^1 for b in block)
                        self.wfile.write(block);self.wfile.flush()
                        if test.slow:time.sleep(0.02)
                except (BrokenPipeError,ConnectionResetError,ssl.SSLError):pass
        self.http_server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        http_thread=threading.Thread(target=self.http_server.serve_forever,daemon=True);http_thread.start()
        self.addCleanup(self.http_server.server_close);self.addCleanup(self.http_server.shutdown)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(str(self.ca),str(key_path))
        self.server.socket=context.wrap_socket(self.server.socket,server_side=True)
        thread=threading.Thread(target=self.server.serve_forever,daemon=True);thread.start()
        self.addCleanup(self.server.server_close);self.addCleanup(self.server.shutdown)
        self.url=f'https://127.0.0.1:{self.server.server_port}/extension.zip';self.item['url']=self.url
        self.data=self.root/'共享 下载扩展';self.catalog=self.root/'catalog.json'
        self.host=os.environ['RIFE_EXTENSION_MANAGER_HOST']

    def run_download(self,cancel_at=-1,*,action='download',trust=True):
        self.catalog.write_text(json.dumps({'schemaVersion':1,'packages':[self.item]}),encoding='utf-8')
        options=self.root/'options.json';options.write_text(json.dumps({'ca':str(self.ca),'cancelAt':cancel_at,'trustTestCa':trust}),encoding='utf-8')
        result=subprocess.run([self.host,action,str(self.catalog),str(self.data),'2.1.2','default',str(options)],capture_output=True,timeout=25)
        self.assertEqual(result.returncode,0,result.stderr.decode(errors='replace'))
        return json.loads(result.stdout)

    def seed_partial(self,offset=50000):
        directory=self.data/'downloads';directory.mkdir(parents=True,exist_ok=True)
        (directory/(self.item['sha256']+'.zip.part')).write_bytes(self.body[:offset])
        (directory/(self.item['sha256']+'.json')).write_text(json.dumps({'schemaVersion':1,'url':self.url,
            'sha256':self.item['sha256'],'size':len(self.body),'etag':self.etag}))

    def test_fresh_tls_has_no_emby_auth_headers(self):
        report=self.run_download();self.assertTrue(report['ok'],report)
        self.assertEqual(report['status']['state'],'restartRequired')
        self.assertEqual(len(self.requests),1)
        headers={key.lower():value for key,value in self.requests[0].items()}
        for key in ('authorization','x-emby-token','x-mediabrowser-token','cookie'):
            self.assertNotIn(key,headers)

    def test_strong_etag_range_resumes_exact_offset(self):
        self.seed_partial();report=self.run_download();self.assertTrue(report['ok'],report)
        self.assertEqual(self.requests[0]['range'],'bytes=50000-')
        self.assertEqual(self.requests[0]['if-range'],self.etag)

    def test_ignored_range_truncates_instead_of_appending(self):
        self.seed_partial();self.mode='ignore-range'
        report=self.run_download();self.assertTrue(report['ok'],report)
        self.assertEqual(len(self.requests),1)

    def test_changed_etag_partial_response_retries_fresh(self):
        self.seed_partial();self.mode='changed-etag'
        report=self.run_download();self.assertTrue(report['ok'],report)
        self.assertEqual(len(self.requests),2)
        self.assertIn('range',self.requests[0]);self.assertNotIn('range',self.requests[1])

    def test_cancel_keeps_resumable_partial_and_retry_installs(self):
        self.slow=True
        report=self.run_download(cancel_at=65536)
        self.assertFalse(report['ok']);self.assertIn('cancelled',report['error'])
        self.assertFalse((self.data/'active.json').exists())
        partial=self.data/'downloads'/(self.item['sha256']+'.zip.part')
        offset=partial.stat().st_size;self.assertGreaterEqual(offset,65536);self.assertLess(offset,len(self.body))
        self.slow=False;report=self.run_download();self.assertTrue(report['ok'],report)
        self.assertEqual(self.requests[-1]['range'],f'bytes={offset}-')

    def test_bad_body_hash_never_installs(self):
        self.mode='corrupt';report=self.run_download()
        self.assertFalse(report['ok']);self.assertIn('hash',report['error'])
        self.assertFalse((self.data/'active.json').exists())

    def test_cancel_verifying_complete_cache_preserves_archive(self):
        self.seed_partial(offset=len(self.body))
        partial=self.data/'downloads'/(self.item['sha256']+'.zip.part')
        report=self.run_download(action='verifyCacheCancel')
        self.assertFalse(report['ok'],report);self.assertIn('cancelled',report['error'])
        self.assertEqual(partial.read_bytes(),self.body)
        self.assertEqual(self.requests,[])

    def test_default_trust_rejects_self_signed_server(self):
        report=self.run_download(trust=False)
        self.assertFalse(report['ok'],report)
        self.assertFalse((self.data/'active.json').exists())
        self.assertEqual(self.requests,[])

    def test_https_downgrade_redirect_is_rejected(self):
        self.mode='downgrade';report=self.run_download()
        self.assertFalse(report['ok'],report)
        self.assertFalse((self.data/'active.json').exists())
        self.assertEqual(len(self.requests),1)
        self.assertEqual(self.http_requests,[],'The real plaintext listener must receive no downgraded request')

    def test_weak_etag_cannot_resume(self):
        self.etag='W/"fixture-v1"';self.seed_partial()
        report=self.run_download();self.assertTrue(report['ok'],report)
        self.assertNotIn('range',self.requests[0])


if __name__=='__main__':unittest.main()
