#!/usr/bin/env python3
"""Transfer a checked static build to the immutable host's website store."""
from base64 import b64decode, b64encode
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import select
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

# Python isolated mode does not put the script directory on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import website

ORIGIN = 'https://getsituate.com'
SSH_TARGET = 'situate-website@getsituate.com'
KEY_FILE = Path('/var/lib/situate-website/.ssh/authorized_keys')
LIMIT = 16 * 1024 * 1024
EXTENSIONS = {'.html', '.css', '.js', '.svg', '.webp', '.png', '.jpg', '.txt'}
FEEDS = ('/releases/current/download.json', '/releases/current/update.json')


def digest(data):
    return sha256(data).hexdigest()


def line(stream, limit):
    if not select.select([stream], [], [], 120)[0]:
        raise ValueError('Website transfer timed out. Inspect the host before retrying.')
    value = stream.readline(limit + 1)
    if not value.endswith(b'\n') or len(value) > limit:
        raise ValueError('Incomplete or oversized website transfer. Inspect the host before retrying.')
    return json.loads(value)


def send_line(stream, value):
    stream.write(json.dumps(value, separators=(',', ':')).encode() + b'\n')
    stream.flush()


def validate_path(name):
    parts = name.split('/')
    if (len(parts) > 12 or any(not website.NAME.fullmatch(part) or len(part) > 120 for part in parts)
            or parts[0] in {'releases', 'robots.txt', 'healthz', 'system'}
            or Path(name).suffix not in EXTENSIONS):
        raise ValueError('The package contains a path outside the static website namespace.')


def package(source):
    files = {}
    size = 0
    for item in sorted(source.rglob('*')):
        info = item.lstat()
        if stat.S_ISDIR(info.st_mode):
            continue
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('The build contains a non-regular or linked file.')
        name = item.relative_to(source).as_posix()
        validate_path(name)
        size += info.st_size
        if size > LIMIT or len(files) >= 2048:
            raise ValueError('The website exceeds its delivery size limit.')
        files[name] = b64encode(item.read_bytes()).decode('ascii')
    return files


def unpack(files, source):
    if not isinstance(files, dict) or len(files) > 2048 or 'index.html' not in files:
        raise ValueError('Invalid static website package.')
    for name, value in files.items():
        validate_path(name)
        if not isinstance(value, str):
            raise ValueError('Invalid static website file.')
    size = 0
    for name, value in files.items():
        data = b64decode(value, validate=True)
        size += len(data)
        if size > LIMIT:
            raise ValueError('The website exceeds its delivery size limit.')
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as target:
            target.write(data)
    return website.fingerprint(source)


def serve(root, files, reply, decision):
    with tempfile.TemporaryDirectory(prefix='situate-website-') as tmp:
        source = Path(tmp)
        version = unpack(files, source)
        if website.settled(root) == version:
            reply({'unchanged': version})
            return

        def confirm():
            reply({'pending': version})
            result = decision()
            if type(result) is not bool:
                raise ValueError('No website decision received. Inspect the pending operation.')
            return result

        accepted = website.activate(root, version, source, confirm=confirm)
        reply({'complete': accepted})


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def get(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(ORIGIN + path, headers={'Cache-Control': 'no-cache'})
    try:
        with opener.open(request, timeout=6) as response:
            return response.status, response.read(LIMIT + 1)
    except urllib.error.HTTPError as error:
        with error:
            return error.code, b''


def check_public(files):
    for name, encoded in files.items():
        if not name.endswith('.html') and name != 'analytics-config.js':
            continue
        status, body = get('/' if name == 'index.html' else '/' + name)
        if status >= 500:
            raise ValueError('Public website verification is inconclusive. Inspect the host.')
        if status != 200 or digest(body) != digest(b64decode(encoded)):
            return False
    return True


def check_feeds():
    for path in FEEDS:
        status, body = get(path)
        if status != 200 or not isinstance(json.loads(body), dict):
            raise ValueError('App metadata is unavailable. Check the app publication state.')


def current_main(expected):
    observed = subprocess.check_output(
        ['git', 'ls-remote', '--exit-code', 'https://github.com/getsituate/situate.git', 'refs/heads/main'],
        text=True, timeout=30, env={'PATH': os.environ['PATH'], 'GIT_TERMINAL_PROMPT': '0'},
    ).split()[0]
    return observed == expected


def deliver(source, revision):
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Expected a full main commit SHA.')
    if not current_main(revision):
        print('A newer main revision owns website publication.')
        return
    files = package(source)
    version = website.fingerprint(source)
    check_feeds()
    with tempfile.TemporaryDirectory(prefix='situate-website-ssh-') as tmp:
        paths = {}
        for name in ('SSH_KEY', 'KNOWN_HOSTS'):
            value = os.environ.get('WEBSITE_CONTENT_' + name, '').strip()
            if not value:
                raise ValueError('Configure WEBSITE_CONTENT_' + name + ' before publishing.')
            path = Path(tmp) / name
            path.write_text(value + '\n')
            path.chmod(0o600)
            paths[name] = path
        args = ['ssh', '-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
                '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null',
                '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3',
                '-o', f'UserKnownHostsFile={paths["KNOWN_HOSTS"]}', '-i', str(paths['SSH_KEY']), SSH_TARGET, 'publish-website']
        environment = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG') if key in os.environ}
        with subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=environment) as child:
            try:
                send_line(child.stdin, files)
                receipt = line(child.stdout, 4096)
                if receipt not in ({'pending': version}, {'unchanged': version}):
                    raise ValueError('The host returned an unexpected website digest.')
                healthy = check_public(files)
                if 'pending' in receipt:
                    if healthy:
                        check_feeds()
                    send_line(child.stdin, healthy)
                    if line(child.stdout, 4096) != {'complete': healthy}:
                        raise ValueError('Website publication outcome is uncertain. Inspect the host.')
                if child.wait(timeout=15) != 0:
                    raise ValueError('The website receiver did not close successfully.')
                if not healthy:
                    raise ValueError('The live site did not match the checked build.')
                check_feeds()
                print(f'Verified website {version} from {revision}.')
            finally:
                if child.poll() is None:
                    child.kill()


def install_key(key):
    if os.geteuid() != 0 or not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]{68}', key):
        raise ValueError('Expected a dedicated Ed25519 website publication key.')
    entry = f'restrict,command="/usr/local/lib/situate/website-ssh.sh" {key}\n'
    with KEY_FILE.open('x') as output:
        os.fchmod(output.fileno(), 0o644)
        output.write(entry)


def receive():
    if os.geteuid() != 0:
        raise ValueError('The website receiver must run through its restricted host entry point.')
    os.umask(0o022)
    files = line(sys.stdin.buffer, LIMIT * 2)
    with open('/run/situate-state/lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        subprocess.run(['/usr/local/lib/situate/state.sh', 'writable'], check=True)
        subprocess.run(['systemctl', 'is-active', '--quiet', 'situate-serving.service'], check=True)
        serve(website.ROOT, files, lambda result: send_line(sys.stdout.buffer, result),
              lambda: line(sys.stdin.buffer, 128))


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['receive']:
            receive()
        elif sys.argv[1:] == ['install-key']:
            install_key(sys.stdin.readline(128).rstrip('\n'))
        elif len(sys.argv) == 4 and sys.argv[1] == 'deploy':
            deliver(Path(sys.argv[2]).resolve(strict=True), sys.argv[3])
        else:
            sys.exit('Usage: website_content.py install-key | receive | deploy DIRECTORY MAIN_SHA')
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
