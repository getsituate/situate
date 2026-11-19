"""Immutable private checkpoints, sharing the release host's storage and lock."""

MAX_FILES = 24
MAX_BYTES = 16 * 1024 * 1024 * 1024


def checkpoint_private(path, directory=False):
    metadata = path.lstat()
    if directory:
        require_directory(path)
    else:
        require_regular(metadata)
    if metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
        raise ValueError('Checkpoint storage must be owned and private')


def checkpoint_name(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]{0,127}', value):
        raise ValueError('Invalid checkpoint name')
    return value


def checkpoint_descriptor(value):
    if set(value) != {'schemaVersion', 'checkpointId', 'kind', 'identity', 'files'} or value['schemaVersion'] != 1:
        raise ValueError('Unsupported checkpoint descriptor')
    checkpoint_name(value['checkpointId'])
    if value['kind'] not in ('intent', 'build', 'runtime-authorization'):
        raise ValueError('Invalid checkpoint kind')
    identity = value['identity']
    if set(identity) != {'operationId', 'planDigest', 'sourceRevision'}:
        raise ValueError('Invalid checkpoint identity')
    checkpoint_name(identity['operationId'])
    for key, length in [('planDigest', 64), ('sourceRevision', 40)]:
        if not re.fullmatch('[a-f0-9]{' + str(length) + '}', identity[key]):
            raise ValueError('Invalid checkpoint binding')
    files = value['files']
    if not isinstance(files, list) or not 3 <= len(files) <= MAX_FILES:
        raise ValueError('Invalid checkpoint inventory')
    names = set()
    total = 0
    for item in files:
        if set(item) != {'name', 'size', 'sha256'}:
            raise ValueError('Invalid checkpoint file')
        name = checkpoint_name(item['name'])
        if name in names or name == 'descriptor.json':
            raise ValueError('Duplicate checkpoint file')
        names.add(name)
        if type(item['size']) is not int or not 0 <= item['size'] <= MAX_BYTES:
            raise ValueError('Invalid checkpoint size')
        total += item['size']
        if not re.fullmatch(r'[a-f0-9]{64}', item['sha256']):
            raise ValueError('Invalid checkpoint hash')
    if total > MAX_BYTES or not {'plan.json', 'configuration.json', 'operation.json'} <= names:
        raise ValueError('Incomplete or oversized checkpoint')
    return value


def checkpoint_read(path):
    checkpoint_private(path)
    with os.fdopen(open_regular(path, os.O_RDONLY), 'rb') as stream:
        data = stream.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise ValueError('Oversized checkpoint metadata')
    return json.loads(data)


def checkpoint_bindings(directory, descriptor):
    plan = checkpoint_read(directory / 'plan.json')
    operation = checkpoint_read(directory / 'operation.json')
    identity = descriptor['identity']
    if ({'operationId': plan.get('operation'), 'planDigest': plan.get('authorizationDigest'),
         'sourceRevision': plan.get('source')} != identity or operation.get('plan') != plan
            or operation.get('operationId') != identity['operationId']):
        raise ValueError('Checkpoint authorization identity differs')
    unsigned_plan = {key: value for key, value in plan.items() if key != 'authorizationDigest'}
    encoded_plan = json.dumps(unsigned_plan, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
    if plan.get('schemaVersion') != 1 or plan.get('workflow') != 'create' or hashlib.sha256(encoded_plan).hexdigest() != identity['planDigest']:
        raise ValueError('Checkpoint sealed plan digest differs')
    inventory = {item['name']: item for item in descriptor['files']}
    if inventory['configuration.json']['sha256'] != plan.get('configurationDigest'):
        raise ValueError('Checkpoint configuration digest differs')
    expected = {'plan.json', 'configuration.json', 'operation.json'}
    if descriptor['kind'] == 'runtime-authorization':
        expected.add('runtime-authorization.json')
        authorization = checkpoint_read(directory / 'runtime-authorization.json')
        unsigned = {key: value for key, value in authorization.items() if key != 'authorizationDigest'}
        encoded = json.dumps(unsigned, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
        if (authorization.get('schemaVersion') != 1 or authorization.get('kind') != 'qualification-runtime'
                or authorization.get('operationId') != identity['operationId']
                or authorization.get('planDigest') != identity['planDigest']
                or authorization.get('configurationDigest') != plan.get('configurationDigest')
                or authorization.get('authorizationDigest') != hashlib.sha256(encoded).hexdigest()):
            raise ValueError('Runtime authorization binding differs')
        originals = {'original-recovery-authorization.json', 'original-qualification-inspection.json'}
        if originals & set(inventory):
            expected.update(originals)
            recovery = checkpoint_read(directory / 'original-recovery-authorization.json')
            inspection = checkpoint_read(directory / 'original-qualification-inspection.json')
            observation = {key: value for key, value in inspection.items() if key != 'reconciliationDigest'}
            def canonical_hash(value):
                return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
            if (canonical_hash(recovery) != authorization.get('recoveryAuthorizationDigest')
                    or canonical_hash(observation) != inspection.get('reconciliationDigest')
                    or inspection.get('reconciliationDigest') != authorization.get('inspectionDigest')
                    or recovery.get('inspectionDigest') != authorization.get('inspectionDigest')
                    or recovery.get('planDigest') != identity['planDigest']
                    or recovery.get('operationId') != identity['operationId']):
                raise ValueError('Original qualification authorization inputs differ')
            if operation.get('qualificationAttempt', {}).get('status') == 'passed':
                expected.add('release-qualification.json')
                receipt = checkpoint_read(directory / 'release-qualification.json')
                if (receipt != operation['qualificationAttempt'].get('receipt', {}).get('receipt')
                        or receipt.get('sourceRevision') != identity['sourceRevision']
                        or receipt.get('manifestSha256') != authorization.get('manifestSha256')
                        or receipt.get('runtimeAuthorizationDigest') != authorization.get('authorizationDigest')):
                    raise ValueError('Passed qualification receipt differs')
    elif descriptor['kind'] == 'build':
        manifest = checkpoint_read(directory / 'manifest.json')
        predecessor = checkpoint_read(directory / 'predecessor-manifest.json')
        configuration = checkpoint_read(directory / 'configuration.json')
        reservation = operation.get('reservation', {})
        if (manifest.get('status') != 'complete' or manifest.get('revision') != identity['sourceRevision']
                or manifest.get('version') != reservation.get('version')
                or manifest.get('buildNumber') != reservation.get('buildNumber')
                or manifest.get('releaseInputs', {}).get('sha256') != reservation.get('generatedInputDigest')
                or predecessor != configuration.get('qualification', {}).get('predecessor', {}).get('manifest')):
            raise ValueError('Checkpoint final manifest binding differs')
        expected.update(('manifest.json', 'predecessor-manifest.json'))
        for prefix, value in [('', manifest), ('predecessor-', predecessor)]:
            artifacts = value.get('artifacts', [])
            if len(artifacts) != 1 or (not prefix and not artifacts[0].get('notarized')):
                raise ValueError('Checkpoint requires final notarized packages')
            artifact = artifacts[0]
            updater = artifact['updater']
            packages = [(artifact['path'], artifact['sha256']), (updater['path'], updater['sha256']),
                        (updater['signaturePath'], updater['signatureSha256'])]
            if not prefix:
                inputs = value['releaseInputs']
                if inputs['path'] != 'release-inputs.json' or inputs['catalogPath'] != 'situate-release-history.json':
                    raise ValueError('Checkpoint generated input names differ')
                packages.extend([(inputs['path'], inputs['sha256']), (inputs['catalogPath'], inputs['catalogSha256'])])
            for name, digest in packages:
                name = prefix + checkpoint_name(name)
                if name in expected or inventory.get(name, {}).get('sha256') != digest:
                    raise ValueError('Checkpoint package binding differs')
                expected.add(name)
    if set(inventory) != expected:
        raise ValueError('Unexpected checkpoint payload')


def checkpoint_verify(directory, descriptor):
    checkpoint_private(directory, True)
    if set(child.name for child in directory.iterdir()) != {'descriptor.json', *(item['name'] for item in descriptor['files'])}:
        raise ValueError('Checkpoint inventory differs')
    for item in descriptor['files']:
        path = directory / item['name']
        checkpoint_private(path)
        with os.fdopen(open_regular(path, os.O_RDONLY), 'rb') as stream:
            digest = hashlib.sha256()
            size = 0
            while block := stream.read(1024 * 1024):
                size += len(block)
                digest.update(block)
        if size != item['size'] or digest.hexdigest() != item['sha256']:
            raise ValueError('Checkpoint file changed')
    checkpoint_bindings(directory, descriptor)


def checkpoint_state(identity, directory):
    coordination = release_coordination({'action': 'release-inspect', **identity})
    notary = notary_action({'action': 'journal-inspect-family', 'operationId': identity['operationId']})
    # Validate every journal, including unrelated unknown notary work.
    latest = {}
    for record in notary_records():
        latest[record['operationId']] = record['entry']
    terminal = all(item.get('phase') == 'completion' and item.get('outcome') in ('success', 'failed') for item in latest.values())
    if any(record['entry'].get('phase') not in ('intent', 'submission', 'completion') for record in notary_records()):
        terminal = False
    pending = ROOT / 'release-pending.json'
    publication = checkpoint_read(pending) if entry(pending) is not None else None
    checkpoints = []
    entries = list(directory.iterdir())
    if len(entries) > 128:
        raise ValueError('Checkpoint inventory exceeds its bound')
    for child in sorted(entries):
        checkpoint_private(child, True)
        if child.name.startswith('.staging-'):
            continue
        descriptor = checkpoint_descriptor(checkpoint_read(child / 'descriptor.json'))
        if descriptor['identity'] != identity:
            raise ValueError('Checkpoint identity differs')
        checkpoint_verify(child, descriptor)
        checkpoints.append(descriptor)
    github_stages = []
    for descriptor in checkpoints:
        snapshot = checkpoint_read(directory / descriptor['checkpointId'] / 'operation.json')
        stages = [stage for stage in snapshot.get('stages', []) if stage.get('name') == 'github']
        if stages:
            github_stages.append({'stages': stages, 'journal': snapshot.get('publicationJournal')})
    draft_intent = None
    if len(github_stages) == 2:
        journals = [item['journal'] for item in github_stages if item['journal'] is not None]
        stages = [item['stages'] for item in github_stages]
        if (len(journals) == 1 and journals[0].get('state') == 'creating'
                and 'releaseId' not in journals[0] and stages[0] == stages[1]
                and len(stages[0]) == 1 and stages[0][0].get('status') == 'running'):
            draft_intent = {'journal': journals[0], 'stage': stages[0][0]}
    successful_notary = len(notary['operations']) >= 2
    for child in notary['operations']:
        records = child['records']
        if not records or records[0].get('phase') != 'intent' or records[-1].get('phase') != 'completion' or records[-1].get('outcome') != 'success':
            successful_notary = False
            continue
        first = records[0]
        payload = first.get('sha256', '')
        submissions = [record for record in records if record.get('phase') == 'submission']
        if (not re.fullmatch(r'[a-f0-9]{64}', payload)
                or child['operationId'] != identity['operationId'] + '-' + payload[:32]
                or first.get('parentOperationId') != identity['operationId']
                or not isinstance(first.get('file'), str)
                or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]{0,127}', first['file'])
                or len(submissions) != 1 or not re.fullmatch(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}', submissions[0].get('submissionId', ''))):
            successful_notary = False
            continue
        for record in records:
            if (any(record.get(key) != first.get(key) for key in ('sha256', 'file', 'parentOperationId'))
                    or (record['phase'] != 'intent' and record.get('submissionId') != submissions[0]['submissionId'])):
                successful_notary = False
    state = {'coordination': coordination, 'notarization': notary, 'terminalNotary': terminal and successful_notary,
             'publication': publication, 'unresolvedPublication': bool(github_stages), 'checkpoints': checkpoints}
    if draft_intent is not None:
        state['draftIntent'] = draft_intent
    state['inspectionDigest'] = hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()
    return state


def checkpoint_main():
    os.umask(0o077)
    request = json.loads(sys.stdin.buffer.readline(1024 * 1024))
    action = request['action']
    identity = request['identity']
    operation = checkpoint_name(identity['operationId'])
    validate_storage('')
    store = ROOT / 'release-checkpoints'
    store.mkdir(mode=0o700, exist_ok=True)
    checkpoint_private(store, True)
    directory = store / operation
    directory.mkdir(mode=0o700, exist_ok=True)
    checkpoint_private(directory, True)
    sync_directory(ROOT)
    sync_directory(store)
    if action == 'bootstrap':
        with os.fdopen(open_regular(ROOT / 'release.lock', os.O_WRONLY | os.O_CREAT), 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            candidates = []
            entries = list(directory.iterdir())
            if len(entries) > 128:
                raise ValueError('Checkpoint inventory exceeds its bound')
            for child in sorted(entries):
                checkpoint_private(child, True)
                if child.name.startswith('.staging-'):
                    continue
                descriptor = checkpoint_descriptor(checkpoint_read(child / 'descriptor.json'))
                checkpoint_verify(child, descriptor)
                candidates.append((child, descriptor))
            if not candidates or len({json.dumps(value['identity'], sort_keys=True) for _, value in candidates}) != 1:
                raise ValueError('No unique original checkpoint identity')
            selected, descriptor = next(((path, value) for path, value in candidates if value['kind'] == 'build'), candidates[0])
            if descriptor['identity']['operationId'] != operation:
                raise ValueError('Checkpoint operation differs')
            metadata = {}
            for name in ('plan.json', 'configuration.json', 'operation.json'):
                item = next(item for item in descriptor['files'] if item['name'] == name)
                if item['size'] > 256 * 1024:
                    raise ValueError('Oversized bootstrap metadata')
                with os.fdopen(open_regular(selected / name, os.O_RDONLY), 'rb') as stream:
                    metadata[name] = base64.b64encode(stream.read()).decode()
            print(json.dumps({'descriptor': descriptor, 'metadata': metadata}))
        return
    if action == 'stage':
        descriptor = checkpoint_descriptor(request['descriptor'])
        if descriptor['identity'] != identity:
            raise ValueError('Checkpoint identity differs')
        checkpoint = directory / descriptor['checkpointId']
        if entry(checkpoint) is not None:
            raise ValueError('Checkpoint exists; inspect instead of replaying')
        staging = directory / ('.staging-' + descriptor['checkpointId'])
        staging.mkdir(mode=0o700)
        with os.fdopen(open_regular(staging / 'descriptor.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'w') as stream:
            json.dump(descriptor, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        for item in descriptor['files']:
            with os.fdopen(open_regular(staging / item['name'], os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'wb') as stream:
                remaining = item['size']
                while remaining:
                    block = sys.stdin.buffer.read(min(remaining, 1024 * 1024))
                    if not block:
                        raise ValueError('Interrupted checkpoint upload; inspect storage')
                    stream.write(block)
                    remaining -= len(block)
                stream.flush()
                os.fsync(stream.fileno())
        if sys.stdin.buffer.read(1):
            raise ValueError('Unexpected checkpoint payload')
        checkpoint_verify(staging, descriptor)
        sync_directory(staging)
        with os.fdopen(open_regular(ROOT / 'release.lock', os.O_WRONLY | os.O_CREAT), 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            state = checkpoint_state(identity, directory)
            if request.get('inspectionDigest') is not None and (request['inspectionDigest'] != state['inspectionDigest']
                    or state['coordination']['active'] != identity or not state['terminalNotary']
                    or state['publication'] is not None or state['unresolvedPublication']):
                raise ValueError('Checkpoint intent requires exact fresh active inspection')
            if descriptor['kind'] != 'intent' and state['coordination']['active'] != identity:
                raise ValueError('Checkpoint requires the exact active claim')
            if descriptor['kind'] == 'runtime-authorization':
                authorization = checkpoint_read(staging / 'runtime-authorization.json')
                attempt = checkpoint_read(staging / 'operation.json').get('qualificationAttempt', {})
                nonce = checkpoint_name(authorization.get('routeNonce'))
                if attempt.get('authorizationDigest') != authorization.get('authorizationDigest'):
                    raise ValueError('Qualification attempt authorization differs')
                previous = []
                for value in state['checkpoints']:
                    if value['kind'] == 'runtime-authorization':
                        prior = checkpoint_read(directory / value['checkpointId'] / 'runtime-authorization.json')
                        if prior.get('routeNonce') == nonce:
                            if prior != authorization:
                                raise ValueError('Qualification nonce belongs to another authorization')
                            previous.append(checkpoint_read(directory / value['checkpointId'] / 'operation.json').get('qualificationAttempt', {}))
                status = attempt.get('status')
                if status == 'intent':
                    if (authorization.get('hostInspectionDigest') != state['inspectionDigest'] or not state['terminalNotary']
                            or state['publication'] is not None or state['unresolvedPublication']):
                        raise ValueError('Qualification requires fresh terminal external inspection')
                    builds = [value for value in state['checkpoints'] if value['kind'] == 'build']
                    if not any(any(item['name'] == 'manifest.json' and item['sha256'] == authorization.get('manifestSha256')
                                   for item in value['files']) for value in builds):
                        raise ValueError('Qualification authorization has no original build checkpoint')
                if (status not in ('intent', 'passed', 'unknown') or (status == 'intent' and previous)
                        or (status != 'intent' and (len(previous) != 1 or previous[0].get('status') != 'intent'))):
                    raise ValueError('Qualification attempt requires inspection; no replay')
            if entry(checkpoint) is not None:
                raise ValueError('Checkpoint already committed; inspect instead of replaying')
            os.rename(staging, checkpoint)
            sync_directory(directory)
        print(json.dumps({'durable': True, 'checkpointId': descriptor['checkpointId']}))
        return
    with os.fdopen(open_regular(ROOT / 'release.lock', os.O_WRONLY | os.O_CREAT), 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = checkpoint_state(identity, directory)
        if action == 'inspect':
            print(json.dumps(state))
            return
        if action not in ('restore', 'restore-qualified') or request.get('inspectionDigest') != state['inspectionDigest']:
            raise ValueError('Restore requires exact fresh inspection')
        draft_id = request.get('draftId')
        reconcile_draft = (action == 'restore-qualified' and type(draft_id) is int and draft_id > 0
                           and state.get('draftIntent') is not None)
        if (state['coordination']['active'] != identity or not state['terminalNotary'] or state['publication'] is not None
                or (state['unresolvedPublication'] and not reconcile_draft)):
            raise ValueError('Restore blocked by claim or unresolved external work')
        kind = 'build' if action == 'restore' else 'runtime-authorization'
        selected = [item for item in state['checkpoints'] if item['checkpointId'] == request['checkpointId'] and item['kind'] == kind]
        if len(selected) != 1:
            raise ValueError('Select one complete checkpoint')
        descriptor = selected[0]
        sources = {item['name']: directory / descriptor['checkpointId'] / item['name'] for item in descriptor['files']}
        if action == 'restore-qualified':
            selected_directory = directory / descriptor['checkpointId']
            snapshot = checkpoint_read(selected_directory / 'operation.json')
            if snapshot.get('qualificationAttempt', {}).get('status') != 'passed':
                raise ValueError('Selected qualification attempt is not passed')
            metadata = ['original-recovery-authorization.json', 'original-qualification-inspection.json', 'runtime-authorization.json', 'release-qualification.json']
            if not set(metadata) <= set(sources):
                raise ValueError('Original qualification inputs were not retained')
            attempts = {}
            for value in state['checkpoints']:
                if value['kind'] == 'runtime-authorization':
                    attempt_dir = directory / value['checkpointId']
                    attempt = checkpoint_read(attempt_dir / 'operation.json').get('qualificationAttempt', {})
                    nonce = checkpoint_read(attempt_dir / 'runtime-authorization.json')['routeNonce']
                    attempts.setdefault(nonce, set()).add(attempt.get('status'))
            selected_nonce = checkpoint_read(selected_directory / 'runtime-authorization.json')['routeNonce']
            if attempts.get(selected_nonce) != {'intent', 'passed'}:
                raise ValueError('Selected qualification does not have an exact intent and pass')
            incomplete = {nonce for nonce, statuses in attempts.items() if statuses != {'intent', 'passed'}}
            if incomplete:
                if any(attempts[nonce] not in ({'intent'}, {'intent', 'unknown'}) for nonce in incomplete):
                    raise ValueError('Qualification family contains invalid attempt history')
                family = qualification_listener['read_family'](identity['operationId'])['operations']
                cleaned = {member['operationNonce'] for member in family
                           if member['status'] in ('cleaned', 'cleaned-retained')
                           and member.get('uncertain', False) is False
                           and member['containerRunning'] is False}
                if len(cleaned) != len(family) or not incomplete <= cleaned:
                    raise ValueError('Unresolved private listeners block qualified restoration')
            recovery = checkpoint_read(selected_directory / 'original-recovery-authorization.json')
            build = recovery.get('descriptor')
            if not build or build.get('kind') != 'build' or build not in state['checkpoints']:
                raise ValueError('Original build checkpoint is unavailable or differs')
            original_operation = checkpoint_read(directory / build['checkpointId'] / 'operation.json')
            if {key: value for key, value in snapshot.items() if key != 'qualificationAttempt'} != original_operation:
                raise ValueError('Passed attempt changed original operation history')
            authorization = checkpoint_read(selected_directory / 'runtime-authorization.json')
            if not any(item['name'] == 'manifest.json' and item['sha256'] == authorization.get('manifestSha256') for item in build['files']):
                raise ValueError('Passed attempt manifest binding differs')
            inventory = {item['name']: item for item in descriptor['files']}
            files = [*build['files'], {**inventory['operation.json'], 'name': 'qualification-operation.json'}, *(inventory[name] for name in metadata)]
            if (len(files) > MAX_FILES or len({item['name'] for item in files}) != len(files)
                    or sum(item['size'] for item in files) > MAX_BYTES):
                raise ValueError('Qualified restore inventory differs')
            sources = {item['name']: directory / build['checkpointId'] / item['name'] for item in build['files']}
            sources['qualification-operation.json'] = selected_directory / 'operation.json'
            sources.update({name: selected_directory / name for name in metadata})
            descriptor = {'schemaVersion': 1, 'checkpointId': descriptor['checkpointId'], 'kind': 'qualified-restore',
                          'identity': identity, 'files': files, 'buildDescriptor': build, 'qualificationDescriptor': descriptor}
    # Committed payloads are immutable; transfers do not hold the release lock.
    print(json.dumps(descriptor), flush=True)
    for item in descriptor['files']:
        with os.fdopen(open_regular(sources[item['name']], os.O_RDONLY), 'rb') as stream:
            shutil.copyfileobj(stream, sys.stdout.buffer, 1024 * 1024)
    sys.stdout.buffer.flush()
