"""Line protocol held under the publication host's existing release lock.

Executed with remote.py's storage primitives in the same namespace. EOF releases
only the advisory lock; durable intent survives process and connection loss.
"""


def notary_records():
    journal = ROOT / 'release-notary-journal.jsonl'
    if entry(journal) is None:
        return []
    with os.fdopen(open_regular(journal, os.O_RDONLY), 'r') as stream:
        data = stream.read(16 * 1024 * 1024 + 1)
    if len(data) > 16 * 1024 * 1024 or (data and not data.endswith('\n')):
        raise ValueError('Notary journal is oversized or interrupted; inspect storage')
    records = [json.loads(line) for line in data.splitlines()]
    for record in records:
        if (not isinstance(record, dict) or set(record) != {'operationId', 'entry'}
                or not isinstance(record['entry'], dict)):
            raise ValueError('Invalid notary journal record')
    return records


def notary_action(request):
    operation = request['operationId']
    if not isinstance(operation, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}', operation):
        raise ValueError('Invalid notary operation ID')
    records = notary_records()
    selected = [record['entry'] for record in records if record['operationId'] == operation]
    if request['action'] == 'journal-inspect-family':
        children = {}
        pattern = re.compile(re.escape(operation) + r'-[a-f0-9]{32}\Z')
        for record in records:
            if pattern.fullmatch(record['operationId']):
                children.setdefault(record['operationId'], []).append(record['entry'])
        return {'operationId': operation, 'operations': [
            {'operationId': child, 'records': children[child]} for child in sorted(children)]}
    if request['action'] == 'journal-inspect':
        return {'operationId': operation, 'records': selected}
    value = request['entry']
    if not isinstance(value, dict) or value.get('phase') not in ('intent', 'submission', 'completion'):
        raise ValueError('Invalid notary entry phase')
    if selected:
        for key in ('file', 'sha256', 'parentOperationId'):
            if key in selected[0] and value.get(key) != selected[0][key]:
                raise ValueError('Notary payload binding differs')
    if selected and 'parentOperationId' in selected[0]:
        submissions = [item for item in selected if item.get('phase') == 'submission']
        if submissions and value.get('submissionId') != submissions[0].get('submissionId'):
            raise ValueError('Notary submission binding differs')
    if selected and selected[-1] == value and value['phase'] != 'intent':
        return {'durable': True, 'operationId': operation}
    phase = value['phase']
    if phase == 'intent':
        latest = {record['operationId']: record['entry'] for record in records}
        if selected or any(item.get('phase') != 'completion' or item.get('outcome') not in ('success', 'failed')
                           for item in latest.values()):
            raise ValueError('An existing notary operation requires inspection')
    elif not selected or selected[0].get('phase') != 'intent':
        raise ValueError('Notary submission requires durable intent')
    elif phase == 'submission':
        if selected[-1]['phase'] != 'intent' or not isinstance(value.get('submissionId'), str) or not value['submissionId']:
            raise ValueError('Notary submission differs or has no ID')
    elif value.get('outcome') not in ('success', 'failed', 'unknown'):
        raise ValueError('Notary completion requires an explicit outcome')
    elif selected[-1]['phase'] == 'completion' and selected[-1].get('outcome') != 'unknown':
        raise ValueError('Notary completion is immutable')
    elif value['outcome'] == 'success' and not any(item['phase'] == 'submission' for item in selected):
        raise ValueError('Notary success requires a recorded submission')
    data = (json.dumps({'operationId': operation, 'entry': value}, sort_keys=True) + '\n').encode()
    if len(data) > 65536:
        raise ValueError('Notary record exceeds 64 KiB')
    with os.fdopen(open_regular(ROOT / 'release-notary-journal.jsonl', os.O_WRONLY | os.O_CREAT | os.O_APPEND), 'ab') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    sync_directory(ROOT)
    return {'durable': True, 'operationId': operation}


def release_coordination(request):
    identity = {key: request.get(key) for key in ('operationId', 'planDigest', 'sourceRevision')}
    if (not isinstance(identity['operationId'], str)
            or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}', identity['operationId'])
            or not isinstance(identity['planDigest'], str) or not re.fullmatch(r'[a-f0-9]{64}', identity['planDigest'])
            or not isinstance(identity['sourceRevision'], str) or not re.fullmatch(r'[a-f0-9]{40}(?:[a-f0-9]{24})?', identity['sourceRevision'])):
        raise ValueError('Invalid release operation identity')
    journal = ROOT / 'release-operations.jsonl'
    if entry(journal) is None:
        data = b''
    else:
        with os.fdopen(open_regular(journal, os.O_RDONLY), 'rb') as stream:
            data = stream.read(16 * 1024 * 1024 + 1)
    if len(data) > 16 * 1024 * 1024 or (data and not data.endswith(b'\n')):
        raise ValueError('Release operation journal is oversized or interrupted')
    records = [json.loads(line) for line in data.splitlines()]
    active = None
    for record in records:
        if not isinstance(record, dict) or set(record) != {'identity', 'state'}:
            raise ValueError('Invalid release operation record')
        if record['state'] == 'claimed' and active is None:
            active = record['identity']
        elif record['state'] == 'completed' and active == record['identity']:
            active = None
        else:
            raise ValueError('Invalid release operation state transition')
    selected = [record for record in records if record['identity'].get('operationId') == identity['operationId']]
    if any(record['identity'] != identity for record in selected):
        raise ValueError('Release operation identity differs')
    snapshot = hashlib.sha256(data).hexdigest()
    action = request['action']
    if action == 'release-inspect':
        return {'operationId': identity['operationId'], 'active': active, 'records': selected,
                'inspectionDigest': snapshot}
    if action == 'release-claim':
        if active is not None:
            if active != identity:
                raise ValueError('Another release operation requires inspection')
            if request.get('inspectionDigest') != snapshot:
                raise ValueError('Existing release claim requires explicit fresh inspection')
            return {'durable': True, 'operationId': identity['operationId'], 'resumed': True}
        if selected:
            raise ValueError('A completed release operation cannot be reused')
        state = 'claimed'
    elif action == 'release-complete':
        if selected and selected[-1]['state'] == 'completed':
            return {'durable': True, 'operationId': identity['operationId'], 'completed': True}
        if active != identity:
            raise ValueError('Completion requires the exact active release operation')
        state = 'completed'
    else:
        raise ValueError('Unknown release coordination action')
    record = (json.dumps({'identity': identity, 'state': state}, sort_keys=True) + '\n').encode()
    with os.fdopen(open_regular(journal, os.O_WRONLY | os.O_CREAT | os.O_APPEND), 'ab') as stream:
        stream.write(record)
        stream.flush()
        os.fsync(stream.fileno())
    sync_directory(ROOT)
    return {'durable': True, 'operationId': identity['operationId'], 'completed': state == 'completed'}


def allocator_inventory():
    releases, qualifications = history(include_qualifications=True)
    builds = []
    for release in releases:
        with os.fdopen(open_regular(ROOT / 'releases' / release['version'] / 'manifest.json', os.O_RDONLY), 'r') as stream:
            manifest = json.load(stream)
        artifacts = manifest.get('artifacts')
        if not isinstance(artifacts, list):
            raise ValueError('Stored release has no artifact inventory')
        macos = [artifact for artifact in artifacts if isinstance(artifact, dict) and artifact.get('platform') == 'macos']
        if not macos:
            raise ValueError('Stored release has no macOS build inventory')
        for artifact in macos:
            value = artifact.get('buildNumber', manifest.get('buildNumber', manifest['version']))
            if not isinstance(value, str) or not re.fullmatch(r'(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,2}', value):
                raise ValueError('Invalid stored Apple build number')
            components = [int(part) for part in value.split('.')]
            if components[0] > 9999 or any(part > 99 for part in components[1:]):
                raise ValueError('Stored Apple build exceeds component limits')
            builds.append(value)
    return {'schemaVersion': 1, 'complete': True, 'releases': releases,
            'qualifications': qualifications, 'builds': sorted(set(builds))}


def allocator_main():
    os.umask(0o077)
    validate_storage('')
    pending = ROOT / 'release-allocation-pending.json'
    temporary = pending.with_suffix('.tmp')

    def check_pending():
        for path in (pending, temporary):
            metadata = entry(path)
            if metadata is not None:
                require_regular(metadata)

    def read_intent():
        check_pending()
        return read_pending(pending) if entry(pending) is not None else None

    def reply(value):
        print(json.dumps(value), flush=True)

    with os.fdopen(open_regular(ROOT / 'release.lock', os.O_WRONLY | os.O_CREAT), 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        validate_storage('')
        check_pending()
        reply({'ready': True})
        for line in sys.stdin:
            request = json.loads(line)
            action = request['action']
            current = read_intent()
            if action in ('release-inspect', 'release-claim', 'release-complete'):
                reply(release_coordination(request))
            elif action in ('journal-append', 'journal-inspect', 'journal-inspect-family'):
                reply(notary_action(request))
            elif action == 'inventory':
                reply(allocator_inventory())
            elif action == 'pending':
                reply({'pending': current})
            elif action == 'assert-held':
                reply({'held': True})
            elif action == 'save':
                value = request['value']
                if not isinstance(value, dict) or current is not None:
                    raise ValueError('An unresolved allocation requires inspection')
                save(pending, value)
                reply({'saved': True})
            elif action == 'clear':
                if current is None or current != request['value']:
                    raise ValueError('Allocation intent differs')
                pending.unlink()
                sync_directory(ROOT)
                reply({'cleared': True})
            else:
                raise ValueError('Unknown allocator action')
