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
    original_unlink = Path.unlink
    def preserve_old(path, *args, **kwargs):
        if path == old:
            raise PermissionError('old acknowledgement retained')
        return original_unlink(path, *args, **kwargs)
    s.inspect_docker_container = lambda *args: None
    Path.unlink = preserve_old
    try:
        s.cleanup_docker_lease(lease)
    finally:
        Path.unlink = original_unlink
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
    for failure in ('queued', 'popen'):
        directory = root / failure
        directory.mkdir(mode=0o700)
        lease = directory / 'container.json'
        token = '11111111-1111-4111-8111-111111111111'
        lease.write_text(json.dumps({'name': 'situate-pipeline-' + token, 'token': token, 'creationPending': True}))
        lease.chmod(0o600)
        sys.argv = ['supervisor', 'worktree', str(root), '--docker-lease', str(lease), '/unstarted']
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

test("direct Python owners accept both Docker lease option positions and forward the path", () => {
  const source = `import importlib.util, json, sys, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(modulePath)})
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
s.caller_closed = lambda: False
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    for prefix in (True, False):
        lease_directory = root / ('lease-' + str(prefix))
        lease_directory.mkdir(mode=0o700)
        lease = lease_directory / 'container.json'
        marker = root / ('observed-' + str(prefix))
        command = [sys.executable, '-c', 'import os;from pathlib import Path;path=Path(os.environ["SITUATE_DOCKER_LEASE"]);assert not path.exists();Path(' + repr(str(marker)) + ').write_text(str(path))']
        option = ['--docker-lease', str(lease)]
        sys.argv = ['supervisor', *(option if prefix else []), 'worktree', str(root), *(option if not prefix else []), *command]
        assert s.main(root / 'coordination') == 0
        assert marker.read_text() == str(lease)
        assert not lease_directory.exists()
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
