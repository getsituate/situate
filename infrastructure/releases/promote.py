"""Publish verified immutable bytes without a cross-run transaction journal.

Runs in the remote.py namespace. The existing release lock also fences host
replacement; the published version directory and pointer are the only receipts.
"""


WINDOWS_FEED = 'metadata/windows-update.json'


def activate_pointer(scratch, current, target):
    if entry(scratch) is not None:
        if not scratch.is_symlink() or not re.fullmatch(r'releases/([^/]+)/metadata', os.readlink(scratch)):
            raise ValueError('Invalid temporary activation link')
        scratch.unlink()
    scratch.symlink_to(target)
    os.replace(scratch, current)
    sync_directory(ROOT)


def active_windows_release(current):
    if entry(current) is None:
        return None
    target = re.fullmatch(r'releases/([^/]+)/metadata', os.readlink(current)) if current.is_symlink() else None
    if not target or not VERSION.fullmatch(target[1]):
        raise ValueError('Invalid Windows release pointer')
    verify_windows_version(ROOT / target[0] / 'windows-update.json', target[1])
    return target[1]


def verify_windows_version(feed, version):
    with os.fdopen(open_regular(feed, os.O_RDONLY)) as stream:
        if json.load(stream)['version'] != version:
            raise ValueError('Windows feed version differs from the release')


def promote(request, source):
    version, files = request['version'], request['files']
    if not VERSION.fullmatch(version) or not {'manifest.json', 'metadata/update.json',
            'metadata/download.json', 'metadata/descriptor.json'} <= files.keys():
        raise ValueError('Invalid publication identity')
    for name, item in files.items():
        if (not re.fullmatch(r'(?:metadata/)?[A-Za-z0-9][A-Za-z0-9._+-]*', name)
                or not re.fullmatch(r'[a-f0-9]{64}', item['sha256'])
                or type(item['size']) is not int or item['size'] < 0):
            raise ValueError('Invalid release file')
    validate_baseline(request['migrationBaseline'])
    validate_storage('')
    releases = ROOT / 'releases'
    destination = releases / version
    current = ROOT / 'current-release'
    staging = ROOT / '.release-transfer'
    pointer = ROOT / '.release-activation'
    windows = ROOT / 'current-windows-release'
    with os.fdopen(open_regular(ROOT / 'release.lock', os.O_WRONLY | os.O_CREAT), 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        validate_storage('')
        active = os.readlink(current) if current.is_symlink() else None
        expected = 'releases/' + version + '/metadata'
        actual = history()
        if active is not None and active not in [
                'releases/' + release['version'] + '/metadata' for release in actual]:
            raise ValueError('Active release is missing from storage')
        for release in actual:
            comparison = compare(version, release['version'])
            if comparison < 0 or (comparison == 0 and release['version'] != version):
                raise ValueError('Release activation must move forward')
        if [release for release in actual if release['version'] != version] != request['migrationBaseline']:
            raise ValueError('Stale migration baseline')
        windows_active = active_windows_release(windows) if WINDOWS_FEED in files else None
        if windows_active is not None and windows_active != version and compare(version, windows_active) <= 0:
            raise ValueError('Windows release activation must move forward')
        if entry(destination) is not None:
            verify(destination, files)
            if WINDOWS_FEED in files:
                verify_windows_version(destination / WINDOWS_FEED, version)
        if entry(staging) is not None:
            require_directory(staging)
            shutil.rmtree(staging)
        if entry(pointer) is not None:
            if not pointer.is_symlink() or not re.fullmatch(r'releases/([^/]+)/metadata', os.readlink(pointer)):
                raise ValueError('Invalid temporary activation link')
            pointer.unlink()
        if entry(destination) is None:
            if not releases.exists():
                releases.mkdir()
                releases.chmod(0o755)
            staging.mkdir(mode=0o700)
            try:
                with tarfile.open(fileobj=source, mode='r|') as archive:
                    seen = set()
                    for member in archive:
                        if member.name not in files or member.name in seen or not member.isfile() or member.size != files[member.name]['size']:
                            raise ValueError('Unexpected uploaded archive member')
                        seen.add(member.name)
                        target = staging / member.name
                        target.parent.mkdir(exist_ok=True)
                        with archive.extractfile(member) as stream, target.open('xb') as output:
                            shutil.copyfileobj(stream, output)
                            output.flush()
                            os.fchmod(output.fileno(), 0o644)
                            os.fsync(output.fileno())
                verify(staging, files)
                if WINDOWS_FEED in files:
                    verify_windows_version(staging / WINDOWS_FEED, version)
                (staging / 'metadata').chmod(0o755)
                staging.chmod(0o755)
                sync_directory(staging / 'metadata')
                sync_directory(staging)
                os.rename(staging, destination)
                sync_directory(releases)
            finally:
                if staging.exists():
                    shutil.rmtree(staging)
        if active != expected:
            activate_pointer(pointer, current, expected)
        if WINDOWS_FEED in files and windows_active != version:
            activate_pointer(ROOT / '.windows-release-activation', windows, expected)
        return {'version': version, 'active': True}


def promote_main():
    os.umask(0o077)
    request = json.loads(base64.b64decode(sys.argv[2], validate=True))
    print(json.dumps(promote(request, sys.stdin.buffer)))
