"""Private release listener resources, invoked through verified SSH."""
import base64
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import stat
import subprocess
import sys
import tarfile

ROOT = Path('/opt/situate/.qualification-host')
HOST_UID = 1000
IMMUTABLE_UID = 1100
IMMUTABLE_CONFIG = Path('/usr/local/lib/situate/qualification-nginx.conf')
IMMUTABLE_PROFILE = 'immutable-loopback-v1'
IMMUTABLE_HOSTNAME = 'getsituate.com'
IMMUTABLE_PORT = 24443
LABEL = 'com.situate.qualification-operation'


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'Expected a regular single-link file')
    return info


def directory(path):
    require(stat.S_ISDIR(path.lstat().st_mode), 'Expected a directory without symlinks')


def ancestors(path):
    for item in [*reversed(path.parents), path]:
        directory(item)


def read(path):
    regular(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        return stream.read()


def write_new(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def save(path, value):
    temporary = path.with_suffix('.tmp')
    write_new(temporary, encoded(value))
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def command(args):
    result = subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=60, env={key: os.environ[key] for key in ['PATH', 'HOME'] if key in os.environ})
    return result.stdout.decode().strip()


def valid_path(name):
    return isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]*(?:/[A-Za-z0-9][A-Za-z0-9._+-]*)*', name)


def validate(request):
    nonce = request['operationNonce']
    require(isinstance(request.get('operationId'), str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', request['operationId']), 'Invalid pipeline operation ID')
    require(isinstance(nonce, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', nonce), 'Invalid operation nonce')
    config = request['config']
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', config['caddyContainer']), 'Invalid Caddy container name')
    require(re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', config['hostname']) and '.' in config['hostname'], 'Invalid TLS hostname')
    require(type(config['hostPort']) is int and 1024 <= config['hostPort'] <= 65535, 'Invalid loopback listener port')
    require(re.fullmatch(r'[a-f0-9]{64}', config['publicFeedSha256']), 'Missing unchanged public feed hash')
    require(valid_path(config['feedPath']), 'Invalid candidate feed path')
    for key in ['certificatePath', 'keyPath']:
        require(valid_path(config[key]), 'Invalid certificate-relative path')
    require(config['certificateMount'].startswith('/') and valid_path(config['certificateMount'][1:]), 'Invalid certificate mount')
    return nonce, config


def immutable_host():
    try:
        info = regular(IMMUTABLE_CONFIG)
    except FileNotFoundError:
        return False
    require(info.st_uid == 0 and not info.st_mode & 0o022, 'Unsafe baked qualification configuration')
    return True


def probe_immutable_listener():
    context = ssl.create_default_context()
    with socket.create_connection(('127.0.0.1', IMMUTABLE_PORT), timeout=10) as sock:
        with context.wrap_socket(sock, server_hostname=IMMUTABLE_HOSTNAME) as secured:
            connection = http.client.HTTPConnection(IMMUTABLE_HOSTNAME, timeout=10)
            connection.sock = secured
            connection.request('GET', '/healthz')
            require(connection.getresponse().status == 204, 'Private qualification HTTPS listener is not ready')


def discover(config):
    if immutable_host():
        require(config['hostname'] == IMMUTABLE_HOSTNAME and config['hostPort'] == IMMUTABLE_PORT
                and config['feedPath'] == 'releases/current/update.json', 'Configuration differs from the baked qualification route')
        probe_immutable_listener()
        return {'listenerProfile': IMMUTABLE_PROFILE}
    production = json.loads(command(['docker', 'container', 'inspect', config['caddyContainer']]))[0]
    require(production['State']['Running'] is True, 'Production Caddy is not running')
    image = production['Image']
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', image), 'Missing immutable running image ID')
    mounts = [item for item in production['Mounts'] if item['Destination'] == config['certificateMount']]
    require(len(mounts) == 1 and mounts[0]['Type'] == 'volume', 'Expected one existing named certificate volume')
    volume = mounts[0]['Name']
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', volume), 'Invalid certificate volume')
    command(['docker', 'exec', config['caddyContainer'], 'sh', '-c',
             'test -f "$1" && test -f "$2"', 'sh',
             config['certificateMount'] + '/' + config['certificatePath'],
             config['certificateMount'] + '/' + config['keyPath']])
    return {'imageId': image, 'certificateVolume': volume}


def facts(state):
    config = state['config']
    result = {key: state[key] for key in ['operationId', 'operationNonce', 'status', 'identityPath', 'identitySha256', 'containerName']}
    result.update(listener_binding(state))
    result.update({'privateAddress': '127.0.0.2', 'interface': 'lo0',
                   'hostAddress': '127.0.0.1', 'hostPort': config['hostPort'], 'runnerPort': 443,
                   'endpoint': 'https://' + config['hostname'] + '/' + config['feedPath'],
                   'publicFeedSha256': config['publicFeedSha256']})
    for key in ['candidateFeedSha256', 'failure', 'uncertain', 'artifactsRetained']:
        if key in state:
            result[key] = state[key]
    return result


def inventory(files):
    require(isinstance(files, dict) and 0 < len(files) <= 128, 'Invalid candidate inventory')
    for name, item in files.items():
        require(valid_path(name) and name != 'identity.json', 'Invalid candidate file path')
        require(isinstance(item, dict) and set(item) == {'size', 'sha256'} and type(item['size']) is int
                and item['size'] >= 0 and re.fullmatch(r'[a-f0-9]{64}', item['sha256']), 'Invalid candidate file hash')
    return files


def verify(payload, files):
    actual = set()
    for item in payload.rglob('*'):
        info = item.lstat()
        if stat.S_ISDIR(info.st_mode):
            continue
        regular(item)
        actual.add(str(item.relative_to(payload)))
    require(actual == set(files), 'Candidate file inventory differs')
    for name, expected in files.items():
        path = payload / name
        require(regular(path).st_size == expected['size'], 'Candidate file size differs')
        value = hashlib.sha256()
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                value.update(chunk)
        require(value.hexdigest() == expected['sha256'], 'Candidate file hash differs')


def caddy_config(state):
    config = state['config']
    paths = ['/' + name for name in state['files']] + [state['identityPath']]
    routes = [{'match': [{'host': [config['hostname']], 'path': paths}],
               'handle': [{'handler': 'file_server', 'root': '/candidate'}]}]
    routes.insert(0, {'match': [{'host': [config['hostname']], 'path': [state['identityPath']]}],
                      'handle': [{'handler': 'rewrite', 'uri': '/identity.json'}, {'handler': 'file_server', 'root': '/identity'}]})
    routes.append({'handle': [{'handler': 'static_response', 'status_code': 404}]})
    return {'admin': {'disabled': True, 'config': {'persist': False}}, 'apps': {'tls': {'certificates': {'load_files': [{
        'certificate': '/cert-store/' + config['certificatePath'], 'key': '/cert-store/' + config['keyPath']}]}},
        'http': {'servers': {'qualification': {'listen': [':8443'], 'protocols': ['h1', 'h2'],
          'automatic_https': {'disable': True}, 'tls_connection_policies': [{}], 'routes': routes}}}}}


def listener_binding(state):
    if state.get('listenerProfile') == IMMUTABLE_PROFILE:
        return {'listenerProfile': IMMUTABLE_PROFILE}
    require('listenerProfile' not in state, 'Unknown qualification listener profile')
    return {key: state[key] for key in ['imageId', 'certificateVolume']}


def active_view():
    return ROOT.parent / '.qualification-view'


def view_owned(state):
    view = active_view()
    if not view.exists() and not view.is_symlink():
        return False
    ancestors(view)
    require(view.stat().st_uid == os.getuid(), 'Qualification view has a different owner')
    identity = view / state['identityPath'].lstrip('/')
    if not identity.exists() and not identity.is_symlink():
        return False
    ancestors(identity.parent)
    require(sha(read(identity)) == state['identitySha256'], 'Active qualification identity differs')
    return True


def listener_running(state):
    if state.get('listenerProfile') == IMMUTABLE_PROFILE:
        return view_owned(state)
    if immutable_host():
        require(state['status'] in ('cleaned', 'cleaned-retained') and not state.get('uncertain', False),
                'Unresolved legacy qualification must be settled on its original host')
        return False
    item = owned_container(state)
    return item is not None and item['State']['Running'] is True


def publish_view(operation, state, *, replace=False):
    target = active_view()
    retired = operation / 'previous-view'
    if target.exists() or target.is_symlink():
        require(replace, 'Private qualification view already exists; inspect before recovery')
        ancestors(target)
        require(target.stat().st_uid == os.getuid(), 'Qualification view has a different owner')
        os.rename(target, retired)
        sync_private_directory(target.parent)
        sync_private_directory(operation)
    payload = operation / 'payload'
    identity = payload / state['identityPath'].lstrip('/')
    identity.parent.mkdir(mode=0o755, parents=True)
    for path in (identity.parent, identity.parent.parent):
        os.chmod(path, 0o755)
    write_new(identity, read(operation / 'identity' / 'identity.json'))
    os.chmod(identity, 0o644)
    sync_private_directory(identity.parent)
    sync_private_directory(identity.parent.parent)
    sync_private_directory(identity.parent.parent.parent)
    os.rename(payload, target)
    sync_private_directory(operation)
    sync_private_directory(target.parent)
    if retired.exists():
        shutil.rmtree(retired)


def retire_view(operation, state):
    if view_owned(state):
        target = active_view()
        payload = operation / 'payload'
        require(not payload.exists() and not payload.is_symlink(), 'Cannot move the active qualification view back to staging')
        os.rename(target, payload)
        sync_private_directory(target.parent)
        sync_private_directory(operation)


def owned_container(state):
    name = state['containerName']
    found = command(['docker', 'container', 'ls', '--all', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}'])
    if not found:
        return None
    item = json.loads(command(['docker', 'container', 'inspect', name]))[0]
    require(item['Config']['Labels'].get(LABEL) == state['operationNonce'] and item['Image'] == state['imageId'],
            'Listener container ownership differs; refusing cleanup')
    return item


def sync_private_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def inspect_family(operation_id):
    entries = list(ROOT.iterdir())
    require(len(entries) <= 129, 'Qualification resource inventory exceeds its bound')
    operations = []
    for path in sorted(entries):
        if path.name == 'lock':
            regular(path)
            continue
        require(re.fullmatch(r'[a-f0-9]{64}', path.name), 'Unexpected qualification resource directory')
        directory(path)
        info = path.lstat()
        require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, 'Qualification resource ownership differs')
        state_path = path / 'state.json'
        info = regular(state_path)
        require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0 and info.st_size <= 65536,
                'Qualification state must be owned bounded private data')
        require(not (path / 'state.tmp').exists() and not (path / 'state.tmp').is_symlink(),
                'Interrupted qualification state requires inspection')
        state = json.loads(read(state_path))
        validate({'operationId': state['operationId'], 'operationNonce': state['operationNonce'], 'config': state['config']})
        token = sha(state['operationNonce'].encode())
        require(token == path.name and state['identityPath'] == '/releases/.qualification/' + token + '/identity.json'
                and state['containerName'] == 'situate-qualification-' + token[:32]
                and re.fullmatch(r'[a-f0-9]{64}', state['identitySha256']), 'Qualification state identity differs')
        require(state['status'] in ('prepare-pending', 'prepare-failed', 'prepared', 'stage-pending', 'stage-failed',
                'staged', 'serve-pending', 'serve-failed', 'serving', 'cleanup-pending', 'cleanup-failed',
                'cleaned', 'cleaned-retained'), 'Unknown qualification state')
        if state['operationId'] == operation_id:
            result = facts(state)
            # Retain the observation key used by existing checkpoint receipts.
            result['containerRunning'] = listener_running(state)
            operations.append(result)
    return {'operations': operations}


def read_family(operation_id):
    ancestors(ROOT)
    info = ROOT.lstat()
    require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0,
            'Unsafe qualification resource root')
    regular(ROOT / 'lock')
    fd = os.open(ROOT / 'lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as lock:
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        return inspect_family(operation_id)


def perform(action, request, source=None):
    nonce, config = validate(request)
    baked = immutable_host()
    require(os.getuid() == (IMMUTABLE_UID if baked else HOST_UID), 'Qualification host account or baked listener is missing')
    token = sha(nonce.encode())
    operation = ROOT / token
    require(not ROOT.is_symlink(), 'Qualification resource root must not be a symlink')
    require(config['caddyContainer'] != 'situate-qualification-' + token[:32], 'Production and private listener names must differ')
    if action == 'inspect-family' and not ROOT.exists():
        return {'operations': []}
    if action == 'inspect' and not ROOT.exists():
        return {'status': 'absent', **discover(config)}
    if not ROOT.exists():
        require(action == 'prepare', 'Operation is not prepared')
        ancestors(ROOT.parent)
        ROOT.mkdir(mode=0o700)
        sync_private_directory(ROOT.parent)
    ancestors(ROOT)
    require(ROOT.stat().st_uid == os.getuid() and ROOT.stat().st_mode & 0o077 == 0, 'Private resource root has unsafe ownership or permissions')
    lock_path = ROOT / 'lock'
    fd = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        regular(lock_path)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if action == 'inspect-family':
            return inspect_family(request['operationId'])
        if not operation.exists():
            if action == 'inspect':
                return {'status': 'absent', **discover(config)}
            require(action == 'prepare', 'Operation is not prepared')
            if request.get('replacePrivateView') is True:
                require(baked, 'Replacing a private view requires immutable hosting')
            else:
                family = inspect_family(request['operationId'])
                require(all(member['status'] in ('cleaned', 'cleaned-retained') and not member.get('uncertain', False)
                            and not member['containerRunning'] for member in family['operations']),
                        'An active or uncertain qualification family member requires inspection')
            discovered = discover(config)
            operation.mkdir(mode=0o700)
            sync_private_directory(ROOT)
            identity = encoded({'schemaVersion': 1, 'operationId': request['operationId'], 'operationNonce': nonce, 'hostname': config['hostname'], **discovered})
            state = {'operationId': request['operationId'], 'operationNonce': nonce, 'config': config, 'status': 'prepared', **discovered,
                     'identityPath': '/releases/.qualification/' + token + '/identity.json',
                     'identitySha256': sha(identity), 'containerName': 'situate-qualification-' + token[:32]}
            state['status'] = 'prepare-pending'
            save(operation / 'state.json', state)
            try:
                (operation / 'identity').mkdir(mode=0o700)
                write_new(operation / 'identity' / 'identity.json', identity)
                os.chmod(operation / 'identity', 0o755)
                os.chmod(operation / 'identity' / 'identity.json', 0o644)
                state['status'] = 'prepared'
                save(operation / 'state.json', state)
                return facts(state)
            except BaseException:
                state.update({'status': 'prepare-failed', 'failure': 'prepare', 'uncertain': True})
                save(operation / 'state.json', state)
                raise
        ancestors(operation)
        state = json.loads(read(operation / 'state.json'))
        require(state['operationNonce'] == nonce and state['operationId'] == request['operationId'] and state['config'] == config, 'Operation ownership or configuration differs')
        if action == 'inspect':
            result = facts(state)
            result['containerRunning'] = listener_running(state)
            return result
        if action == 'prepare':
            raise ValueError('Operation already exists; inspect before recovery')
        if action == 'cleanup' and state['status'] in ['cleaned', 'cleaned-retained']:
            return facts(state)
        require(action in ['stage', 'serve', 'cleanup'], 'Unknown qualification operation')
        require(baked == (state.get('listenerProfile') == IMMUTABLE_PROFILE), 'Qualification listener profile changed')
        if action == 'stage':
            require(state['status'] == 'prepared', 'Stage requires a fresh prepared operation')
            files = inventory(request['files'])
            require(config['feedPath'] in files, 'Candidate feed is not in the exact inventory')
            if baked:
                require(all(name == config['feedPath'] or re.fullmatch(
                    r'releases/[0-9]+\.[0-9]+\.[0-9]+/[A-Za-z0-9][A-Za-z0-9._+-]*\.(dmg|tar\.gz|sig)', name)
                    for name in files), 'Candidate file is outside the baked qualification routes')
            state['files'] = files
        if action == 'serve':
            require(state['status'] == 'staged', 'Serve requires verified staged bytes')
        if action == 'cleanup':
            state['artifactsRetained'] = request.get('retainArtifacts') is True or state.get('uncertain', False) or state['status'].endswith(('-pending', '-failed'))
        state['status'] = action + '-pending'
        save(operation / 'state.json', state)
        try:
            if action == 'stage':
                payload = operation / 'payload'
                payload.mkdir(mode=0o700)
                with tarfile.open(fileobj=source or sys.stdin.buffer, mode='r|') as archive:
                    seen = set()
                    for member in archive:
                        require(member.name in files and member.name not in seen and member.isfile()
                                and not member.pax_headers and member.size == files[member.name]['size'], 'Unexpected staged archive member')
                        seen.add(member.name)
                        target = payload / member.name
                        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                        ancestors(target.parent)
                        handle = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                        with archive.extractfile(member) as incoming, os.fdopen(handle, 'wb') as outgoing:
                            shutil.copyfileobj(incoming, outgoing)
                            outgoing.flush()
                            os.fsync(outgoing.fileno())
                verify(payload, files)
                # The private parent remains 0700; Caddy reads these read-only bind mounts without DAC overrides.
                os.chmod(payload, 0o755)
                for path in payload.rglob('*'):
                    os.chmod(path, 0o755 if path.is_dir() else 0o644)
                state['candidateFeedSha256'] = files[config['feedPath']]['sha256']
                state['status'] = 'staged'
            elif action == 'serve':
                verify(operation / 'payload', state['files'])
                require(sha(read(operation / 'identity' / 'identity.json')) == state['identitySha256'], 'Listener identity differs')
                require(discover(config) == listener_binding(state), 'Production qualification listener binding changed')
                if baked:
                    publish_view(operation, state, replace=request.get('replacePrivateView') is True)
                    state['status'] = 'serving'
                    save(operation / 'state.json', state)
                    return facts(state)
                require(owned_container(state) is None, 'Listener already exists; inspect before recovery')
                write_new(operation / 'caddy.json', encoded(caddy_config(state)))
                os.chmod(operation / 'caddy.json', 0o644)
                args = ['docker', 'run', '--detach', '--pull=never', '--name', state['containerName'],
                        '--label', LABEL + '=' + nonce, '--read-only', '--user', '0:0', '--cap-drop=ALL',
                        '--cap-add=NET_BIND_SERVICE', '--security-opt=no-new-privileges:true', '--pids-limit=64',
                        '--publish', '127.0.0.1:' + str(config['hostPort']) + ':8443/tcp',
                        '--mount', 'type=volume,src=' + state['certificateVolume'] + ',dst=/cert-store,readonly',
                        '--mount', 'type=bind,src=' + str(operation / 'payload') + ',dst=/candidate,readonly',
                        '--mount', 'type=bind,src=' + str(operation / 'identity') + ',dst=/identity,readonly',
                        '--mount', 'type=bind,src=' + str(operation / 'caddy.json') + ',dst=/etc/caddy/qualification.json,readonly',
                        '--entrypoint', 'caddy', state['imageId'], 'run', '--config', '/etc/caddy/qualification.json']
                # The existing Caddy binary carries cap_net_bind_service=ep, even when listening on a high port.
                command(args)
                item = owned_container(state)
                require(item is not None and item['State']['Running'] is True, 'Private listener did not remain running')
                require(item['HostConfig']['PortBindings'] == {'8443/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(config['hostPort'])}]}, 'Listener port binding differs')
                state['status'] = 'serving'
            else:
                if baked:
                    retire_view(operation, state)
                else:
                    item = owned_container(state)
                    if item is not None:
                        command(['docker', 'container', 'rm', '--force', item['Id']])
                require(not listener_running(state), 'Listener removal is uncertain')
                if not state['artifactsRetained']:
                    for name in ['payload', 'identity']:
                        path = operation / name
                        if path.exists():
                            ancestors(path)
                            shutil.rmtree(path)
                    config_path = operation / 'caddy.json'
                    if config_path.exists():
                        regular(config_path)
                        config_path.unlink()
                state['status'] = 'cleaned-retained' if state['artifactsRetained'] else 'cleaned'
            save(operation / 'state.json', state)
            return facts(state)
        except BaseException:
            state.update({'status': action + '-failed', 'failure': action, 'uncertain': True})
            save(operation / 'state.json', state)
            raise
    finally:
        os.close(fd)


RUNNER_UID = 0
RUNNER_LOCK = Path('/private/var/run/situate-qualification-route')
RUNNER_HISTORY = Path('/private/var/db/situate-qualification-history')
LEGACY_RUNNER_HISTORY = Path('/private/var/tmp/situate-qualification-history')
HOSTS = Path('/private/etc/hosts')


def replace_hosts(expected, replacement, token):
    info = regular(HOSTS)
    require(read(HOSTS) == expected, 'Runner hosts file changed; refusing to overwrite concurrent changes')
    temporary = HOSTS.parent / ('.situate-hosts-' + token)
    write_new(temporary, replacement)
    os.chmod(temporary, stat.S_IMODE(info.st_mode))
    os.chown(temporary, info.st_uid, info.st_gid)
    require(read(HOSTS) == expected, 'Runner hosts file changed while preparing replacement')
    os.replace(temporary, HOSTS)
    fd = os.open(HOSTS.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def runner_history_parent(parent, *, allow_sticky=False):
    for path in [*reversed(parent.parents), parent]:
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == RUNNER_UID
                and (not info.st_mode & 0o022 or (allow_sticky and path == parent and info.st_mode & stat.S_ISVTX)),
                'Unsafe runner history parent')


def legacy_runner_directory(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    if info.st_uid != RUNNER_UID:
        return False
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700,
            'Unsafe legacy runner history entry')
    return True


def runner_archive(token):
    name = 'situate-qualification-route-' + token
    used = 'Runner operation was already used; inspect retained evidence'
    legacy_parent = LEGACY_RUNNER_HISTORY.parent
    runner_history_parent(legacy_parent, allow_sticky=True)
    require(not legacy_runner_directory(legacy_parent / name)
            and not (legacy_runner_directory(LEGACY_RUNNER_HISTORY)
                     and legacy_runner_directory(LEGACY_RUNNER_HISTORY / name)), used)

    parent = RUNNER_HISTORY.parent
    runner_history_parent(parent)
    try:
        RUNNER_HISTORY.mkdir(mode=0o700)
        sync_private_directory(parent)
    except FileExistsError:
        pass
    info = RUNNER_HISTORY.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == RUNNER_UID and stat.S_IMODE(info.st_mode) == 0o700,
            'Unsafe runner history directory')
    archive = RUNNER_HISTORY / name
    try:
        archive.lstat()
    except FileNotFoundError:
        return archive
    raise ValueError(used)


def runner_perform(action, request):
    require(sys.platform == 'darwin' and os.geteuid() == RUNNER_UID, 'Runner routing requires privileged trusted macOS')
    nonce = request['operationNonce']
    require(isinstance(nonce, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', nonce), 'Invalid runner operation nonce')
    require(request['privateAddress'] == '127.0.0.2' and request['localPort'] == 443, 'Invalid runner loopback binding')
    require(re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', request['hostname']), 'Invalid runner hostname')
    token = sha(nonce.encode())
    if action == 'runner-prepare':
        runner_archive(token)
        ancestors(RUNNER_LOCK.parent)
        RUNNER_LOCK.mkdir(mode=0o700)
        state = {'request': request, 'status': 'reserved', 'hostsPending': False, 'aliasPending': False}
        save(RUNNER_LOCK / 'state.json', state)
    else:
        ancestors(RUNNER_LOCK)
        require(RUNNER_LOCK.stat().st_uid == RUNNER_UID and RUNNER_LOCK.stat().st_mode & 0o077 == 0, 'Runner resource ownership differs')
        state = json.loads(read(RUNNER_LOCK / 'state.json'))
        require(state['request'] == request, 'Runner operation ownership differs')
    if action == 'runner-cleanup':
        archive = runner_archive(token)
    try:
        if action == 'runner-prepare':
            original = read(HOSTS)
            for line in original.decode().splitlines():
                require(request['hostname'] not in line.split('#', 1)[0].split()[1:], 'Runner hostname already has a local mapping')
            interface = command(['/sbin/ifconfig', 'lo0'])
            require(not re.search(r'\binet\s+127\.0\.0\.2\b', interface), 'Runner loopback alias is already owned')
            write_new(RUNNER_LOCK / 'hosts.original', original)
            replacement = original + b'\n127.0.0.2 ' + request['hostname'].encode() + b' # situate-' + token.encode() + b'\n'
            state.update({'hostsPending': True, 'originalSha256': sha(original), 'replacementSha256': sha(replacement)})
            save(RUNNER_LOCK / 'state.json', state)
            replace_hosts(original, replacement, token)
            state['aliasPending'] = True
            save(RUNNER_LOCK / 'state.json', state)
            command(['/sbin/ifconfig', 'lo0', 'alias', '127.0.0.2', '255.255.255.255'])
            command(['/usr/bin/dscacheutil', '-flushcache'])
            command(['/usr/bin/killall', '-HUP', 'mDNSResponder'])
            state['status'] = 'prepared'
        elif action in ['runner-ssh-pending', 'runner-serving', 'runner-failed']:
            state['status'] = action.removeprefix('runner-')
        elif action == 'runner-cleanup':
            require(not (RUNNER_LOCK / 'ssh').exists(), 'SSH control socket still exists; refusing to release runner ownership')
            if state['hostsPending']:
                original = read(RUNNER_LOCK / 'hosts.original')
                require(sha(original) == state['originalSha256'], 'Original hosts snapshot differs')
                current = read(HOSTS)
                if sha(current) == state['replacementSha256']:
                    replace_hosts(current, original, token)
                else:
                    require(current == original, 'Runner hosts file changed; ownership retained for recovery')
                state['hostsPending'] = False
                save(RUNNER_LOCK / 'state.json', state)
            if state['aliasPending']:
                interface = command(['/sbin/ifconfig', 'lo0'])
                if re.search(r'\binet\s+127\.0\.0\.2\b', interface):
                    command(['/sbin/ifconfig', 'lo0', '-alias', '127.0.0.2'])
                state['aliasPending'] = False
                save(RUNNER_LOCK / 'state.json', state)
            command(['/usr/bin/dscacheutil', '-flushcache'])
            command(['/usr/bin/killall', '-HUP', 'mDNSResponder'])
            state['status'] = 'cleaned'
        else:
            raise ValueError('Unknown runner operation')
        save(RUNNER_LOCK / 'state.json', state)
        if action == 'runner-cleanup':
            os.rename(RUNNER_LOCK, archive)
    except BaseException:
        state.update({'status': 'failed', 'failure': action, 'uncertain': True})
        save(RUNNER_LOCK / 'state.json', state)
        raise
    if action == 'runner-cleanup':
        sync_private_directory(RUNNER_HISTORY)
        sync_private_directory(RUNNER_LOCK.parent)
    return {'status': state['status'], 'operationNonce': nonce}


def main():
    os.umask(0o077)
    action, payload = sys.argv[1:]
    request = json.loads(base64.b64decode(payload, validate=True))
    operation = runner_perform if action.startswith('runner-') else perform
    print(json.dumps(operation(action, request)))


if __name__ == '__main__':
    main()
