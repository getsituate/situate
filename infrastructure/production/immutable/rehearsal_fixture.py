"""Synthetic website, release and private TLS fixtures for the rehearsal."""
import hashlib
import json
import tarfile


APEX = 'getsituate.com'
STATE = 'sudo -n /usr/local/lib/situate/state.sh'


def fixtures(work, run):
    root = work / 'fixtures'
    root.mkdir()
    for site in ('site', 'site-next'):
        (root / site).mkdir()
        (root / site / 'index.html').write_text(f'<html><body>Rehearsal {site}</body></html>\n')
    for version in ('1.2.3', '1.2.4'):
        make_release(root / version, version)
    ca = work / 'ca.crt'
    issuer = work / 'ca.key'
    run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
         '-subj', '/CN=Situate Isolated Rehearsal CA', '-keyout', str(issuer), '-out', str(ca)])
    tls = root / 'tls/caddy'
    (tls / 'acme/rehearsal').mkdir(parents=True)
    (tls / 'acme/rehearsal/test-account').touch()
    for domain in (APEX, f'www.{APEX}', f'reboot.{APEX}'):
        directory = tls / 'certificates/acme-v02.api.letsencrypt.org-directory' / domain
        directory.mkdir(parents=True)
        csr = work / 'lab.csr'
        extensions = work / 'extensions'
        extensions.write_text(f'subjectAltName=DNS:{domain}\nextendedKeyUsage=serverAuth\n')
        run(['openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', f'/CN={domain}',
             '-keyout', str(directory / f'{domain}.key'), '-out', str(csr)])
        run(['openssl', 'x509', '-req', '-in', str(csr), '-CA', str(ca), '-CAkey', str(issuer),
             '-CAcreateserial', '-days', '2', '-extfile', str(extensions), '-out', str(directory / f'{domain}.crt')])
        (directory / f'{domain}.json').write_text(json.dumps({'sans': [domain]}))
    archive = work / 'fixtures.tar'
    with tarfile.open(archive, 'w') as tar:
        for path in sorted(root.iterdir()):
            tar.add(path, arcname=path.name)
    return root, ca, archive.read_bytes()


def make_release(root, version):
    metadata = root / 'metadata'
    metadata.mkdir(parents=True)

    def artifact(name, payload):
        data = payload.encode()
        (root / name).write_bytes(data)
        return dict(path=name, size=len(data), sha256=hashlib.sha256(data).hexdigest())

    dmg = artifact('one.dmg', f'synthetic DMG {version}')
    archive = artifact('one.tar.gz', f'synthetic archive {version}')
    signature = f'synthetic signature {version}'
    signed = artifact('one.tar.gz.sig', signature)
    updater = dict(archive, signaturePath=signed['path'], signatureSize=signed['size'],
                   signatureSha256=signed['sha256'], signature=signature)
    manifest = dict(schemaVersion=1, status='complete', dirty=False, distribution='direct',
                    version=version, revision='a' * 40,
                    artifacts=[dict(dmg, platform='macos', distribution='direct', updater=updater)])
    base = f'https://{APEX}/releases/{version}/'
    download = dict(version=version, distribution='direct', url=base + dmg['path'],
                    sha256=dmg['sha256'], size=dmg['size'])
    update = dict(version=version, distribution='direct', platforms={
        key: {'url': base + archive['path'], 'signature': signature}
        for key in ('darwin-aarch64', 'darwin-x86_64')})
    for path, value in ((root / 'manifest.json', manifest), (metadata / 'download.json', download),
                        (metadata / 'update.json', update)):
        path.write_text(json.dumps(value))


def transfer(host, archive):
    host.ssh('mkdir -m700 /home/situate-ops/testdata && tar -xf - -C /home/situate-ops/testdata', archive)


def seed(host):
    host.ssh('sudo -n bash -s', b'''
set -euo pipefail
root=/srv/situate-state
src=/home/situate-ops/testdata
mkdir -p "$root/distribution/releases" "$root/website/versions"
cp -r "$src/1.2.3" "$root/distribution/releases/"
ln -s releases/1.2.3/metadata "$root/distribution/current-release"
touch "$root/distribution/release.lock"
chown -Rh 1100:1100 "$root/distribution"
chmod -R a+rX "$root/distribution/releases"
chmod 755 "$root/distribution" "$root/website" "$root/website/versions"
cp -r "$src/tls" "$root/tls"
chmod 700 "$root/tls"
website=/usr/local/lib/situate/website.py
digest=$(python3 "$website" digest "$src/site")
python3 "$website" seed "$digest" "$src/site" --confirm-website "$digest"
''')


def update(host):
    host.ssh('sudo -n bash -s', b'''
set -euo pipefail
root=/srv/situate-state
src=/home/situate-ops/testdata
cp -r "$src/1.2.4" "$root/distribution/releases/"
chmod -R a+rX "$root/distribution/releases/1.2.4"
chown -Rh 1100:1100 "$root/distribution/releases/1.2.4"
runuser -u deploy -- ln -s releases/1.2.4/metadata /opt/situate/.test-current-release
runuser -u deploy -- mv -Tf /opt/situate/.test-current-release /opt/situate/current-release
website=/usr/local/lib/situate/website.py
digest=$(python3 "$website" digest "$src/site-next")
old_ids=$(docker compose -f /usr/local/lib/situate/compose.yaml ps -q | sort)
python3 "$website" activate "$digest" "$src/site-next" --confirm-website "$digest"
[[ $(docker compose -f /usr/local/lib/situate/compose.yaml ps -q | sort) == "$old_ids" ]]
''')


def receipt(host, mounted_read_only=False):
    command = f'{STATE} evidence' if mounted_read_only else 'sudo -n python3 /usr/local/lib/situate/verify-state.py --evidence'
    return json.loads(host.ssh(command).stdout)
