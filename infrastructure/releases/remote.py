"""Release storage transaction, invoked over a verified SSH connection."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tarfile

ROOT = Path('/opt/situate')
VERSION = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?\Z')


def compare(a, b):
    left, right = VERSION.fullmatch(a), VERSION.fullmatch(b)
    if not left or not right:
        raise ValueError('Invalid stored release version')
    for x, y in zip(left.groups()[:3], right.groups()[:3]):
        if int(x) != int(y):
            return 1 if int(x) > int(y) else -1
    x, y = left[4], right[4]
    if x is None or y is None:
        return (x is None) - (y is None)
    for x, y in zip(x.split('.'), y.split('.')):
        if x != y:
            if x.isdigit() and y.isdigit():
                return 1 if int(x) > int(y) else -1
            if x.isdigit() != y.isdigit():
                return -1 if x.isdigit() else 1
            return 1 if x > y else -1
    return len(left[4].split('.')) - len(right[4].split('.'))


def entry(path):
    try:
        return path.lstat()
    except FileNotFoundError:
        return None


def require_regular(metadata):
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise ValueError('Expected a single-link regular release file')


def require_directory(path):
    if not stat.S_ISDIR(path.lstat().st_mode):
        raise ValueError('Expected a real release directory without symlinks')


def validate_tree(path):
    require_directory(path)
    for child in path.iterdir():
        metadata = child.lstat()
        if stat.S_ISDIR(metadata.st_mode):
            validate_tree(child)
        else:
            require_regular(metadata)


def validate_storage(token):
    for path in [*reversed(ROOT.parents), ROOT]:
        require_directory(path)
    for name in ['release.lock', 'release-pending.json', 'release-pending.tmp']:
        metadata = entry(ROOT / name)
        if metadata is not None:
            require_regular(metadata)
    releases = ROOT / 'releases'
    if entry(releases) is not None:
        require_directory(releases)
        for path in releases.iterdir():
            if not VERSION.fullmatch(path.name):
                raise ValueError('Unexpected release storage entry')
            validate_tree(path)
    incoming = ROOT / ('.release-incoming-' + token)
    if entry(incoming) is not None:
        validate_tree(incoming)
    for name in ['current-release', '.current-release-' + token]:
        pointer = ROOT / name
        metadata = entry(pointer)
        if metadata is not None:
            target = re.fullmatch(r'releases/([^/]+)/metadata', os.readlink(pointer)) if stat.S_ISLNK(metadata.st_mode) else None
            if not target or not VERSION.fullmatch(target[1]):
                raise ValueError('Unexpected active release pointer')


def open_regular(path, flags, mode=0o600):
    handle = os.open(path, flags | os.O_NOFOLLOW | os.O_NONBLOCK, mode)
    try:
        metadata = os.fstat(handle)
        require_regular(metadata)
        current = path.lstat()
        if (metadata.st_dev, metadata.st_ino) != (current.st_dev, current.st_ino):
            raise ValueError('Release file changed while opening it')
        return handle
    except BaseException:
        os.close(handle)
        raise


def read_pending(path):
    with os.fdopen(open_regular(path, os.O_RDONLY)) as stream:
        return json.load(stream)


def history(*, include_qualifications=False):
    releases = ROOT / 'releases'
    if entry(releases) is None:
        if entry(ROOT / 'current-release') is not None or entry(ROOT / 'release-pending.json') is not None:
            raise ValueError('Missing stored release directory')
        return ([], []) if include_qualifications else []
    require_directory(releases)
    result = []
    qualifications = []
    for directory in sorted(releases.iterdir(), key=lambda path: path.name):
        with os.fdopen(open_regular(directory / 'manifest.json', os.O_RDONLY), 'rb') as stream:
            data = stream.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise ValueError('Stored release manifest exceeds 1 MiB')
        manifest = json.loads(data)
        if (not isinstance(manifest, dict) or type(manifest.get('schemaVersion')) is not int
                or manifest['schemaVersion'] != 1 or manifest.get('status') != 'complete'
                or manifest.get('dirty') is not False or manifest.get('distribution') != 'direct'
                or manifest.get('version') != directory.name
                or not isinstance(manifest.get('revision'), str)
                or not re.fullmatch(r'[a-f0-9]{40}', manifest['revision'])):
            raise ValueError('Invalid stored release manifest')
        release = {'version': directory.name, 'revision': manifest['revision'],
                   'manifestSha256': hashlib.sha256(data).hexdigest()}
        result.append(release)
        if not include_qualifications:
            continue
        qualification = manifest.get('migrationQualification')
        if (isinstance(qualification, dict) and type(qualification.get('schemaVersion')) is int
                and qualification['schemaVersion'] == 1
                and qualification.get('source') == 'macos-direct-publication'
                and type(qualification.get('migrations')) is int and qualification['migrations'] >= 0):
            predecessors = qualification.get('releases')
            if isinstance(predecessors, list):
                predecessors = [{key: prior.get(key) if isinstance(prior.get(key), str) else None
                                 for key in ['version', 'revision', 'manifestSha256']}
                                if isinstance(prior, dict) else None for prior in predecessors]
            else:
                predecessors = None
            qualifications.append({'release': release, 'qualification': {
                'schemaVersion': 1, 'source': 'macos-direct-publication',
                'releases': predecessors, 'migrations': qualification.get('migrations')}})
    return (result, qualifications) if include_qualifications else result


def validate_baseline(baseline):
    if not isinstance(baseline, list):
        raise ValueError('A migration baseline is required')
    versions = []
    for release in baseline:
        if (not isinstance(release, dict) or set(release) != {'version', 'revision', 'manifestSha256'}
                or not isinstance(release['version'], str) or not VERSION.fullmatch(release['version'])
                or not isinstance(release['revision'], str) or not re.fullmatch(r'[a-f0-9]{40}', release['revision'])
                or not isinstance(release['manifestSha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', release['manifestSha256'])):
            raise ValueError('Invalid migration baseline')
        versions.append(release['version'])
    if versions != sorted(set(versions)):
        raise ValueError('Migration baseline must contain unique, sorted versions')


def digest(path):
    value = hashlib.sha256()
    with os.fdopen(open_regular(path, os.O_RDONLY), 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def verify(directory, files):
    if directory.is_symlink():
        raise ValueError('Unexpected release symlink')
    paths = list(directory.rglob('*'))
    if any(path.is_symlink() for path in paths):
        raise ValueError('Unexpected release symlink')
    actual = {str(path.relative_to(directory)) for path in paths if not path.is_dir()}
    if actual != set(files):
        raise ValueError('Release file inventory differs')
    for name, expected in files.items():
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != expected['size'] or digest(path) != expected['sha256']:
            raise ValueError('Release bytes differ')


def save(path, value):
    temporary = path.with_suffix('.tmp')
    handle = open_regular(temporary, os.O_WRONLY | os.O_CREAT)
    os.ftruncate(handle, 0)
    os.fchmod(handle, 0o600)
    with os.fdopen(handle, 'w') as stream:
        json.dump(value, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    sync_directory(path.parent)


def sync_directory(path):
    handle = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(handle)
    finally:
        os.close(handle)


def main():
    os.umask(0o077)
    action, encoded = sys.argv[1:]
    request = json.loads(base64.b64decode(encoded, validate=True))
    if action == 'history':
        validate_storage('')
        with os.fdopen(open_regular(ROOT / 'release.lock', os.O_WRONLY | os.O_CREAT), 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_SH)
            validate_storage('')
            releases, qualifications = history(include_qualifications=True)
            print(json.dumps({'schemaVersion': 1, 'releases': releases, 'qualifications': qualifications}))
        return
    version, token, files = request['version'], request['token'], request['files']
    if not VERSION.fullmatch(version) or not re.fullmatch(r'[a-f0-9-]{36}', token):
        raise ValueError('Invalid publication identity')
    for name, item in files.items():
        if not re.fullmatch(r'(?:metadata/)?[A-Za-z0-9][A-Za-z0-9._+-]*', name) or not re.fullmatch(r'[a-f0-9]{64}', item['sha256']) or type(item['size']) is not int or item['size'] < 0:
            raise ValueError('Invalid release file')
    releases = ROOT / 'releases'
    pending = ROOT / 'release-pending.json'
    current = ROOT / 'current-release'
    destination = releases / version
    validate_storage(token)
    if action not in ('inspect', 'publish', 'reconcile', 'complete'):
        raise ValueError('Unknown publication action')
    with os.fdopen(open_regular(ROOT / 'release.lock', os.O_WRONLY | os.O_CREAT), 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        validate_storage(token)
        if action == 'inspect':
            print(json.dumps({'pending': read_pending(pending) if entry(pending) is not None else None,
                              'current': os.readlink(current) if current.is_symlink() else None,
                              'versionExists': destination.exists(),
                              'identical': identical(destination, files)}))
            return
        if action == 'complete':
            if request.get('publicVerificationRequired') is not True:
                raise ValueError('Public verification checkpoint is required')
            if entry(pending) is None or read_pending(pending) != request:
                raise ValueError('Publication checkpoint differs; inspect before recovery')
            if not current.is_symlink() or os.readlink(current) != 'releases/' + version + '/metadata':
                raise ValueError('Active release changed before public verification completed')
            verify(destination, files)
            pending.unlink()
            sync_directory(ROOT)
            print(json.dumps({'version': version, 'active': True, 'publicVerified': True}))
            return
        validate_baseline(request.get('migrationBaseline'))
        if current.is_symlink():
            active = re.fullmatch(r'releases/([^/]+)/metadata', os.readlink(current))
            if not active or compare(version, active[1]) < 0 or (compare(version, active[1]) == 0 and version != active[1]):
                raise ValueError('Unexpected pointer or backward release activation')
        if releases.is_symlink() or destination.is_symlink():
            raise ValueError('Unexpected release symlink')
        for path in (releases.iterdir() if releases.exists() else []):
            if path.is_symlink() or not path.is_dir() or not VERSION.fullmatch(path.name):
                raise ValueError('Unexpected release storage entry')
            if compare(version, path.name) < 0 or (compare(version, path.name) == 0 and version != path.name):
                raise ValueError('Release activation must move forward')
        if destination.exists():
            verify(destination, files)
            if action != 'reconcile':
                raise ValueError('Version already exists; inspect and reconcile identical bytes')
        if entry(pending) is not None:
            previous = read_pending(pending)
            if isinstance(previous, dict) and 'migrationBaseline' not in previous:
                previous = {**previous, 'migrationBaseline': request['migrationBaseline']}
            if action != 'reconcile' or previous != request:
                raise ValueError('An unresolved publication requires exact reconciliation')
        actual = history()
        if destination.exists():
            candidate = next(release for release in actual if release['version'] == version)
            if candidate['manifestSha256'] != files.get('manifest.json', {}).get('sha256'):
                raise ValueError('Stored manifest differs from publication request')
            actual = [release for release in actual if release['version'] != version]
        if actual != request['migrationBaseline']:
            raise ValueError('Stale migration baseline; inspect release history again')
        releases.mkdir(exist_ok=True)
        releases.chmod(0o755)
        save(pending, request)
        incoming = ROOT / ('.release-incoming-' + token)
        if incoming.exists():
            if action != 'reconcile' or incoming.is_symlink():
                raise ValueError('Existing incoming release requires inspection')
            shutil.rmtree(incoming)
        incoming.mkdir()
        with tarfile.open(fileobj=sys.stdin.buffer, mode='r|') as archive:
            seen = set()
            for member in archive:
                if member.name not in files or member.name in seen or not member.isfile() or member.size != files[member.name]['size']:
                    raise ValueError('Unexpected uploaded archive member')
                seen.add(member.name)
                target = incoming / member.name
                target.parent.mkdir(exist_ok=True)
                with archive.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                    output.flush()
                    os.fchmod(output.fileno(), 0o644)
                    os.fsync(output.fileno())
        verify(incoming, files)
        if destination.exists():
            verify(destination, files)
            shutil.rmtree(incoming)
        else:
            (incoming / 'metadata').chmod(0o755)
            incoming.chmod(0o755)
            sync_directory(incoming / 'metadata')
            sync_directory(incoming)
            os.rename(incoming, destination)
            sync_directory(releases)
        temporary = ROOT / ('.current-release-' + token)
        if temporary.is_symlink():
            temporary.unlink()
        temporary.symlink_to('releases/' + version + '/metadata')
        os.replace(temporary, current)
        sync_directory(ROOT)
        if request.get('publicVerificationRequired') is not True:
            pending.unlink()
            sync_directory(ROOT)
        print(json.dumps({'version': version, 'active': True}))


def identical(directory, files):
    try:
        verify(directory, files)
        return True
    except (OSError, ValueError):
        return False


if __name__ == '__main__':
    main()
