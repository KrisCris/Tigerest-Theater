"""Real local HTTPS: process restart, Range validation, ignored/changed assets."""
import hashlib
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class TransferTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.body = bytes(range(256)) * 4096
        self.digest = hashlib.sha256(self.body).hexdigest()
        self.requests = []
        self.mode = 'normal'
        self.slow = True
        test = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == '/metadata':
                    asset = {'name': 'TigerestTheater-2.5.0-x64.exe', 'size': len(test.body),
                             'digest': 'sha256:' + test.digest,
                             'browser_download_url': 'https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.5.0/TigerestTheater-2.5.0-x64.exe'}
                    data = json.dumps([{'tag_name': 'v2.5.0', 'draft': False, 'prerelease': False, 'assets': [asset]}]).encode()
                    self.send_response(200)
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                headers = {key.lower(): value for key, value in self.headers.items()}
                test.requests.append(headers)
                offset = int(self.headers.get('Range', 'bytes=0-')[6:].split('-')[0])
                ranged = 'Range' in self.headers and test.mode != 'ignore'
                if ranged and test.mode == 'unsatisfiable':
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{len(test.body)}')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                if not ranged:
                    offset = 0
                self.send_response(206 if ranged else 200)
                etag = '"changed"' if ranged and test.mode == 'changed' else '"fixed"'
                if test.mode != 'no-etag':
                    self.send_header('ETag', 'W/' + etag if test.mode == 'weak-etag' else etag)
                if ranged:
                    start = offset + 1 if test.mode == 'bad-range' else offset
                    self.send_header('Content-Range', f'bytes {start}-{len(test.body)-1}/{len(test.body)}')
                self.send_header('Content-Length', str(len(test.body) - offset))
                self.end_headers()
                try:
                    for start in range(offset, len(test.body), 16384):
                        data = test.body[start:start+16384]
                        if test.mode == 'corrupt':
                            data = bytes(x ^ 1 for x in data)
                        self.wfile.write(data)
                        self.wfile.flush()
                        if test.slow:
                            time.sleep(0.004)
                except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                    pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        fixtures = Path(__file__).parent / 'fixtures' / 'rife-download'
        self.certificate = fixtures / 'loopback-cert.pem'
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.certificate, fixtures / 'loopback-test-key.pem')
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def run_transfer(self, cancel_at=-1):
        options = self.root / 'options.json'
        options.write_text(json.dumps({'endpoint': f'https://127.0.0.1:{self.server.server_port}',
            'certificate': str(self.certificate), 'cache': str(self.root / 'cache'), 'cancelAt': cancel_at}), encoding='utf-8')
        completed = subprocess.run([os.environ['APP_UPDATE_TRANSFER_HOST'], str(options)], capture_output=True, timeout=20)
        self.assertEqual(completed.returncode, 0, completed.stderr.decode(errors='replace'))
        return json.loads(completed.stdout)

    def partial(self):
        report = self.run_transfer(65536)
        self.assertEqual(report['status'], 'available', report)
        self.assertGreaterEqual(report['received'], 65536)
        self.assertLess(report['received'], len(self.body))
        self.assertTrue(report['resumable'])
        return report['received']

    def test_process_restart_resumes_exact_offset(self):
        offset = self.partial()
        report = self.run_transfer()
        self.assertEqual(report['status'], 'ready', report)
        self.assertEqual(self.requests[-1]['range'], f'bytes={offset}-')
        self.assertEqual(self.requests[-1]['if-range'], '"fixed"')
        ready = next((self.root / 'cache').rglob('*.exe'))
        self.assertEqual(hashlib.sha256(ready.read_bytes()).hexdigest(), self.digest)
        for headers in self.requests:
            self.assertFalse(set(headers) & {'authorization', 'cookie', 'x-emby-token'})

    def test_server_ignores_range_replaces_partial(self):
        self.partial()
        self.mode = 'ignore'
        self.assertEqual(self.run_transfer()['status'], 'ready')
        self.assertEqual(len(self.requests), 2)

    def test_changed_or_malformed_range_restarts(self):
        for mode in ('changed', 'bad-range', 'unsatisfiable'):
            with self.subTest(mode=mode):
                self.partial()
                self.mode = mode
                report = self.run_transfer()
                self.assertEqual(report['status'], 'ready', report)
                self.assertNotIn('range', self.requests[-1])
                # New cache per scenario without sharing completed packages.
                for file in (self.root / 'cache').rglob('*.exe'):
                    file.unlink()
                self.mode = 'normal'

    def test_untrusted_metadata_and_missing_etag_restart_from_zero(self):
        for mode in ('metadata', 'no-etag', 'weak-etag'):
            with self.subTest(mode=mode):
                if mode == 'metadata':
                    self.partial()
                    meta = next((self.root / 'cache').rglob('download.json'))
                    data = json.loads(meta.read_text())
                    data['sha256'] = '0' * 64
                    meta.write_text(json.dumps(data))
                else:
                    self.mode = mode
                    report = self.run_transfer(65536)
                    self.assertEqual(report['status'], 'available')
                    self.assertFalse(report['resumable'])
                report = self.run_transfer()
                self.assertEqual(report['status'], 'ready', report)
                self.assertNotIn('range', self.requests[-1])
                for file in (self.root / 'cache').rglob('*.exe'):
                    file.unlink()
                self.mode = 'normal'

    def test_corrupt_completed_file_never_ready(self):
        self.mode = 'corrupt'
        report = self.run_transfer()
        self.assertEqual(report['status'], 'error', report)
        self.assertEqual(list((self.root / 'cache').rglob('*.exe')), [])
        self.assertEqual(list((self.root / 'cache').rglob('*.part')), [])


if __name__ == '__main__':
    unittest.main()
