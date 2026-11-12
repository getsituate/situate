#!/usr/bin/env python3
"""Inventory and explicitly retire the obsolete prototype on the existing host."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys

LEGACY = Path('/opt/getsituate')
PRODUCTION = Path('/opt/situate-production')
DISTRIBUTION = Path('/opt/situate')
PREVIEW = Path('/opt/situate-reboot')
EDGE = 'getsituate-caddy-1'
HOST = 'getsituate-production'
SERVICES = {'site': '/getsituate-site-1',
            'download-counter': '/getsituate-download-counter-1'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True)


def containers():
    ids = docker('ps', '-aq').split()
    require(ids, 'No containers found.')
    return json.loads(docker('inspect', *ids))


def labels(container):
    return container['Config'].get('Labels') or {}


def obsolete(container):
    service = labels(container).get('com.docker.compose.service')
    return (labels(container).get('com.docker.compose.project') == 'getsituate'
            and service in SERVICES and container['Name'] == SERVICES[service])


def known_services(all_containers):
    for container in all_containers:
        if labels(container).get('com.docker.compose.project') == 'getsituate':
            require(obsolete(container) or
                    (container['Name'] == '/' + EDGE and
                     labels(container).get('com.docker.compose.service') == 'caddy'),
                    'Unknown getsituate service or container name; preserve it and resolve ownership first.')


def walk(root):
    # scandir raises on unreadable directories; pathlib glob may silently skip them.
    with os.scandir(root) as entries:
        children = sorted(entries, key=lambda entry: entry.name)
    for entry in children:
        path = Path(entry.path)
        yield path
        if entry.is_dir(follow_symlinks=False):
            yield from walk(path)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def pending():
    for root in (LEGACY, PRODUCTION, DISTRIBUTION, PREVIEW):
        if not root.exists():
            continue
        require(root.is_dir() and root.resolve() == root, 'Unexpected deployment root.')
        for path in walk(root):
            require(not ('pending' in path.name.lower() or path.name.endswith('.next')),
                    f'Unresolved operation evidence: {path}')


def files():
    require(LEGACY.is_dir() and LEGACY.resolve() == LEGACY and not LEGACY.is_mount(),
            'Unexpected prototype directory.')
    result = {}
    for path in walk(LEGACY):
        name = str(path.relative_to(LEGACY))
        mode = path.lstat().st_mode
        require(not (path.name.startswith('.env') or 'tfstate' in path.name.lower() or path.suffix.lower() in
                     ('.pem', '.key', '.p8', '.p12', '.pfx', '.backup') or
                     any(word in path.name.lower() for word in
                         ('credential', 'private', 'signing', 'secret', 'id_rsa', 'id_ed25519'))),
                'Protected or unknown content must be preserved outside the prototype before retirement.')
        if stat.S_ISLNK(mode):
            result[name] = {'link': os.readlink(path)}
        elif stat.S_ISDIR(mode):
            require(not path.is_mount(), 'Nested mount in prototype directory.')
            result[name] = {'directory': True}
        else:
            require(stat.S_ISREG(mode) and path.stat().st_nlink == 1,
                    'Prototype inventory contains a special file or hard link.')
            result[name] = {'sha256': digest(path)}
    return result


def inventory(all_containers):
    return {'version': 1, 'host': HOST, 'root': str(LEGACY), 'files': files(),
            'containers': sorted([{'id': c['Id'], 'name': c['Name'],
                                   'service': labels(c).get('com.docker.compose.service')}
                                  for c in all_containers if obsolete(c)],
                                 key=lambda c: c['id'])}


def within(source, root):
    return source == str(root) or source.startswith(str(root) + '/')


def verify(all_containers):
    edge = next((c for c in all_containers if c['Name'] == '/' + EDGE), None)
    require(edge and edge['State']['Running'], 'The intended edge is not running.')
    require(labels(edge).get('com.docker.compose.project') == 'getsituate'
            and labels(edge).get('com.docker.compose.service') == 'caddy',
            'Unexpected edge ownership.')
    mounts = {m['Destination']: m for m in edge['Mounts']}
    require(mounts.get('/etc/caddy/Caddyfile', {}).get('Source') == str(PRODUCTION / 'edge/Caddyfile'),
            'Relocate the edge before retirement.')
    for destination, name in (('/data', 'getsituate_caddy_data'), ('/config', 'getsituate_caddy_config')):
        require(mounts.get(destination, {}).get('Name') == name, 'Unexpected shared certificate/config volume.')
    require('getsituate_default' in edge['NetworkSettings']['Networks'], 'Unexpected edge network.')
    canonical = (PRODUCTION / 'current/Caddyfile').read_text()
    require((PRODUCTION / 'edge/Caddyfile').read_text() == canonical,
            'Activate the reviewed canonical website configuration before retirement.')
    adapted = json.loads(docker('exec', EDGE, 'caddy', 'adapt', '--config', '/etc/caddy/Caddyfile'))
    active = json.loads(docker('exec', EDGE, 'wget', '-qO-', 'http://127.0.0.1:2019/config/'))
    require(active == adapted, 'Active proxy routes differ from the mounted configuration.')
    retired = [c for c in all_containers if obsolete(c)]
    route_text = json.dumps(active)
    require('situate-production:8080' in route_text, 'New service route is missing.')
    for c in retired:
        targets = {c['Name'].lstrip('/'), labels(c).get('com.docker.compose.service')}
        for network in c['NetworkSettings']['Networks'].values():
            targets.update(network.get('Aliases') or [])
            targets.update([network.get('IPAddress'), network.get('GlobalIPv6Address')])
        for target in filter(None, targets):
            require(not re.search(r'(?<![\w.-])' + re.escape(target) + r'(?=[:/"\s]|$)', route_text),
                    'An active proxy route still references a prototype service.')
    new = [c for c in all_containers if labels(c).get('com.docker.compose.project') == 'situate-production'
           and labels(c).get('com.docker.compose.service') == 'website']
    require(len(new) == 1 and new[0]['State']['Running']
            and new[0]['State'].get('Health', {}).get('Status') == 'healthy',
            'New website service is not healthy.')
    require(any(m['Source'] == str(DISTRIBUTION) and m['Destination'] == '/srv/distribution'
                for m in new[0]['Mounts']), 'Unexpected new distribution mount.')
    for c in all_containers:
        if not obsolete(c):
            for mount in c['Mounts']:
                require(not within(mount['Source'], LEGACY), 'A retained container still mounts prototype files.')
    for path in ('/', '/releases/current/download.json', '/releases/current/update.json'):
        docker('exec', EDGE, 'wget', '-q', '-O', '/dev/null', 'https://getsituate.com' + path)


@contextlib.contextmanager
def locks():
    with contextlib.ExitStack() as stack:
        for root, name in ((LEGACY, 'deploy.lock'), (PRODUCTION, 'edge.lock'),
                           (PRODUCTION, 'deploy.lock'), (DISTRIBUTION, 'release.lock'),
                           (PREVIEW, 'deploy.lock')):
            if root == PREVIEW and not root.exists():
                continue
            require(root.is_dir() and root.resolve() == root, 'Prepare and inspect deployment roots first.')
            try:
                fd = os.open(root / name, os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600)
                created = True
            except FileExistsError:
                fd = os.open(root / name, os.O_RDWR | os.O_NOFOLLOW)
                created = False
            stack.callback(os.close, fd)
            if created:
                owner = root.stat()
                os.fchown(fd, owner.st_uid, owner.st_gid)
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'Unsafe deployment lock.')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('inventory', 'quiesce', 'retire'))
    parser.add_argument('--confirm-host')
    parser.add_argument('--confirm-discard-prototype', action='store_true')
    args = parser.parse_args()
    require(socket.gethostname() == HOST, 'Unexpected host; retirement is restricted to getsituate-production.')
    require(os.geteuid() == 0, 'Inventory and retirement require root through noninteractive sudo.')
    if args.command != 'inventory':
        require(args.confirm_host == HOST and args.confirm_discard_prototype,
                'Explicit host and prototype-discard confirmation required.')
    os.umask(0o077)
    with locks():
        pending()
        all_containers = containers()
        known_services(all_containers)
        snapshot = inventory(all_containers)
        if args.command == 'inventory':
            print(json.dumps(snapshot, indent=2))
            return
        require(not os.path.lexists(PRODUCTION / 'retirement.complete.json'),
                'A retirement receipt already exists; inspect it before any further cleanup.')
        reviewed = json.load(sys.stdin)
        if args.command == 'quiesce':
            require({key: reviewed.get(key) for key in ('version', 'host', 'root', 'containers')}
                    == {key: snapshot[key] for key in ('version', 'host', 'root', 'containers')},
                    'Prototype container inventory changed; review it before stopping services.')
            require(not os.path.lexists(PRODUCTION / 'retirement-quiesced.json'),
                    'A quiesce receipt exists; inspect it before stopping services again.')
        else:
            require(reviewed == snapshot, 'Prototype inventory changed; review a new inventory before retirement.')
            require(all(not c['State']['Running'] for c in all_containers if obsolete(c)),
                    'Quiesce prototype services, then generate and review a fresh file inventory before retirement.')
        verify(all_containers)
        marker = PRODUCTION / 'retirement.pending'
        with marker.open('x') as stream:
            json.dump({'operation': args.command, 'inventory': snapshot}, stream)
            stream.flush()
            os.fsync(stream.fileno())
        if args.command == 'quiesce':
            for container in snapshot['containers']:
                docker('stop', '--time', '30', container['id'])
            after = containers()
            require(all(not c['State']['Running'] for c in after if obsolete(c)),
                    'Prototype services did not stop; inspect retirement.pending.')
            verify(after)
            marker.rename(PRODUCTION / 'retirement-quiesced.json')
            print('Prototype services stopped; no files or containers removed. Generate and review a fresh inventory before retirement.')
            return
        # No rollback: removed containers and discarded files must not be recreated on error.
        for container in snapshot['containers']:
            docker('rm', container['id'])
        verify(containers())
        require(files() == snapshot['files'], 'Prototype files changed during retirement; retain the marker.')
        for name in sorted(snapshot['files'], key=lambda n: (n.count('/'), n), reverse=True):
            path = LEGACY / name
            require(path.parent.resolve() == path.parent, 'Prototype parent directory changed; retain the marker.')
            if snapshot['files'][name].get('directory'):
                path.rmdir()
            else:
                path.unlink()
        LEGACY.rmdir()
        marker.rename(PRODUCTION / 'retirement.complete.json')
        print('Prototype containers and inventoried files removed; shared volumes, images, network and new services retained.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'Retirement stopped: {error}. Inspect containers, files and retirement.pending before any retry.', file=sys.stderr)
        sys.exit(1)
