#!/usr/bin/env python3
"""A collector for the site's telemetry (web/telemetry.js, format "jsonl"), for self-hosting or testing.

It takes POST {vid, events: [...]} at any path, answers CORS, and appends one JSON line per event to
the log, with the visitor id and the day the server received it. It keeps no IP address. Read the log
with tools/slo_report.py.

    python3 tools/telemetry_server.py --port 8890 --out telemetry.jsonl

Put it behind HTTPS (a reverse proxy) and set CONFIG.endpoint in web/telemetry.js to its URL with
CONFIG.format = 'jsonl'. Standard library only.
"""
import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 256 * 1024
MAX_EVENTS = 200
LOCK = threading.Lock()


def clean(v, depth=0):
    """Keep only plain JSON values, short strings and shallow objects."""
    if isinstance(v, str):
        return v[:300]
    if isinstance(v, bool) or v is None or isinstance(v, (int, float)):
        return v
    if isinstance(v, dict) and depth < 2:
        return {str(k)[:40]: clean(x, depth + 1) for k, x in list(v.items())[:40]}
    return None


class Handler(BaseHTTPRequestHandler):
    out = 'telemetry.jsonl'

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.cors()
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'ok\n')

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_BODY:
            self.send_response(413 if n else 400)
            self.cors()
            self.end_headers()
            return
        try:
            body = json.loads(self.rfile.read(n))
            vid = str(body.get('vid', ''))[:40]
            events = body.get('events', [])[:MAX_EVENTS]
        except (ValueError, AttributeError):
            self.send_response(400)
            self.cors()
            self.end_headers()
            return
        got = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        lines = []
        for e in events:
            if not isinstance(e, dict) or not isinstance(e.get('event'), str):
                continue
            lines.append(json.dumps({'got': got, 'vid': vid, 'event': e['event'][:40], 'ts': clean(e.get('ts')),
                                     'props': clean(e.get('props') or {})}, separators=(',', ':')))
        with LOCK, open(self.out, 'a') as f:
            for line in lines:
                f.write(line + '\n')
        self.send_response(204)
        self.cors()
        self.end_headers()

    def log_message(self, *args):
        pass


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--port', type=int, default=8890)
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--out', default='telemetry.jsonl')
    a = ap.parse_args()
    Handler.out = a.out
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
