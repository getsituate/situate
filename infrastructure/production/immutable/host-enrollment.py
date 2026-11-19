#!/usr/bin/env python3
"""Publish a short-lived proof for this instance's SSH host key."""
import hashlib
import hmac
import http.server
import json
import re
import time
import urllib.request
from pathlib import Path


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path != '/.well-known/situate-host-key':
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(self.server.proof)))
        self.end_headers()
        self.wfile.write(self.server.proof)

    def setup(self):
        self.request.settimeout(3)
        super().setup()


def main():
    token_path = Path('/run/situate-enrollment-token')
    token = token_path.read_text().strip()
    if not re.fullmatch(r'[a-f0-9]{64}', token):
        raise ValueError('Invalid enrollment capability')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://169.254.169.254/hetzner/v1/metadata/instance-id', timeout=5) as response:
        server_id = response.read(64).decode('ascii').strip()
    if not re.fullmatch(r'[1-9][0-9]{0,14}', server_id):
        raise ValueError('Invalid provider instance ID')
    key = ' '.join(Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()[:2])
    proof = hmac.new(bytes.fromhex(token), f'{server_id}\n{key}\n'.encode(), hashlib.sha256).hexdigest()
    with http.server.HTTPServer(('0.0.0.0', 80), Handler) as endpoint:
        endpoint.proof = json.dumps({'serverId': server_id, 'key': key, 'proof': proof}).encode()
        endpoint.timeout = 3
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            endpoint.handle_request()
    token_path.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
