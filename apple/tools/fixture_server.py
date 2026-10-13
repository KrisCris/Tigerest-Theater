#!/usr/bin/env python3
"""Loopback-only fixtures; never reads production profiles or tokens."""
import argparse,http.server,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=18768);parser.add_argument('--media',type=Path,required=True);args=parser.parse_args()
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/sub/System/Info/Public'):
            data=json.dumps({'Id':'fixture','Version':'4.9'}).encode();mime='application/json'
        elif self.path.startswith('/sub/web/index.html'):
            data=(ROOT/'Tests/fixtures/index.html').read_bytes();mime='text/html; charset=utf-8'
        elif self.path=='/fixture.mp4':
            data=args.media.read_bytes();mime='video/mp4'
        else:
            self.send_error(404);return
        start=0;end=len(data)-1;code=200
        raw=self.headers.get('Range','')
        if raw.startswith('bytes='):
            fields=raw[6:].split('-',1)
            try:start=int(fields[0]);end=int(fields[1]) if fields[1] else end
            except ValueError:self.send_error(400);return
            if start>=len(data):self.send_response(416);self.send_header('Content-Range',f'bytes */{len(data)}');self.end_headers();return
            code=206;end=min(end,len(data)-1)
        self.send_response(code);self.send_header('Content-Type',mime);self.send_header('ETag','"fixture-v1"');self.send_header('Accept-Ranges','bytes');self.send_header('Content-Length',str(end-start+1))
        if code==206:self.send_header('Content-Range',f'bytes {start}-{end}/{len(data)}')
        self.end_headers()
        try:self.wfile.write(data[start:end+1])
        except (BrokenPipeError,ConnectionResetError):pass
    def log_message(self,*args):pass
http.server.ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
