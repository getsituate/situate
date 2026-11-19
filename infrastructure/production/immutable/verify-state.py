#!/usr/bin/env python3
"""Reject empty, older or unsettled publication state before serving it."""
import hashlib
import json
from pathlib import Path
import re
import stat
import sys

import website


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_journal(path):
    if not website.exists(path):
        return
    require(stat.S_ISREG(path.lstat().st_mode), 'Expected a regular release journal.')
    with path.open('rb') as stream:
        active = None
        for line in stream:
            require(line.endswith(b'\n'), 'Interrupted release operation journal.')
            record = json.loads(line)
            identity = record['identity']
            require(isinstance(identity, dict) and bool(identity), 'Invalid release operation identity.')
            if record['state'] == 'claimed' and active is None:
                active = identity
            elif record['state'] == 'completed' and active == identity:
                active = None
            else:
                raise ValueError('Invalid release operation transition.')
        require(active is None, 'A release operation still holds a claim.')


def check_release(distribution, release, *, deploy_uid=1100, evidence=None):
    website.directory(distribution)
    website.directory(distribution / 'releases')
    require(distribution.stat().st_uid == deploy_uid and stat.S_IMODE(distribution.stat().st_mode) == 0o755,
            'Distribution must be owned by deploy (UID 1100) with mode 0755.')
    for name in distribution.iterdir():
        require(not name.name.startswith(('.release-incoming-', '.current-release-')) and
                name.name not in ('release-pending.json', 'release-pending.tmp',
                                  'release-allocation-pending.json', 'release-allocation-pending.tmp'),
                f'Unresolved release operation: {name.name}')
    check_journal(distribution / 'release-operations.jsonl')
    release.ROOT = distribution
    stored = release.history()
    pointer = re.fullmatch(r'releases/([^/]+)/metadata', (distribution / 'current-release').readlink().as_posix())
    require(pointer and release.VERSION.fullmatch(pointer[1]), 'Invalid active release pointer.')
    version = pointer[1]
    require(any(item['version'] == version for item in stored) and
            all(item['version'] == version or release.compare(item['version'], version) < 0 for item in stored),
            'Active release is not the latest complete release on this volume.')
    current = distribution / 'releases' / version
    release.validate_tree(current)
    manifest = json.loads((current / 'manifest.json').read_bytes())
    macos = [artifact for artifact in manifest['artifacts'] if artifact.get('platform') == 'macos']
    require(len(macos) == 1 and macos[0]['distribution'] == 'direct', 'Expected one direct macOS artifact.')
    dmg = macos[0]
    updater = dmg['updater']
    signature = {'path': updater['signaturePath'], 'size': updater['signatureSize'], 'sha256': updater['signatureSha256']}
    for artifact, suffix in ((dmg, '.dmg'), (updater, '.tar.gz'), (signature, '.sig')):
        name = artifact['path']
        require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]*', name) and name.endswith(suffix), 'Invalid release filename.')
        path = current / name
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        require(path.stat().st_size == artifact['size'] and digest == artifact['sha256'], f'Release artifact mismatch: {name}')
    download = json.loads((current / 'metadata/download.json').read_bytes())
    update = json.loads((current / 'metadata/update.json').read_bytes())
    base = f'https://getsituate.com/releases/{version}/'
    require(download.get('version') == update.get('version') == version and
            download.get('distribution') == update.get('distribution') == 'direct' and
            download.get('url') == base + dmg['path'] and download.get('sha256') == dmg['sha256'] and
            download.get('size') == dmg['size'] and update.get('platforms') == {
                key: {'url': base + updater['path'], 'signature': updater['signature']}
                for key in ('darwin-aarch64', 'darwin-x86_64')
            } and (current / signature['path']).read_text().strip() == updater['signature'],
            'Release metadata does not match the active manifest.')
    if evidence is not None:
        evidence.update(updaterSha256=updater['sha256'], signatureSha256=signature['sha256'])
    return tuple(hashlib.sha256((current / 'metadata' / name).read_bytes()).hexdigest()
                 for name in ('download.json', 'update.json'))


def check(root, release, evidence=None):
    website.directory(root)
    site = website.settled(root / 'website')
    require(site, 'Missing active website.')
    tls = root / 'tls'
    website.directory(tls)
    require(tls.stat().st_uid == 0 and stat.S_IMODE(tls.stat().st_mode) == 0o700,
            'TLS state must be root-owned with mode 0700.')
    # Caddy needs the accounts, issued certificates and keys, not a new empty volume.
    for directory in ('tls/caddy/acme', 'tls/caddy/certificates'):
        path = root / directory
        website.directory(path)
        require(any(path.iterdir()), 'Missing recovered Caddy state.')
    return (site, *check_release(root / 'distribution', release, evidence=evidence))


if __name__ == '__main__':
    import release_storage

    try:
        if sys.argv[1:] == ['--evidence']:
            evidence = {}
            site, download, update = check(Path('/srv/situate-state'), release_storage, evidence)
            print(json.dumps(dict(evidence, siteSha256=site, downloadSha256=download, updateSha256=update)))
        elif not sys.argv[1:]:
            print(' '.join(check(Path('/srv/situate-state'), release_storage)))
        else:
            sys.exit('Usage: verify-state.py [--evidence]')
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        sys.exit(f'Publication state is not ready: {error}')
