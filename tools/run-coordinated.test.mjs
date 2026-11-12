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
