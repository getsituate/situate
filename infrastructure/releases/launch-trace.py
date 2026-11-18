"""Private, immutable launch evidence under the release allocator's lock."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

ROOT = Path('/opt/situate')
MAX_TRACE_BYTES = 256 * 1024
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_NOFOLLOW | os.O_NONBLOCK


def identity(value):
    if (not isinstance(value, dict)
            or set(value) != {'operationId', 'planDigest', 'sourceRevision'}
            or not isinstance(value['operationId'], str)
            or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', value['operationId'])
            or not isinstance(value['planDigest'], str)
            or not re.fullmatch(r'[a-f0-9]{64}', value['planDigest'])
            or not isinstance(value['sourceRevision'], str)
            or not re.fullmatch(r'[a-f0-9]{40}', value['sourceRevision'])):
        raise ValueError('Invalid identity')
    return value


def trace_uuid(value):
    if not isinstance(value, str) or not re.fullmatch(
            r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', value):
        raise ValueError('Invalid trace identifier')
    return value


def parse_json(data):
    def invalid_constant(_):
        raise ValueError('Invalid JSON constant')
    return json.loads(data.decode('utf-8'), parse_constant=invalid_constant)


def directory(parent, name, create=False):
    if create:
        try:
            os.mkdir(name, 0o700, dir_fd=parent)
            os.fsync(parent)
        except FileExistsError:
            pass
    handle = os.open(name, DIRECTORY_FLAGS, dir_fd=parent)
    try:
        metadata = os.fstat(handle)
        if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o700:
            raise ValueError('Invalid private directory')
        return handle
    except BaseException:
        os.close(handle)
        raise


def root_directory():
    handle = os.open('/', DIRECTORY_FLAGS)
    try:
        for part in ROOT.parts[1:]:
            child = os.open(part, DIRECTORY_FLAGS, dir_fd=handle)
            os.close(handle)
            handle = child
        return handle
    except BaseException:
        os.close(handle)
        raise


def private_file(parent, name, flags):
    handle = os.open(name, flags | FILE_FLAGS, 0o600, dir_fd=parent)
    try:
        metadata = os.fstat(handle)
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1
                or metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o600):
            raise ValueError('Invalid private file')
        return handle
    except BaseException:
        os.close(handle)
        raise


def read_file(parent, name, limit):
    with os.fdopen(private_file(parent, name, os.O_RDONLY), 'rb') as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Oversized private file')
    return data


def write_file(parent, name, data):
    with os.fdopen(private_file(parent, name, os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def require_active_claim(root, expected):
    for name in ('release-allocation-pending.json', 'release-allocation-pending.tmp'):
        try:
            os.stat(name, dir_fd=root, follow_symlinks=False)
        except FileNotFoundError:
            continue
        raise ValueError('Unresolved allocation')
    data = read_file(root, 'release-operations.jsonl', 16 * 1024 * 1024)
    if data and not data.endswith(b'\n'):
        raise ValueError('Interrupted operation journal')
    active = None
    for line in data.splitlines():
        record = parse_json(line)
        if not isinstance(record, dict) or set(record) != {'identity', 'state'}:
            raise ValueError('Invalid operation journal')
        current = identity(record['identity'])
        if record['state'] == 'claimed' and active is None:
            active = current
        elif record['state'] == 'completed' and active == current:
            active = None
        else:
            raise ValueError('Invalid operation transition')
    if active != expected:
        raise ValueError('Active release identity differs')


def descriptor(value, expected, trace_id):
    if (not isinstance(value, dict)
            or set(value) != {'schemaVersion', 'identity', 'traceId', 'sha256', 'size'}
            or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1
            or identity(value['identity']) != expected or value['traceId'] != trace_id
            or type(value['size']) is not int or not 1 <= value['size'] <= MAX_TRACE_BYTES
            or not isinstance(value['sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', value['sha256'])):
        raise ValueError('Invalid trace descriptor')
    return value


def transfer():
    os.umask(0o077)
    header = sys.stdin.buffer.readline(4097)
    if len(header) > 4096 or not header.endswith(b'\n'):
        raise ValueError('Invalid trace request')
    request = parse_json(header)
    action = request.get('action')
    expected_keys = {'action', 'identity', 'traceId'} | ({'size', 'sha256'} if action == 'retain' else set())
    if action not in ('retain', 'read') or set(request) != expected_keys:
        raise ValueError('Invalid trace action')
    expected = identity(request['identity'])
    trace_id = trace_uuid(request['traceId'])
    metadata = None
    if action == 'retain':
        metadata = descriptor({key: value for key, value in request.items() if key != 'action'}
                              | {'schemaVersion': 1}, expected, trace_id)
    root = root_directory()
    handles = [root]
    try:
        lock = private_file(root, 'release.lock', os.O_RDONLY)
        handles.append(lock)
        fcntl.flock(lock, fcntl.LOCK_EX if action == 'retain' else fcntl.LOCK_SH)
        if action == 'retain':
            require_active_claim(root, expected)
        data = sys.stdin.buffer.read((metadata['size'] if metadata else 0) + 1)
        if action == 'retain':
            if len(data) != metadata['size'] or hashlib.sha256(data).hexdigest() != metadata['sha256']:
                raise ValueError('Trace bytes differ')
            parse_json(data)
        elif data:
            raise ValueError('Unexpected request bytes')
        store = directory(root, 'release-diagnostics', create=action == 'retain')
        handles.append(store)
        operation = directory(store, expected['operationId'], create=action == 'retain')
        handles.append(operation)
        if action == 'retain':
            # An interrupted UUID remains occupied; a retry must never overwrite evidence.
            os.mkdir(trace_id, 0o700, dir_fd=operation)
            os.fsync(operation)
        record = directory(operation, trace_id)
        handles.append(record)
        if action == 'retain':
            write_file(record, 'trace.json', data)
            write_file(record, 'descriptor.json', json.dumps(metadata, sort_keys=True).encode() + b'\n')
            os.fsync(record)
            os.fsync(operation)
            reply = {'durable': True, **{key: metadata[key] for key in ('traceId', 'sha256', 'size')}}
            print(json.dumps(reply), flush=True)
        else:
            metadata = descriptor(parse_json(read_file(record, 'descriptor.json', 4096)), expected, trace_id)
            data = read_file(record, 'trace.json', MAX_TRACE_BYTES)
            if len(data) != metadata['size'] or hashlib.sha256(data).hexdigest() != metadata['sha256']:
                raise ValueError('Retained trace differs')
            parse_json(data)
            sys.stdout.buffer.write(json.dumps(metadata).encode() + b'\n' + data)
            sys.stdout.buffer.flush()
    finally:
        for handle in reversed(handles):
            os.close(handle)


def launch_trace_main():
    try:
        transfer()
    except Exception:
        print('Private launch trace transfer failed; inspect retained evidence.', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    launch_trace_main()
