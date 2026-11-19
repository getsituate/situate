#!/usr/bin/env python3
"""Build and exercise an immutable snapshot in an otherwise empty test project."""
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from rehearsal_fixture import fixtures, seed, update, receipt, transfer


BASE_IMAGE = 161547269  # Ubuntu 24.04 amd64 in the Hetzner system-image catalog.
LOCATION = 'nbg1'
APEX = 'getsituate.com'
ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
STATE = 'sudo -n /usr/local/lib/situate/state.sh'
SERVICE = 'situate-serving.service'
MOUNT = '/srv/situate-state'
MIN_ENV = {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR') if key in os.environ}


class RehearsalError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise RehearsalError(message)


def run(args, *, data=None, seconds=120, allowed=(0,)):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=MIN_ENV, cwd=ROOT, timeout=seconds, check=False)
    if result.returncode not in allowed:
        # Never relay cloud-init contents, shell output or key material on failure.
        raise RehearsalError(f'{args[0]} failed (exit {result.returncode}).')
    return result


def retry(check, label, attempts=45, interval=3):
    for i in range(attempts):
        try:
            return check()
        except (OSError, RehearsalError, ValueError, http.client.HTTPException):
            if i + 1 == attempts:
                raise RehearsalError(f'Timed out waiting for {label}.') from None
            time.sleep(interval)


class Cloud:
    collections = {'servers': 'servers', 'volumes': 'volumes', 'firewalls': 'firewalls',
                   'primary_ips': 'primary_ips', 'images': 'images', 'zones': 'zones',
                   'networks': 'networks', 'floating_ips': 'floating_ips', 'load_balancers': 'load_balancers',
                   'ssh_keys': 'ssh_keys'}

    def __init__(self, token, scope):
        require(bool(token and token.strip()), 'Configure the isolated Hetzner token.')
        self.token = token
        self.scope = scope
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(self, method, path, payload=None, missing=False):
        headers = {'Authorization': f'Bearer {self.token}', 'Content-Type': 'application/json'}
        request = urllib.request.Request(f'https://api.hetzner.cloud/v1/{path}', method=method,
                                         headers=headers, data=None if payload is None else json.dumps(payload).encode())
        try:
            with self.opener.open(request, timeout=20) as response:
                body = response.read(2_000_001)
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            try:
                code = json.loads(error.read(8192)).get('error', {}).get('code', '')
            except (ValueError, AttributeError):
                code = ''
            if not isinstance(code, str) or not re.fullmatch('[a-z_]{1,64}', code):
                code = 'provider_error'
            raise RehearsalError(f'Hetzner {method} {path.split("?")[0]}: HTTP {error.code} ({code}).') from None
        require(len(body) <= 2_000_000, 'Unexpectedly large provider response.')
        return json.loads(body) if body else {}

    def list(self, kind, scoped=False):
        require(kind in self.collections, 'Unexpected resource collection.')
        query = '?per_page=50'
        if kind == 'images':
            query += '&type=snapshot'
        if scoped:
            query += f'&label_selector=rehearsal%3D{self.scope}'
        result = self.call('GET', kind + query)
        require(not result.get('meta', {}).get('pagination', {}).get('next_page'), 'Refusing an unexpectedly large inventory.')
        return result[self.collections[kind]]

    def preflight(self):
        for kind in self.collections:
            require(not self.list(kind), f'Test project is not empty ({kind}); nothing was provisioned.')
        kind = self.call('GET', 'server_types?name=cx23')['server_types']
        price = next((p for item in kind for p in item['prices'] if p['location'] == LOCATION), None)
        require(price and float(price['price_hourly']['gross']) <= 0.02, 'Test VM exceeds the permitted hourly rate.')

    def wait_action(self, action):
        for _ in range(120):
            data = self.call('GET', f'actions/{action["id"]}')['action']
            if data['status'] == 'success':
                return
            require(data['status'] == 'running', 'The provider rejected a rehearsal action.')
            time.sleep(2)
        raise RehearsalError('Provider action did not settle; no mutation was retried.')

    def create(self, kind, body):
        body['labels'] = {'rehearsal': self.scope}
        result = self.call('POST', kind, body)
        if result.get('action'):
            self.wait_action(result['action'])
        for action in result.get('next_actions', []):
            self.wait_action(action)
        return result[kind[:-1]]

    def action(self, kind, rid, action, payload=None):
        result = self.call('POST', f'{kind}/{rid}/actions/{action}', payload or {})
        self.wait_action(result['action'])
        return result

    def drop(self, kind, rid):
        result = self.call('DELETE', f'{kind}/{rid}', missing=True)
        if result and result.get('action'):
            self.wait_action(result['action'])

    def cleanup(self):
        valid = {'servers': {'builder', 'old', 'new'}, 'volumes': {'publication', 'restore'},
                 'firewalls': {'builder', 'runtime'}, 'images': {'image'}, 'primary_ips': set()}
        problems = []
        for kind in ('servers', 'volumes', 'images', 'firewalls', 'primary_ips'):
            for row in self.list(kind, scoped=True):
                label = row.get('name') or row.get('description')
                if row.get('labels', {}).get('rehearsal') != self.scope or label not in {f'{self.scope}-{part}' for part in valid[kind]}:
                    problems.append(kind)
                    continue
                try:
                    self.drop(kind, row['id'])
                except (OSError, RehearsalError):
                    problems.append(kind)
        leftovers = [kind for kind in self.collections if self.list(kind)]
        require(not (problems or leftovers), 'Test-project cleanup is incomplete; inspect the rehearsal inventory.')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *unused, **ignored):
        return None


def key(directory, name):
    result = directory / name
    run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(result)])
    return result, result.with_suffix('.pub').read_text().strip()


class Host:
    def __init__(self, server, directory, client_key, login):
        self.id = server['id']
        self.ip = str(ipaddress.IPv4Address(server['public_net']['ipv4']['ip']))
        self.known = directory / f'known-{self.id}'
        self.key = client_key
        self.login = login

    def pin(self, public):
        self.known.write_text(f'{self.ip} {public}\n')

    def ssh(self, command, data=None, seconds=120, key=None, login=None, allowed=(0,)):
        return run(['ssh', '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
                    '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={self.known}',
                    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=4', '-i', str(key or self.key),
                    f'{login or self.login}@{self.ip}', command], data=data, seconds=seconds, allowed=allowed)

    def enroll(self, token, work):
        claim = work / f'claim-{self.id}.json'
        def proof():
            value = run(['curl', '-q', '--noproxy', '*', '-fsS', '--max-time', '3', '--max-filesize', '1024',
                         f'http://{self.ip}/.well-known/situate-host-key'], seconds=5).stdout
            claim.write_bytes(value)
            source = ('import fs from "node:fs"; import {verifiedHostKey} from '
                      '"./infrastructure/production/immutable/enrollment.mjs"; '
                      'const [path,id]=process.argv.slice(1); console.log(verifiedHostKey(JSON.parse(fs.readFileSync(path)),id,fs.readFileSync(0,"utf8")));')
            return run(['node', '--input-type=module', '-e', source, str(claim), str(self.id)], data=token.encode()).stdout.decode().strip()
        self.pin(retry(proof, 'authenticated SSH enrollment'))
        self.ssh('sudo -n passwd -l root >/dev/null && sudo -n systemctl stop situate-enrollment.path situate-enrollment.service')

    def probe(self, ca, name, path, extra=(), allowed=(0,)):
        return run(['curl', '-q', '--noproxy', '*', '--cacert', str(ca), '--resolve', f'{name}:443:{self.ip}',
                    '-fsS', '--max-time', '8', *extra, f'https://{name}{path}'], allowed=allowed)


BAKE_PREP = r'''
set -euo pipefail
cd "$HOME/build"
sudo -n systemctl mask --now apt-daily.timer apt-daily-upgrade.timer apt-daily.service apt-daily-upgrade.service unattended-upgrades.service
sudo -n apt-get -qq update
sudo -n apt-get -y -qq purge snapd
sudo -n apt-get -y -qq --no-install-recommends --download-only install docker.io docker-compose-v2
mkdir -m700 inputs
cp /var/cache/apt/archives/*.deb inputs/
dpkg-query -W -f='${db:Status-Abbrev}\t${binary:Package}\t${Version}\n' > base.tsv
printf '%s\n' "$1" > inputs/revision
printf '%s\n' "$2" > inputs/base-image-id
python3 - <<'PY'
from pathlib import Path
import subprocess
rows = dict((line.split('\t')[1], line) for line in Path('base.tsv').read_text().splitlines())
packages = sorted(Path('inputs').glob('*.deb'))
assert packages
for deb in packages:
    def field(name):
        return subprocess.check_output(['dpkg-deb', '-f', str(deb), name], text=True).strip()
    assert field('Multi-Arch') != 'same'
    package = field('Package')
    rows[package] = f'ii \t{package}\t{field("Version")}'
Path('expected.tsv').write_text('\n'.join(rows.values()) + '\n')
PY
LC_ALL=C sort base.tsv | sha256sum | cut -d' ' -f1 > inputs/base-packages-sha256
LC_ALL=C sort expected.tsv | sha256sum | cut -d' ' -f1 > inputs/installed-packages-sha256
(cd inputs; sha256sum *.deb > packages.sha256; sha256sum packages.sha256 | cut -d' ' -f1 > packages-lock-sha256)
sudo -n bash infrastructure/production/immutable/bake.sh "$HOME/build/inputs" --confirm-disposable-builder
sudo -n rm -rf -- "$HOME/build"
'''


def boot_data(operator, publisher, token):
    text = (HERE.parent / 'terraform/immutable-cloud-init.yaml.tftpl').read_text()
    text = re.sub(r'^%\{[^\n]+\}\n', '', text, flags=re.MULTILINE)
    for label, value in {'operator_public_key': operator, 'ssh_public_key': publisher, 'enrollment_token': token}.items():
        text = text.replace('${jsonencode(' + label + ')}', json.dumps(value))
    require('${' not in text and '%{' not in text, 'Unrendered candidate bootstrap template.')
    return text


def make_firewall(cloud, part, client, ports, offline=False):
    rules = [{'direction': 'in', 'protocol': 'tcp', 'port': str(port), 'source_ips': [client]} for port in ports]
    if offline:
        rules += [{'direction': 'out', 'protocol': 'tcp', 'port': '80', 'destination_ips': ['169.254.169.254/32']}]
    return cloud.create('firewalls', {'name': f'{cloud.scope}-{part}', 'rules': rules})['id']


def make_server(cloud, part, image, firewall, data):
    return cloud.create('servers', {'name': f'{cloud.scope}-{part}', 'server_type': 'cx23', 'location': LOCATION,
                                    'image': str(image), 'firewalls': [{'firewall': firewall}], 'user_data': data})


def snapshot(cloud, work, revision, firewall, operator_key, operator):
    private, public = key(work, 'builder-identity')
    data = ('#cloud-config\nssh_deletekeys: false\nssh_genkeytypes: [ed25519]\nssh_keys:\n  ed25519_private: |\n'
            + ''.join(f'    {line}\n' for line in private.read_text().splitlines())
            + f'  ed25519_public: {json.dumps(public)}\nusers:\n  - name: rehearsal\n    groups: [sudo]\n'
              '    shell: /bin/bash\n    lock_passwd: true\n    sudo: ALL=(ALL) NOPASSWD:ALL\n    ssh_authorized_keys:\n'
            + f'      - {json.dumps(operator)}\nssh_pwauth: false\ndisable_root: true\n')
    builder = Host(make_server(cloud, 'builder', BASE_IMAGE, firewall, data), work, operator_key, 'rehearsal')
    builder.pin(' '.join(public.split()[:2]))
    retry(lambda: builder.ssh('true'), 'pinned builder SSH')
    builder.ssh('cloud-init status --wait >/dev/null; rc=$?; { [ "$rc" = 0 ] || [ "$rc" = 2 ]; } && sudo -n passwd -l root >/dev/null')
    archive = run(['git', 'archive', revision, 'infrastructure/production/immutable',
                   'infrastructure/production/docker/nginx.conf', 'infrastructure/releases/remote.py']).stdout
    builder.ssh('mkdir -m700 "$HOME/build" && tar -xf - -C "$HOME/build"', archive)
    builder.ssh(f'bash -s -- {revision} {BASE_IMAGE}', BAKE_PREP.encode(), seconds=480)
    cloud.action('servers', builder.id, 'shutdown')
    def off():
        require(cloud.call('GET', f'servers/{builder.id}')['server']['status'] == 'off', 'Builder is not off.')
    retry(off, 'powered-off builder')
    image = cloud.action('servers', builder.id, 'create_image', {'type': 'snapshot', 'description': f'{cloud.scope}-image', 'labels': {'rehearsal': cloud.scope}})['image']['id']
    cloud.drop('servers', builder.id)
    return image


def prepare_volume(host, volume):
    command = f'''set -euo pipefail
v=/dev/disk/by-id/scsi-0HC_Volume_{volume}
udevadm settle
[[ -b $v && -z $(lsblk -dn -o FSTYPE "$v") ]]
mkfs.ext4 -q "$v"
mount "$v" /mnt
chmod 700 /mnt
umount /mnt
/usr/local/lib/situate/state.sh mount {volume}
'''
    host.ssh('sudo -n bash -s', command.encode())


def activate(host, receipt):
    digests = [receipt[key] for key in ('siteSha256', 'downloadSha256', 'updateSha256')]
    require(all(re.fullmatch('[a-f0-9]{64}', digest) for digest in digests), 'Invalid frozen fixture receipt.')
    host.ssh(f'{STATE} bind {" ".join(digests)} && sudo -n systemctl start {SERVICE}')


def acceptance(host, ca, fixture, version, site):
    require(host.probe(ca, APEX, '/').stdout == (fixture / site / 'index.html').read_bytes(), 'Website bytes differ.')
    for alias in (f'www.{APEX}', f'reboot.{APEX}'):
        redirect = host.probe(ca, alias, '/probe?test=1', ('-o', '/dev/null', '-w', '%{http_code} %{redirect_url}')).stdout.decode()
        require(redirect == f'301 https://{APEX}/probe?test=1', 'Wrong HTTPS redirect.')
    for path in ('download.json', 'update.json'):
        require(host.probe(ca, APEX, f'/releases/current/{path}').stdout == (fixture / version / 'metadata' / path).read_bytes(), 'Release metadata differs.')
    for artifact in ('one.dmg', 'one.tar.gz', 'one.tar.gz.sig'):
        require(host.probe(ca, APEX, f'/releases/{version}/{artifact}').stdout == (fixture / version / artifact).read_bytes(), 'Release bytes differ.')



def exercise(cloud, work, revision):
    public_ip = run(['curl', '-q', '-4fsS', '--max-time', '10', 'https://api.ipify.org']).stdout.decode().strip()
    client = ipaddress.IPv4Address(public_ip)
    require(client.is_global, 'Expected a public runner IPv4 address.')
    builder_fw = make_firewall(cloud, 'builder', f'{client}/32', [22])
    runtime_fw = make_firewall(cloud, 'runtime', f'{client}/32', [22, 80, 443], offline=True)
    operator_key, operator = key(work, 'operator')
    publisher_key, publisher = key(work, 'publisher')
    print('Build pinned serving stack and capture a snapshot.', flush=True)
    image = snapshot(cloud, work, revision, builder_fw, operator_key, operator)
    fixture, ca, tar = fixtures(work, run)

    def candidate(part):
        token = secrets.token_hex(32)
        server = make_server(cloud, part, image, runtime_fw, boot_data(operator, publisher, token))
        require(server.get('image', {}).get('id') == image, 'Server did not boot the exact snapshot.')
        host = Host(server, work, operator_key, 'situate-ops')
        host.enroll(token, work)
        host.ssh(f'sudo -n /usr/local/lib/situate/verify-boot.sh {revision}')
        return host

    def volume(part):
        return cloud.create('volumes', {'name': f'{cloud.scope}-{part}', 'size': 10,
                                        'location': LOCATION})['id']

    def attach(volume_id, host):
        cloud.action('volumes', volume_id, 'attach', {'server': host.id, 'automount': False})
        require(cloud.call('GET', f'volumes/{volume_id}')['volume']['server'] == host.id, 'Wrong volume attachment.')

    def fence(host):
        host.ssh(f'sudo -n systemctl stop {SERVICE} && {STATE} unmount && {STATE} fenced')
        check = host.probe(ca, APEX, '/healthz', allowed=(0, 7, 28))
        require(check.returncode != 0, 'Fenced host still serves the website.')

    print('Verify fresh SSH identity and offline boot before volume handoff.', flush=True)
    old = candidate('old')
    publication = volume('publication')
    attach(publication, old)
    prepare_volume(old, publication)
    transfer(old, tar)
    seed(old)
    first = receipt(old)
    activate(old, first)
    acceptance(old, ca, fixture, '1.2.3', 'site')
    replacement = candidate('new')
    require(old.known.read_text().split()[2] != replacement.known.read_text().split()[2], 'SSH identity was cloned.')
    fence(old)
    cloud.action('volumes', publication, 'detach')
    attach(publication, replacement)
    replacement.ssh(f'{STATE} mount {publication}')
    activate(replacement, first)
    acceptance(replacement, ca, fixture, '1.2.3', 'site')
    replacement.ssh(f'{STATE} enable --confirm-publication')
    transfer(replacement, tar)
    update(replacement)
    replacement.ssh(f'{STATE} freeze')
    second = receipt(replacement, mounted_read_only=True)
    fail = replacement.ssh('touch /opt/situate/rehearsal-forbidden', key=publisher_key, login='deploy', allowed=(0, 1))
    require(fail.returncode == 1 and b'Read-only file system' in fail.stderr, 'Frozen publication accepted a write or SSH was unavailable.')
    acceptance(replacement, ca, fixture, '1.2.4', 'site-next')
    print('Verify failback, rejection of stale state, and independent restore.', flush=True)
    replacement.ssh(f'sudo -n systemctl stop {SERVICE}')
    backup = replacement.ssh(f'sudo -n tar --numeric-owner -C {MOUNT} -cf - distribution website tls').stdout
    fence(replacement)
    cloud.action('volumes', publication, 'detach')
    attach(publication, old)
    old.ssh(f'{STATE} mount {publication}')
    try:
        activate(old, first)
    except RehearsalError:
        pass
    else:
        raise RehearsalError('Failback accepted stale publication.')
    activate(old, second)
    acceptance(old, ca, fixture, '1.2.4', 'site-next')
    restored = volume('restore')
    attach(restored, replacement)
    prepare_volume(replacement, restored)
    try:
        activate(replacement, second)
    except RehearsalError:
        pass
    else:
        raise RehearsalError('Serving stack accepted an empty volume.')
    replacement.ssh(f'sudo -n tar --numeric-owner -C {MOUNT} -xf -', backup)
    activate(replacement, second)
    acceptance(replacement, ca, fixture, '1.2.4', 'site-next')
    require(receipt(replacement, True) == second, 'Independent restore evidence differs.')
    fence(old)
    cloud.action('volumes', publication, 'detach')
    cloud.drop('servers', old.id)
    require(cloud.call('GET', f'servers/{old.id}', missing=True) is None, 'Hetzner did not confirm predecessor retirement.')


def main():
    os.umask(0o077)
    require(os.environ.get('GITHUB_REPOSITORY') == 'getsituate/situate' and
            os.environ.get('GITHUB_REF') == 'refs/heads/immutable-infrastructure' and
            os.environ.get('GITHUB_EVENT_NAME') in {'push', 'workflow_dispatch'}, 'Use only the protected rehearsal branch.')
    run_id = os.environ.get('GITHUB_RUN_ID', '')
    attempt = os.environ.get('GITHUB_RUN_ATTEMPT', '')
    require(re.fullmatch('[0-9]{1,16}', run_id) and re.fullmatch('[0-9]{1,3}', attempt), 'Invalid GitHub run identity.')
    cloud = Cloud(os.environ.get('HCLOUD_REHEARSAL_TOKEN'), f'sit-ci-{run_id}-{attempt}')
    if sys.argv[1:] == ['cleanup']:
        cloud.cleanup()
        return
    require(not sys.argv[1:], 'Expected no arguments or cleanup.')
    revision = os.environ.get('GITHUB_SHA', '')
    require(re.fullmatch('[a-f0-9]{40}', revision) and run(['git', 'rev-parse', 'HEAD']).stdout.decode().strip() == revision, 'Checkout does not match GitHub revision.')
    cloud.preflight()
    try:
        with tempfile.TemporaryDirectory(prefix='situate-hosting-') as directory:
            exercise(cloud, Path(directory), revision)
    finally:
        cloud.cleanup()
    print('Snapshot boot, volume handoff, failback, restore and predecessor retirement verified. Test project is empty.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RehearsalError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(str(error) if isinstance(error, RehearsalError) else f'Rehearsal stopped: {type(error).__name__}.', file=sys.stderr)
        sys.exit(1)
