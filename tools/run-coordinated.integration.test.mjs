import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { dependencyLockPath } from "./test.mjs";

const helperSource = new URL("./run-coordinated.mjs", import.meta.url);
const supervisorSource = fileURLToPath(
  new URL("./worktree-supervisor.py", import.meta.url),
);

async function until(predicate) {
  const end = performance.now() + 15000;
  while (!predicate()) {
    assert.ok(performance.now() < end, "condition did not become true");
    await delay(25);
  }
}

function fixture(t, inspection = () => "") {
  const directory = mkdtempSync(join(tmpdir(), "situate-coordination-test-"));
  const helperPath = join(directory, "run-coordinated.mjs");
  copyFileSync(helperSource, helperPath);
  const helper = pathToFileURL(helperPath).href;
  writeFileSync(
    join(directory, "worktree-supervisor.py"),
    `import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("supervisor", ${JSON.stringify(supervisorSource)})
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)
${inspection(directory)}
try:
    sys.exit(supervisor.main(Path(${JSON.stringify(join(directory, "coordination"))})))
except Exception as error:
    print(str(error), file=sys.stderr)
    sys.exit(2)
`,
  );
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await child.done;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  function run(cwd, source, resource = "worktree", environment = {}) {
    const worker = join(directory, `worker-${children.length}.mjs`);
    writeFileSync(worker, source);
    const script = `import {runCoordinated} from ${JSON.stringify(helper)};
      process.exitCode = await runCoordinated({directory: ${JSON.stringify(cwd)}, resource: ${JSON.stringify(resource)}, command: process.execPath, args: [${JSON.stringify(worker)}], onTiming: event => console.log('TIMING:' + JSON.stringify(event))});`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...environment, NODE_TEST_CONTEXT: "" },
      },
    );
    child.output = "";
    child.stdout.on("data", (chunk) => (child.output += chunk));
    child.stderr.on("data", (chunk) => (child.output += chunk));
    child.done = new Promise((resolve) => {
      child.once("close", resolve);
    });
    children.push(child);
    return child;
  }
  return { directory, run, helper };
}

function gated(directory, name, extra = "") {
  return `import {existsSync, writeFileSync} from 'node:fs';
    ${extra}
    writeFileSync(${JSON.stringify(join(directory, name))}, String(process.pid));
    const timer = setInterval(() => {
      if (existsSync(${JSON.stringify(join(directory, `${name}-release`))})) clearInterval(timer);
    }, 10);`;
}

test("commands in one worktree wait while different worktrees proceed", async (t) => {
  const { directory, run } = fixture(t);
  const a = join(directory, "checkout with spaces");
  const b = join(directory, "other");
  mkdirSync(a);
  mkdirSync(b);
  const first = run(a, gated(directory, "first"), "worktree", { TMPDIR: a });
  await until(() => existsSync(join(directory, "first")));
  const second = run(a, gated(directory, "second"), "worktree", { TMPDIR: b });
  await until(() => second.output.includes("Waiting for the current worktree"));
  assert.equal(existsSync(join(directory, "second")), false);
  const independent = run(b, "console.log('independent');");
  assert.equal(await independent.done, 0, independent.output);
  assert.match(independent.output, /independent/);
  writeFileSync(join(directory, "first-release"), "");
  assert.equal(await first.done, 0, first.output);
  await until(() => existsSync(join(directory, "second")));
  writeFileSync(join(directory, "second-release"), "");
  assert.equal(await second.done, 0, second.output);
});

test("cancelling a queued command never starts it or interrupts its owner", async (t) => {
  const { directory, run } = fixture(t);
  const first = run(directory, gated(directory, "first"));
  await until(() => existsSync(join(directory, "first")));
  const waiter = run(directory, gated(directory, "waiter"));
  await until(() => waiter.output.includes("Waiting for the current worktree"));
  waiter.kill("SIGTERM");
  assert.equal(await waiter.done, 143, waiter.output);
  assert.equal(existsSync(join(directory, "waiter")), false);
  assert.equal(first.exitCode, null);
  writeFileSync(join(directory, "first-release"), "");
  assert.equal(await first.done, 0, first.output);
});

test("hard caller termination drains detached descendants and releases only owned dependency locks", async (t) => {
  const { directory, run } = fixture(t);
  const lock = dependencyLockPath(directory, ".");
  t.after(() => rmSync(lock, { recursive: true, force: true }));
  const first = run(
    directory,
    `
    import {spawn, execFileSync} from 'node:child_process';
    import {mkdirSync, writeFileSync} from 'node:fs';
    const listing = execFileSync('ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8'}).trim();
    mkdirSync(${JSON.stringify(lock)});
    writeFileSync(${JSON.stringify(join(lock, "owner.json"))},JSON.stringify({pid:process.pid,born:listing}));
    const child=spawn(process.execPath,['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
    writeFileSync(${JSON.stringify(join(directory, "descendant"))},String(child.pid));
    writeFileSync(${JSON.stringify(join(directory, "first"))},String(process.pid));
    setInterval(()=>{},1000);
  `,
  );
  await until(() => existsSync(join(directory, "descendant")));
  // The queue diagnostic also gives the supervisor time to observe the child.
  const next = run(directory, "console.log('next');");
  await until(() => next.output.includes("Waiting for the current worktree"));
  const pid = Number(readFileSync(join(directory, "descendant"), "utf8"));
  first.kill("SIGKILL");
  await first.done;
  assert.equal(await next.done, 0, next.output);
  assert.equal(existsSync(lock), false);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("desktop phases queue across worktrees without blocking worktree-only commands", async (t) => {
  const { directory, run } = fixture(t);
  const other = join(directory, "other");
  mkdirSync(other);
  const first = run(directory, gated(directory, "gui-one"), "desktop", {
    TMPDIR: directory,
  });
  await until(() => existsSync(join(directory, "gui-one")));
  const second = run(other, gated(directory, "gui-two"), "desktop", {
    TMPDIR: other,
  });
  await until(() => second.output.includes("Waiting for the current desktop"));
  const build = run(other, "console.log('build');");
  assert.equal(await build.done, 0, build.output);
  assert.equal(existsSync(join(directory, "gui-two")), false);
  writeFileSync(join(directory, "gui-one-release"), "");
  assert.equal(await first.done, 0, first.output);
  await until(() => existsSync(join(directory, "gui-two")));
  writeFileSync(join(directory, "gui-two-release"), "");
  assert.equal(await second.done, 0, second.output);
});

test("nested desktop leases remain held until cancellation drains their descendants", async (t) => {
  const { directory, run, helper } = fixture(t);
  const marker = join(directory, "nested.pid");
  const app = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`;
  const source = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(app)}],{detached:true,stdio:'ignore'}).unref();process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`;
  const owner = run(
    directory,
    `import {runCoordinated} from ${JSON.stringify(helper)};
    await runCoordinated({directory: ${JSON.stringify(directory)},resource:'desktop',command:process.execPath,args:['-e',${JSON.stringify(source)}]});`,
  );
  await until(
    () => existsSync(marker) && /^[1-9]\d*$/.test(readFileSync(marker, "utf8")),
  );
  const pid = Number(readFileSync(marker, "utf8"));
  const next = run(
    directory,
    `import {spawnSync} from 'node:child_process';
    const old=spawnSync('ps',['-p',${JSON.stringify(String(pid))},'-o','stat='],{encoding:'utf8'});
    if(old.status===0 && !old.stdout.trim().startsWith('Z')) throw new Error('desktop lease released before descendant exit');`,
    "desktop",
  );
  await until(() => next.output.includes("Waiting for the current desktop"));
  owner.kill("SIGKILL");
  await owner.done;
  assert.equal(await next.done, 0, next.output);
});

test("an initial process inspection failure preserves the running command and its lease", async (t) => {
  const { directory, run } = fixture(t);
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const marker = join(directory, "ps-failed");
  writeFileSync(
    join(bin, "ps"),
    `#!/bin/sh\nif [ ! -f '${marker}' ]; then touch '${marker}'; exit 1; fi\nexec /bin/ps "$@"\n`,
    { mode: 0o700 },
  );
  const result = run(directory, gated(directory, "healthy"), "worktree", {
    PATH: `${bin}:${process.env.PATH}`,
  });
  await until(
    () =>
      existsSync(marker) &&
      existsSync(join(directory, "healthy")) &&
      result.output.includes("preserving the running command"),
  );
  const next = run(directory, "console.log('after-recovery');");
  await until(() => next.output.includes("Waiting for the current worktree"));
  assert.equal(result.exitCode, null);
  process.kill(Number(readFileSync(join(directory, "healthy"), "utf8")), 0);
  writeFileSync(join(directory, "healthy-release"), "");
  assert.equal(await result.done, 0, result.output);
  assert.equal(await next.done, 0, next.output);
});

test("transient ownership timeouts never rerun or signal the healthy command", async (t) => {
  const { directory, run } = fixture(
    t,
    (root) => `
real_snapshot = supervisor.snapshot
attempts = 0
def transient_snapshot():
    global attempts
    attempts += 1
    if attempts <= 2:
        raise supervisor.subprocess.TimeoutExpired('ps', 10)
    result = real_snapshot()
    Path(${JSON.stringify(join(root, "observed"))}).touch()
    return result
supervisor.snapshot = transient_snapshot
`,
  );
  const starts = join(directory, "starts");
  const current = run(
    directory,
    gated(
      directory,
      "healthy",
      `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(starts)}, 'started\\n');`,
    ),
  );
  await until(
    () =>
      existsSync(join(directory, "observed")) &&
      existsSync(join(directory, "healthy")),
  );
  assert.equal(current.exitCode, null);
  assert.match(
    current.output,
    /preserving the running command and resource lease/,
  );
  assert.equal(readFileSync(starts, "utf8"), "started\n");
  process.kill(Number(readFileSync(join(directory, "healthy"), "utf8")), 0);
  writeFileSync(join(directory, "healthy-release"), "");
  assert.equal(await current.done, 0, current.output);
});

test("cancellation during unverified ownership retains the job and lease until inspection recovers", async (t) => {
  const { directory, run } = fixture(
    t,
    (root) => `
real_snapshot = supervisor.snapshot
def gated_snapshot():
    if Path(${JSON.stringify(join(root, "inspection-down"))}).exists():
        Path(${JSON.stringify(join(root, "inspection-failed"))}).touch()
        raise supervisor.subprocess.TimeoutExpired('ps', 10)
    result = real_snapshot()
    Path(${JSON.stringify(join(root, "observed"))}).touch()
    return result
supervisor.snapshot = gated_snapshot
`,
  );
  const outage = join(directory, "inspection-down");
  const current = run(directory, gated(directory, "healthy"));
  try {
    await until(
      () =>
        existsSync(join(directory, "healthy")) &&
        existsSync(join(directory, "observed")),
    );
    const pid = Number(readFileSync(join(directory, "healthy"), "utf8"));
    writeFileSync(outage, "");
    await until(() => existsSync(join(directory, "inspection-failed")));
    current.kill("SIGTERM");
    await until(() => current.output.includes("retaining the resource lease"));
    const queued = run(directory, "console.log('recovered');");
    await until(() =>
      queued.output.includes("Waiting for the current worktree"),
    );
    assert.equal(current.exitCode, null);
    assert.equal(queued.exitCode, null);
    process.kill(pid, 0);
    rmSync(outage);
    assert.equal(await current.done, 143, current.output);
    assert.equal(await queued.done, 0, queued.output);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    rmSync(outage, { force: true });
  }
});

for (const metadata of [
  undefined,
  {},
  [],
  { pid: process.pid, born: "unrelated" },
]) {
  test(`failed commands preserve their exit code and never reclaim unknown locks (${JSON.stringify(metadata)})`, async (t) => {
    const { directory, run } = fixture(t);
    const lock = dependencyLockPath(directory, ".");
    mkdirSync(lock);
    if (metadata)
      writeFileSync(join(lock, "owner.json"), JSON.stringify(metadata));
    t.after(() => rmSync(lock, { recursive: true, force: true }));
    const result = run(
      directory,
      "console.error('failed');process.exitCode=7;",
    );
    assert.equal(await result.done, 7, result.output);
    assert.match(result.output, /failed/);
    assert.equal(existsSync(lock), true);
    if (metadata)
      assert.equal(
        readFileSync(join(lock, "owner.json"), "utf8"),
        JSON.stringify(metadata),
      );
  });
}

test("nested working directories share the Git worktree lease", async (t) => {
  const { directory, run } = fixture(t);
  execFileSync("git", ["init", "-q", directory]);
  const nested = join(directory, "client");
  mkdirSync(nested);
  const first = run(directory, gated(directory, "root-owner"));
  await until(() => existsSync(join(directory, "root-owner")));
  const second = run(nested, "console.log('nested');");
  await until(() => second.output.includes("Waiting for the current worktree"));
  assert.equal(second.exitCode, null);
  writeFileSync(join(directory, "root-owner-release"), "");
  assert.equal(await first.done, 0, first.output);
  assert.equal(await second.done, 0, second.output);
});

test("coordination fixtures do not share build or desktop slots", async (t) => {
  const occupied = fixture(t);
  const independent = fixture(t);
  const owners = [
    occupied.run(
      occupied.directory,
      gated(occupied.directory, "build-one"),
      "build",
    ),
    occupied.run(
      occupied.directory,
      gated(occupied.directory, "build-two"),
      "build",
    ),
    occupied.run(
      occupied.directory,
      gated(occupied.directory, "desktop"),
      "desktop",
    ),
  ];
  await until(() =>
    ["build-one", "build-two", "desktop"].every((name) =>
      existsSync(join(occupied.directory, name)),
    ),
  );
  for (const resource of ["build", "desktop"]) {
    const child = independent.run(
      independent.directory,
      "console.log('independent');",
      resource,
    );
    await until(() => child.exitCode !== null);
    assert.equal(await child.done, 0, child.output);
    assert.match(child.output, /independent/);
  }
  assert.ok(owners.every((child) => child.exitCode === null));
  for (const name of ["build-one", "build-two", "desktop"])
    writeFileSync(join(occupied.directory, `${name}-release`), "");
  for (const child of owners) assert.equal(await child.done, 0, child.output);
});

test("only two heavy jobs run across worktrees and cancellation releases a slot", async (t) => {
  const { directory, run } = fixture(t);
  const first = run(directory, gated(directory, "heavy-one"), "build");
  const second = run(directory, gated(directory, "heavy-two"), "build");
  await until(
    () =>
      existsSync(join(directory, "heavy-one")) &&
      existsSync(join(directory, "heavy-two")),
  );
  const third = run(directory, "console.log('third');", "build");
  await until(() => third.output.includes("Waiting for the current build"));
  assert.equal(third.exitCode, null);
  first.kill("SIGTERM");
  assert.equal(await first.done, 143, first.output);
  assert.equal(await third.done, 0, third.output);
  const timings = third.output
    .split("\n")
    .filter((line) => line.startsWith("TIMING:"))
    .map((line) => JSON.parse(line.slice(7)));
  assert.deepEqual(
    timings.map(({ phase }) => phase),
    ["acquired", "released"],
  );
  assert.ok(timings[0].waitMs > 0);
  assert.ok(timings[1].runMs >= 0);
  writeFileSync(join(directory, "heavy-two-release"), "");
  assert.equal(await second.done, 0, second.output);
});
