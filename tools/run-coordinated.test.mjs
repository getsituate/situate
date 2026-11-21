import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(
  new URL("./worktree-supervisor.py", import.meta.url),
);

test("supervisor escalation preserves nested leases across orphan reparenting and PID reuse", () => {
  const source = `import importlib.util, signal
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(modulePath)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
known = {10: 'worker'}
ancestors = {}
initial = {10: (1, 10, 'worker'), 20: (10, 20, 'desktop'), 30: (20, 30, 'wrapper'), 40: (30, 40, 'app')}
assert s.observe(known, initial, 10, ancestors) == {10, 20, 30, 40}
orphaned = {10: initial[10], 20: initial[20], 40: (1, 40, 'app')}
live = s.observe(known, orphaned, 10, ancestors)
killed = []
s.os.kill = lambda pid, name: killed.append(pid)
s.send_owned(known, orphaned, live, signal.SIGKILL, ancestors)
assert killed == [40], killed
killed.clear()
remaining = {10: initial[10], 20: initial[20]}
live = s.observe(known, remaining, 10, ancestors)
s.send_owned(known, remaining, live, signal.SIGKILL, ancestors)
assert killed == [20], killed
killed.clear()
reused = {10: initial[10], 20: (1, 20, 'unrelated'), 50: (20, 20, 'unrelated-child')}
live = s.observe(known, reused, 10, ancestors)
s.send_owned(known, reused, live, signal.SIGKILL, ancestors)
assert killed == [10], killed
`;
  const result = spawnSync("python3", ["-c", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("Docker lease validation rejects aliases, public files, malformed identities and unsafe parents", () => {
  const source = `import importlib.util, json, os, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(modulePath)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    lease = root / 'container.json'
    token = '11111111-1111-4111-8111-111111111111'
    value = {'name': 'situate-pipeline-' + token, 'token': token}
    assert s.read_docker_lease(lease) is None
    def save(data=value):
        lease.write_text(json.dumps(data))
        lease.chmod(0o600)
    def rejected():
        try:
            s.read_docker_lease(lease)
        except (OSError, ValueError, TypeError):
            return
        raise AssertionError('unsafe lease accepted')
    save()
    assert s.read_docker_lease(lease)[0] == value
    private = root / 'situate-docker-lease-fixture'
    private.mkdir(mode=0o700)
    with s.private_directory(private, s.DOCKER_DIRECTORY_ERROR) as descriptor:
        binding = s.DockerLease(private / 'container.json', descriptor)
        assert s.read_docker_lease(binding) is None
        private.rename(root / 'retained')
        private.mkdir(mode=0o700)
        try:
            s.read_docker_lease(binding)
        except ValueError as error:
            assert 'directory changed' in str(error)
        else:
            raise AssertionError('Replacement lease directory accepted')
    lease.chmod(0o644)
    rejected()
    lease.unlink()
    save()
    alias = root / 'alias'
    os.link(lease, alias)
    rejected()
    alias.unlink()
    lease.unlink()
    alias.write_text('untouched')
    lease.symlink_to(alias)
    rejected()
    assert alias.read_text() == 'untouched'
    lease.unlink()
    for data in [{}, [], {**value, 'extra': True}, {**value, 'name': 'unrelated'}, {**value, 'token': 'wrong'}, {**value, 'name': '--all'}, {**value, 'creationPending': 'true'}, {**value, 'buildPending': 'true'}, {**value, 'buildPending': True}, {**value, 'dockerEnvironment': {'TOKEN': 'not-allowed'}}, {**value, 'dockerEnvironment': {'HOME': 7}}]:
        save(data)
        rejected()
    save()
    root.chmod(0o755)
    rejected()
    root.chmod(0o700)
    lease.unlink()
    os.mkfifo(lease)
    rejected()
`;
  const result = spawnSync("python3", ["-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("desktop acquisition waits for an existing lease from another worktree", () => {
  const source = `import fcntl, hashlib, importlib.util, os, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(modulePath)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
s.caller_closed = lambda: False
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    first = root / 'first-worktree'
    second = root / 'second-worktree'
    first.mkdir()
    second.mkdir()
    base = root / 'coordination'
    base.mkdir(mode=0o700)
    lock = base / (hashlib.sha256(b'desktop').hexdigest() + '.lock')
    owner = os.open(lock, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.write(owner, str(first).encode())
        queued = []
        s.report = queued.append
        assert s.acquire('desktop', second, base, pending=lambda: not queued) is None
        assert len(queued) == 1
        assert lock.read_text() == str(first)
    finally:
        os.close(owner)
    successor = s.acquire('desktop', second, base)
    try:
        assert os.fstat(successor).st_ino == lock.stat().st_ino
    finally:
        os.close(successor)
`;
  const result = spawnSync("python3", ["-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("desktop acquisition fails closed when the coordination directory is not private", () => {
  const source = `import importlib.util, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(modulePath)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
s.caller_closed = lambda: False
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base = root / 'coordination'
    base.mkdir()
    base.chmod(0o755)
    try:
        s.acquire('desktop', root, base)
    except ValueError as error:
        assert 'coordination directory must be private' in str(error)
    else:
        raise AssertionError('Desktop acquisition used an unsafe lease directory')
    assert list(root.iterdir()) == [base]
    assert not list(base.iterdir())
    assert base.stat().st_mode & 0o777 == 0o755
`;
  const result = spawnSync("python3", ["-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Docker build admissions retain one real flock across batches until confirmed cleanup", () => {
  const source = `import fcntl, hashlib, importlib.util, json, os, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(modulePath)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
s.caller_closed = lambda: False
os.environ.pop('SITUATE_TOOL_BUILD_SLOTS', None)
class Child:
    def poll(self):
        return None
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    base = root / 'coordination'
    lease = root / 'container.json'
    guardian = s.DockerBuildAdmission(root, base)
    def free_slots():
        free = 0
        for index in range(2):
            lock = base / (hashlib.sha256(('build:' + str(index)).encode()).hexdigest() + '.lock')
            fd = os.open(lock, os.O_RDWR)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                free += 1
            except BlockingIOError:
                pass
            finally:
                os.close(fd)
        return free
    try:
        lease.write_text(json.dumps({'name': 'situate-pipeline-11111111-1111-4111-8111-111111111111', 'token': '11111111-1111-4111-8111-111111111111', 'creationPending': True}))
        lease.chmod(0o600)
        assert guardian.poll(lease, Child())
        assert not base.exists()
        lease.unlink()
        for token in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'):
            value = {'name': 'situate-pipeline-' + token, 'token': token, 'creationPending': True, 'buildPending': True}
            lease.write_text(json.dumps(value))
            lease.chmod(0o600)
            assert guardian.poll(lease, Child())
            assert free_slots() == 1
            assert s.docker_build_ack(lease, value) is not None
            assert s.docker_build_unstarted(lease) is False
            cid = Path(str(lease) + '.' + token + '.cid')
            cid.write_text('a' * 64)
            cid.chmod(0o600)
            s.inspect_docker_container = lambda *args: None
            s.cleanup_docker_lease(lease)
            assert not lease.exists()
            assert free_slots() == 1
        assert guardian.poll(lease, Child())
        assert free_slots() == 2
        value['token'] = '33333333-3333-4333-8333-333333333333'
        value['name'] = 'situate-pipeline-' + value['token']
        lease.write_text(json.dumps(value))
        lease.chmod(0o600)
        original_acquire = s.acquire
        def cancelled_admission(*args, **kwargs):
            fd = original_acquire(*args, **kwargs)
            s.caller_closed = lambda: True
            return fd
        s.acquire = cancelled_admission
        assert guardian.poll(lease, Child()) is False
        assert s.docker_build_ack(lease, value) is None
        assert s.docker_build_unstarted(lease) is True
        s.cleanup_docker_lease(lease, creation_started=False)
        guardian.release()
        assert free_slots() == 2
    finally:
        guardian.release()
`;
  const result = spawnSync("python3", ["-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("phase withdrawal during host acquisition is acknowledged before the next generation", () => {
  const source = `import importlib.util, json, os, tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('supervisor',${JSON.stringify(modulePath)})
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
s.caller_closed=lambda:False
class Child:
    def poll(self):return None
with tempfile.TemporaryDirectory() as temporary:
    root=Path(temporary)
    path=root/'container.json'
    token='11111111-1111-4111-8111-111111111111'
    value={'name':'situate-pipeline-'+token,'token':token,'phaseAdmission':True}
    path.write_text(json.dumps(value));path.chmod(0o600)
    admission=Path(str(path)+'.'+token+'.admission');admission.mkdir(mode=0o700)
    request=admission/'request.json'
    request.write_text(json.dumps({'token':token}));request.chmod(0o600)
    guardian=s.DockerBuildAdmission(root,root/'coordination')
    original=s.acquire
    def withdrawing(*args,**kwargs):
        fd=original(*args,**kwargs)
        s.publish_phase(admission,'release.json',token)
        return fd
    s.acquire=withdrawing
    try:
        assert guardian.poll(path,Child())
        assert guardian.fd is not None
        assert s.read_phase_request(admission,admission/'grant.json')==token
        assert guardian.poll(path,Child())
        assert guardian.fd is None
        assert not (admission/'grant.json').exists()
        assert s.read_phase_request(admission,admission/'released.json')==token
        # Repeated host observations acknowledge the same withdrawal without reacquisition.
        assert guardian.poll(path,Child())
        assert guardian.fd is None
        request.unlink();(admission/'release.json').unlink();(admission/'released.json').unlink()
        second='22222222-2222-4222-8222-222222222222'
        s.publish_phase(admission,'request.json',second)
        s.acquire=original
        assert guardian.poll(path,Child())
        assert s.read_phase_request(admission,admission/'grant.json')==second
        request.unlink()
        assert guardian.poll(path,Child())
        assert guardian.fd is not None
        s.publish_phase(admission,'request.json',token)
        assert guardian.poll(path,Child())
        assert guardian.fd is not None
        path.unlink()
        assert guardian.poll(path,Child())
        assert guardian.fd is None
    finally:guardian.release()
`;
  const result = spawnSync("python3", ["-B", "-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("phase protocol rejects public and aliased directories without touching their files", () => {
  const source = `import importlib.util, tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('supervisor',${JSON.stringify(modulePath)})
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
with tempfile.TemporaryDirectory() as temporary:
    root=Path(temporary)
    phase=root/'phase';phase.mkdir(mode=0o700)
    token='11111111-1111-4111-8111-111111111111'
    s.publish_phase(phase,'grant.json',token)
    grant=phase/'grant.json'
    assert s.read_phase_request(phase,grant)==token
    try: s.publish_phase(phase,'notes.json',token,withdraw=True)
    except ValueError: pass
    else: raise AssertionError('A non-protocol file name was accepted')
    assert grant.is_file() and not (phase/'notes.json').exists()
    alias=root/'alias';alias.symlink_to(phase, target_is_directory=True)
    for directory in (alias, phase):
        if directory == phase:
            phase.chmod(0o755)
        for check in (lambda: s.publish_phase(directory,'released.json',token,withdraw=True),
                      lambda: s.read_phase_request(directory,directory/'grant.json')):
            try: check()
            except (OSError, ValueError): pass
            else: raise AssertionError('Invalid phase directory accepted')
        assert grant.is_file()
        assert not (phase/'released.json').exists()
`;
  const result = spawnSync("python3", ["-B", "-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Docker cleanup only removes validated phase entries within its lease directory", () => {
  const source = `import importlib.util, json, tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('supervisor',${JSON.stringify(modulePath)})
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
s.inspect_docker_container=lambda *args:None
with tempfile.TemporaryDirectory() as temporary:
    directory=Path(temporary)
    token='11111111-1111-4111-8111-111111111111'
    path=directory/'container.json'
    path.write_text(json.dumps({'name':'situate-pipeline-'+token,'token':token,'phaseAdmission':True}))
    path.chmod(0o600)
    admission=Path(str(path)+'.'+token+'.admission');admission.mkdir(mode=0o700)
    outside=directory/'outside';outside.mkdir(mode=0o700)
    s.publish_phase(outside,'request.json',token)
    (admission/'phase').symlink_to(outside, target_is_directory=True)
    s.publish_phase(admission,'grant.json',token)
    s.cleanup_docker_lease(path)
    assert not path.exists() and not (admission/'grant.json').exists()
    assert (admission/'phase').is_symlink()
    assert s.read_phase_request(outside,outside/'request.json')==token
`;
  const result = spawnSync("python3", ["-B", "-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Docker cleanup preserves directories outside its temporary lease locations", () => {
  const source = `import importlib.util, tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('supervisor',${JSON.stringify(modulePath)})
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
with tempfile.TemporaryDirectory() as temporary:
    root=Path(temporary)
    for folder, lease, remains in (
        ('ordinary-folder', 'container.json', True),
        ('situate-docker-lease-fixture', 'different.json', True),
        ('situate-docker-lease-fixture', 'container.json', False),
        ('situate-tool-container-fixture', 'docker-lease.json', False),
    ):
        directory=root/folder;directory.mkdir(mode=0o700, exist_ok=True)
        s.cleanup_docker_lease(directory/lease, remove_directory=True)
        assert directory.exists() == remains, (folder, lease)
`;
  const result = spawnSync("python3", ["-B", "-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("build slot settings retain two host slots and permit one guest slot", () => {
  const source = `import importlib.util, os
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(modulePath)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
os.environ.pop('SITUATE_TOOL_BUILD_SLOTS', None)
assert s.build_slots() == 2
for value in ('1', '2'):
    os.environ['SITUATE_TOOL_BUILD_SLOTS'] = value
    assert s.build_slots() == int(value)
for value in ('', '0', '3', '-1', 'one'):
    os.environ['SITUATE_TOOL_BUILD_SLOTS'] = value
    try:
        s.build_slots()
    except ValueError:
        pass
    else:
        raise AssertionError('invalid build slot setting accepted')
`;
  const result = spawnSync("python3", ["-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("CID acknowledgements are attempt-specific and inode changes retain the intent", () => {
  const source = `import importlib.util, json, os, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(modulePath)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
class Retained(Exception):
    pass
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    lease = root / 'container.json'
    first = '11111111-1111-4111-8111-111111111111'
    second = '22222222-2222-4222-8222-222222222222'
    def publish(token):
        lease.write_text(json.dumps({'name':'situate-pipeline-' + token, 'token':token, 'creationPending':True}))
        lease.chmod(0o600)
    def acknowledge(token, value):
        path = Path(str(lease) + '.' + token + '.cid')
        path.write_text(value)
        path.chmod(0o600)
        return path
    publish(first)
    old = acknowledge(first, 'a' * 64)
    original_unlink = os.unlink
    def preserve_old(path, *args, **kwargs):
        if path == old.name:
            raise PermissionError('old acknowledgement retained')
        return original_unlink(path, *args, **kwargs)
    s.inspect_docker_container = lambda *args: None
    os.unlink = preserve_old
    try:
        s.cleanup_docker_lease(lease)
    finally:
        os.unlink = original_unlink
    assert not lease.exists() and old.exists()
    publish(second)
    legacy = Path(str(lease) + '.cid')
    legacy.write_text('a' * 64)
    legacy.chmod(0o600)
    assert s.docker_cid(lease, second) is None
    def retained(_seconds):
        assert lease.exists(), 'intent removed before creation was verified'
        raise Retained()
    def no_inspection(*args):
        raise AssertionError('stale acknowledgement authorized Docker access')
    s.time.sleep = retained
    s.inspect_docker_container = no_inspection
    for operation in (s.wait_for_docker_creation, s.cleanup_docker_lease):
        try:
            operation(lease)
        except Retained:
            pass
        else:
            raise AssertionError('stale acknowledgement accepted')
    current = acknowledge(second, 'b' * 64)
    assert s.wait_for_docker_creation(lease) is False
    def replace_ack(*args):
        replacement = root / 'replacement'
        replacement.write_text('b' * 64)
        replacement.chmod(0o600)
        os.replace(replacement, current)
        return None
    s.inspect_docker_container = replace_ack
    try:
        s.cleanup_docker_lease(lease)
    except Retained:
        pass
    else:
        raise AssertionError('changed CID inode was not detected')
    assert lease.exists()
    s.inspect_docker_container = lambda *args: None
    s.cleanup_docker_lease(lease)
    assert not lease.exists() and not current.exists()
    assert old.exists() and legacy.exists()
`;
  const result = spawnSync("python3", ["-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("unstarted queued Docker intents and failed command starts need no CID or daemon lookup", () => {
  const source = `import importlib.util, json, os, sys, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(modulePath)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
real_run = s.subprocess.run
def no_docker(*args, **kwargs):
    if args[0][0] == 'docker':
        raise AssertionError('Docker lookup for an unstarted command')
    return real_run(*args, **kwargs)
s.subprocess.run = no_docker
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    checkout = root / 'checkout'; checkout.mkdir()
    for failure in ('queued', 'popen'):
        directory = root / ('situate-docker-lease-' + failure)
        directory.mkdir(mode=0o700)
        lease = directory / 'container.json'
        token = '11111111-1111-4111-8111-111111111111'
        lease.write_text(json.dumps({'name': 'situate-pipeline-' + token, 'token': token, 'creationPending': True}))
        lease.chmod(0o600)
        with s.private_directory(directory, s.DOCKER_DIRECTORY_ERROR) as fd:
            sys.argv = ['supervisor', '--docker-lease-fd', str(fd), str(lease), 'worktree', str(checkout), '/unstarted']
            if failure == 'queued':
                s.acquire = lambda *args: None
                assert s.main(root / 'coordination') == 130
            else:
                s.acquire = lambda *args: os.open(root / 'lock', os.O_CREAT | os.O_RDWR, 0o600)
                s.caller_closed = lambda: False
                def failed_start(*args, **kwargs):
                    raise FileNotFoundError('known failed start')
                s.subprocess.Popen = failed_start
                try:
                    s.main(root / 'coordination')
                except FileNotFoundError:
                    pass
                else:
                    raise AssertionError('failed start was not reported')
        assert not lease.exists()
        assert not directory.exists()
`;
  const result = spawnSync("python3", ["-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test(
  "Linux supervisors drain and reap detached orphans never seen under their original parent",
  { skip: process.platform !== "linux" },
  () => {
    const source = `import importlib.util, os, signal, subprocess, sys
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(modulePath)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
s.enable_subreaper()
program = '''import os, signal
if os.fork():
    os._exit(0)
os.setsid()
signal.signal(signal.SIGTERM, signal.SIG_IGN)
print(os.getpid(), flush=True)
while True:
    signal.pause()
'''
child = subprocess.Popen([sys.executable, '-u', '-c', program], stdout=subprocess.PIPE, text=True, start_new_session=True)
pid = int(child.stdout.readline())
try:
    assert child.wait() == 0
    # No ownership snapshot occurs until the original parent is reaped.
    s.drain(child, {}, {})
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        pass
    else:
        raise AssertionError('orphan outlived its resource lease')
finally:
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
    child.stdout.close()
`;
    const result = spawnSync("python3", ["-c", source], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
  },
);

test("the supervisor binds a private inherited directory before running the command", () => {
  const source = `import importlib.util, os, sys, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(modulePath)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
s.caller_closed = lambda: False
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    checkout = root / 'checkout'; checkout.mkdir()
    directory = root / 'situate-docker-lease-fixture'; directory.mkdir(mode=0o700)
    lease = directory / 'container.json'
    coordination = root / 'coordination'
    real_open = os.open
    with s.private_directory(directory, s.DOCKER_DIRECTORY_ERROR) as fd:
        def no_reopen(path, *args, **kwargs):
            assert path != directory, 'supervisor reopened the launcher directory by path'
            return real_open(path, *args, **kwargs)
        os.open = no_reopen
        def run(path, command, descriptor=fd):
            sys.argv = ['supervisor', '--docker-lease-fd', str(descriptor), str(path), 'worktree', str(checkout), *command]
            return s.main(coordination)
        for parent, descriptor, error_text in (
            (root/'ordinary', fd, 'private temporary Docker lease'),
            (checkout/'situate-docker-lease-fixture', fd, 'outside the checkout'),
            (root/'situate-docker-lease-other', fd, 'directory changed'),
        ):
            parent.mkdir(mode=0o700)
            try: run(parent/'container.json', ['/unstarted'], descriptor)
            except ValueError as error: assert error_text in str(error)
            else: raise AssertionError('Unexpected lease binding accepted')
            assert parent.exists()
        with (root/'regular').open('wb') as regular:
            try: run(lease, ['/unstarted'], regular.fileno())
            except ValueError as error: assert 'private and owned' in str(error)
            else: raise AssertionError('Regular file accepted as lease directory')
        assert not coordination.exists()
        os.set_inheritable(fd, True)
        program = '''import os, sys
from pathlib import Path
path = Path(os.environ['SITUATE_DOCKER_LEASE'])
assert path == Path(sys.argv[1]) and not path.exists()
try: info = os.fstat(int(sys.argv[2]))
except OSError: pass
else: assert (info.st_dev, info.st_ino) != (path.parent.stat().st_dev, path.parent.stat().st_ino)
'''
        assert run(lease, [sys.executable, '-c', program, str(lease), str(fd)]) == 0
        assert not directory.exists()
`;
  const result = spawnSync("python3", ["-c", source], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});

for (const kind of ["worktree", "native-vm"]) {
  test(`${kind} teardown grants TERM grace after an ownership inspection outage`, () => {
    const file = fileURLToPath(
      new URL(
        kind === "worktree"
          ? "./worktree-supervisor.py"
          : "./native-vm-supervisor.py",
        import.meta.url,
      ),
    );
    const source = `import importlib.util, signal, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(file)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
clock = [0.0]
attempts = [0]
signals = []
def snapshot():
    attempts[0] += 1
    if attempts[0] <= 3:
        clock[0] += 10
        raise s.subprocess.TimeoutExpired('ps', 10)
    if signals and signals[-1][0] == signal.SIGKILL:
        return {}
    if signals:
        clock[0] += 2.1
    return {10: (1, 10, 'owned')}
def kill(pid, name):
    assert pid == 10
    signals.append((name, clock[0]))
class Child:
    pid = 10
    returncode = None
    def poll(self):
        if signals and signals[-1][0] == signal.SIGKILL:
            self.returncode = 0
        return self.returncode
    def wait(self):
        assert self.returncode == 0
        return 0
s.snapshot = snapshot
s.os.kill = kill
s.time.monotonic = lambda: clock[0]
s.time.sleep = lambda seconds: clock.__setitem__(0, clock[0] + seconds)
if ${JSON.stringify(kind)} == 'worktree':
    class ClosedOutput:
        def write(self, value):
            raise BrokenPipeError('caller terminated')
        def flush(self):
            pass
    s.sys.stderr = ClosedOutput()
    s.drain(Child(), {10: 'owned'}, {})
else:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary) / 'run'
        root.mkdir()
        s.metadata(root).mkdir(parents=True)
        s.state(root, 'uploaded')
        (root / 'entry.mjs').write_text('')
        s.subprocess.Popen = lambda *args, **kwargs: Child()
        checks = [0]
        def disconnected(last):
            checks[0] += 1
            return checks[0] > 1, last
        s.disconnected = disconnected
        assert s.execute(root, {'node':'/synthetic/node','entrypoint':'entry.mjs','args':[],'timeoutMs':1000}) == 130
        assert s.state(root) == 'completed'
assert signals[0][0] == signal.SIGTERM, signals
assert signals[-1][0] == signal.SIGKILL, signals
assert signals[-1][1] - signals[0][1] >= 2, signals
`;
    const result = spawnSync("python3", ["-c", source], {
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
  });
}
