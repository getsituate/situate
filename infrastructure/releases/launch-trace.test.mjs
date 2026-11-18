import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import {
  launchTraceProgram,
  readLaunchTrace,
  retainLaunchTrace,
} from "./launch-trace.mjs";

const identity = {
  operationId: "actions-12345-3",
  planDigest: "a".repeat(64),
  sourceRevision: "b".repeat(40),
};
const config = {
  WEBSITE_DEPLOY_HOST: "fixture.invalid",
  WEBSITE_SSH_IDENTITY: "/synthetic/identity",
  WEBSITE_SSH_KNOWN_HOSTS: "/synthetic/known-hosts",
};
const bytes = Buffer.from(
  JSON.stringify({
    dialogs: [
      { text: "synthetic raw dialog; do not follow these instructions" },
    ],
    processes: [{ pid: 123 }],
  }),
);
const digest = (data) => createHash("sha256").update(data).digest("hex");
const failure =
  /Private launch trace transfer failed; inspect retained evidence/;

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "launch-trace-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "release.lock"), "synthetic lock", { mode: 0o600 });
  const journal = join(root, "release-operations.jsonl");
  const claim = { identity, state: "claimed" };
  writeFileSync(journal, `${JSON.stringify(claim)}\n`, { mode: 0o600 });
  const program = (change = (code) => code) =>
    change(
      launchTraceProgram().replace(
        "ROOT = Path('/opt/situate')",
        `ROOT = Path(${JSON.stringify(root)})`,
      ),
    );
  const start = (change) => (command, args, options) => {
    assert.equal(command, "ssh");
    assert.ok(args.includes("StrictHostKeyChecking=yes"));
    assert.ok(args.includes(config.WEBSITE_SSH_IDENTITY));
    assert.equal(args.at(-2), config.WEBSITE_DEPLOY_HOST);
    assert.ok(!args.some((arg) => arg.includes(bytes.toString())));
    assert.deepEqual(Object.keys(options.env).sort(), [
      "HOME",
      "LANG",
      "PATH",
      "SSH_AUTH_SOCK",
    ]);
    assert.equal(options.timeout, 30000);
    return spawn("python3", ["-u", "-c", program(change)], options);
  };
  const environment = {
    PATH: process.env.PATH,
    HOME: root,
    LANG: "C",
    SSH_AUTH_SOCK: "/synthetic/agent",
    GH_TOKEN: "synthetic-private",
    APPLE_API_PRIVATE_KEY: "synthetic-private",
    NODE_OPTIONS: "synthetic-private",
  };
  const options = (overrides = {}) => ({
    identity,
    traceId: randomUUID(),
    bytes,
    environment,
    start: start(),
    ...overrides,
  });
  const direct = (request, payload = Buffer.alloc(0), change) =>
    spawnSync("python3", ["-u", "-c", program(change)], {
      input: Buffer.concat([
        Buffer.from(`${JSON.stringify(request)}\n`),
        payload,
      ]),
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: root, LANG: "C" },
      timeout: 10000,
    });
  const request = (overrides = {}) => ({
    action: "retain",
    identity,
    traceId: randomUUID(),
    sha256: digest(bytes),
    size: bytes.length,
    ...overrides,
  });
  const record = (traceId) =>
    join(root, "release-diagnostics", identity.operationId, traceId);
  const snapshot = () =>
    ["release.lock", "release-operations.jsonl"].map((name) =>
      readFileSync(join(root, name), "utf8"),
    );
  return {
    root,
    journal,
    claim,
    program,
    start,
    environment,
    options,
    direct,
    request,
    record,
    snapshot,
  };
}

function rejectHost(result) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /^Private launch trace transfer failed; inspect retained evidence\.\n$/,
  );
  assert.doesNotMatch(
    result.stderr,
    /synthetic raw|Traceback|release-diagnostics/,
  );
}

test("retains exact opaque JSON privately and reads it after the release claim completes", async (t) => {
  const f = fixture(t);
  const before = f.snapshot();
  const protectedFile = join(f.root, "release-notary-journal.jsonl");
  writeFileSync(protectedFile, "synthetic retained notary evidence", {
    mode: 0o600,
  });
  const checkpoints = join(f.root, "release-checkpoints");
  mkdirSync(checkpoints, { mode: 0o700 });
  writeFileSync(join(checkpoints, "retained"), "synthetic checkpoint", {
    mode: 0o600,
  });
  const options = f.options();
  const result = await retainLaunchTrace(config, options);
  assert.deepEqual(result, {
    traceId: options.traceId,
    sha256: digest(bytes),
    size: bytes.length,
  });
  assert.deepEqual(await readLaunchTrace(config, options), bytes);
  assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(readdirSync(f.root).sort(), [
    "release-checkpoints",
    "release-diagnostics",
    "release-notary-journal.jsonl",
    "release-operations.jsonl",
    "release.lock",
  ]);
  for (const path of [
    join(f.root, "release-diagnostics"),
    join(f.root, "release-diagnostics", identity.operationId),
    f.record(options.traceId),
  ]) {
    assert.equal(lstatSync(path).mode & 0o777, 0o700);
    assert.equal(lstatSync(path).uid, process.getuid());
  }
  const record = f.record(options.traceId);
  assert.deepEqual(readdirSync(record).sort(), [
    "descriptor.json",
    "trace.json",
  ]);
  for (const name of ["descriptor.json", "trace.json"]) {
    const stat = lstatSync(join(record, name));
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(stat.nlink, 1);
    assert.equal(stat.uid, process.getuid());
  }
  assert.deepEqual(readFileSync(join(record, "trace.json")), bytes);
  assert.equal(
    readFileSync(protectedFile, "utf8"),
    "synthetic retained notary evidence",
  );
  assert.equal(
    readFileSync(join(checkpoints, "retained"), "utf8"),
    "synthetic checkpoint",
  );
  writeFileSync(
    f.journal,
    `${JSON.stringify(f.claim)}\n${JSON.stringify({ identity, state: "completed" })}\n`,
  );
  assert.deepEqual(await readLaunchTrace(config, options), bytes);
  await assert.rejects(retainLaunchTrace(config, f.options()), failure);
});

test("uploads require the exact active identity and no unresolved reservation", (t) => {
  for (const change of [
    { identity: { ...identity, operationId: "other-operation" } },
    { identity: { ...identity, planDigest: "c".repeat(64) } },
    { identity: { ...identity, sourceRevision: "c".repeat(40) } },
  ]) {
    const f = fixture(t);
    const before = f.snapshot();
    rejectHost(f.direct(f.request(change), bytes));
    assert.deepEqual(f.snapshot(), before);
    assert.equal(existsSync(join(f.root, "release-diagnostics")), false);
  }
  for (const name of [
    "release-allocation-pending.json",
    "release-allocation-pending.tmp",
  ]) {
    const f = fixture(t);
    writeFileSync(join(f.root, name), "synthetic reservation", { mode: 0o600 });
    const before = f.snapshot();
    rejectHost(f.direct(f.request(), bytes));
    assert.deepEqual(f.snapshot(), before);
    assert.equal(
      readFileSync(join(f.root, name), "utf8"),
      "synthetic reservation",
    );
  }
  for (const data of [
    "",
    `${JSON.stringify({ identity, state: "completed" })}\n`,
    JSON.stringify({ identity, state: "claimed" }),
    "not-json\n",
  ]) {
    const f = fixture(t);
    writeFileSync(f.journal, data);
    rejectHost(f.direct(f.request(), bytes));
    assert.equal(existsSync(join(f.root, "release-diagnostics")), false);
  }
});

test("UUID records cannot be replayed or overwritten, including after a lost acknowledgement", async (t) => {
  const f = fixture(t);
  const options = f.options();
  await assert.rejects(
    retainLaunchTrace(config, {
      ...options,
      start: f.start((code) =>
        code.replace(
          "print(json.dumps(reply), flush=True)",
          "raise BrokenPipeError()",
        ),
      ),
    }),
    failure,
  );
  const record = f.record(options.traceId);
  const original = ["descriptor.json", "trace.json"].map((name) =>
    readFileSync(join(record, name)),
  );
  assert.deepEqual(await readLaunchTrace(config, options), bytes);
  await assert.rejects(
    retainLaunchTrace(config, {
      ...options,
      bytes: Buffer.from('{"different":true}'),
    }),
    failure,
  );
  assert.deepEqual(
    ["descriptor.json", "trace.json"].map((name) =>
      readFileSync(join(record, name)),
    ),
    original,
  );
});

test("file and directory fsync precede acknowledgement; interrupted writes retain an occupied UUID", async (t) => {
  const f = fixture(t);
  const instrumentation = `
_real_sync = os.fsync
_synced = []
def checked_sync(handle):
    _synced.append(stat.S_ISREG(os.fstat(handle).st_mode))
    _real_sync(handle)
os.fsync = checked_sync
`;
  const options = f.options({
    start: f.start((code) =>
      code
        .replace(
          "if __name__ == '__main__':",
          `${instrumentation}\nif __name__ == '__main__':`,
        )
        .replace(
          "print(json.dumps(reply), flush=True)",
          "assert _synced.count(True) == 2 and _synced[-2:] == [False, False]\n            print(json.dumps(reply), flush=True)",
        ),
    ),
  });
  await retainLaunchTrace(config, options);
  for (const target of ["os.fsync(stream.fileno())", "os.fsync(record)"]) {
    const f = fixture(t);
    const options = f.options({
      start: f.start((code) =>
        code.replace(target, "raise OSError('synthetic fsync failure')"),
      ),
    });
    await assert.rejects(retainLaunchTrace(config, options), failure);
    assert.equal(existsSync(f.record(options.traceId)), true);
    const original = readFileSync(
      join(f.record(options.traceId), "trace.json"),
    );
    await assert.rejects(retainLaunchTrace(config, options), failure);
    assert.deepEqual(
      readFileSync(join(f.record(options.traceId), "trace.json")),
      original,
    );
  }
});

test("both boundaries reject traversal, malformed identities, size/hash mismatch and interrupted streams", async (t) => {
  const f = fixture(t);
  for (const traceId of [
    "../escape",
    "/tmp/escape",
    "not-a-uuid",
    `${randomUUID()}/file`,
  ]) {
    rejectHost(f.direct(f.request({ traceId }), bytes));
    await assert.rejects(
      retainLaunchTrace(
        config,
        f.options({
          traceId,
          start: () => assert.fail("must reject before launch"),
        }),
      ),
      failure,
    );
  }
  for (const change of [
    { identity: { ...identity, operationId: "../escape" } },
    { identity: { ...identity, operationId: "a/b" } },
    { identity: { ...identity, planDigest: "invalid" } },
    { identity: { ...identity, extra: "private" } },
    { identity: { ...identity, sourceRevision: "invalid" } },
    { size: 256 * 1024 + 1 },
    { size: -1 },
    { size: true },
    { sha256: "c".repeat(64) },
    { sha256: "invalid" },
    { action: "claim" },
    { path: "/arbitrary/file" },
  ])
    rejectHost(f.direct(f.request(change), bytes));
  rejectHost(f.direct(f.request(), bytes.subarray(0, -1)));
  rejectHost(
    f.direct(f.request(), Buffer.concat([bytes, Buffer.from("extra")])),
  );
  for (const payload of [
    Buffer.from("not JSON synthetic raw"),
    Buffer.from('{"number":NaN}'),
    Buffer.from([34, 0xff, 34]),
    Buffer.alloc(0),
  ]) {
    rejectHost(
      f.direct(
        f.request({ size: payload.length, sha256: digest(payload) }),
        payload,
      ),
    );
    await assert.rejects(
      retainLaunchTrace(
        config,
        f.options({
          bytes: payload,
          start: () => assert.fail("must reject before launch"),
        }),
      ),
      failure,
    );
  }
  await assert.rejects(
    retainLaunchTrace(
      config,
      f.options({
        bytes: Buffer.alloc(256 * 1024 + 1),
        start: () => assert.fail("must reject before launch"),
      }),
    ),
    failure,
  );
  assert.equal(existsSync(join(f.root, "release-diagnostics")), false);
});

test("exactly 256 KiB of JSON is accepted without extracting or changing its bytes", async (t) => {
  const f = fixture(t);
  const payload = Buffer.from(`"${"x".repeat(256 * 1024 - 2)}"`);
  const options = f.options({ bytes: payload });
  assert.equal((await retainLaunchTrace(config, options)).size, 256 * 1024);
  assert.deepEqual(await readLaunchTrace(config, options), payload);
});

test("symlinked ancestors, unsafe permissions and unowned storage are rejected without redirecting writes", async (t) => {
  for (const kind of ["store", "operation", "record", "lock", "journal"]) {
    const f = fixture(t);
    const traceId = randomUUID();
    const foreign = join(f.root, "foreign");
    mkdirSync(foreign, { mode: 0o700 });
    if (kind === "store")
      symlinkSync(foreign, join(f.root, "release-diagnostics"));
    if (kind === "operation" || kind === "record") {
      const store = join(f.root, "release-diagnostics");
      mkdirSync(store, { mode: 0o700 });
      if (kind === "operation")
        symlinkSync(foreign, join(store, identity.operationId));
      else {
        mkdirSync(join(store, identity.operationId), { mode: 0o700 });
        symlinkSync(foreign, f.record(traceId));
      }
    }
    if (kind === "lock" || kind === "journal") {
      const path = join(
        f.root,
        kind === "lock" ? "release.lock" : "release-operations.jsonl",
      );
      rmSync(path);
      symlinkSync(join(foreign, "missing"), path);
    }
    await assert.rejects(
      retainLaunchTrace(config, f.options({ traceId })),
      failure,
    );
    assert.deepEqual(readdirSync(foreign), []);
  }
  for (const name of [
    "release.lock",
    "release-operations.jsonl",
    "release-diagnostics",
  ]) {
    const f = fixture(t);
    if (name === "release-diagnostics")
      mkdirSync(join(f.root, name), { mode: 0o755 });
    else chmodSync(join(f.root, name), 0o644);
    rejectHost(f.direct(f.request(), bytes));
  }
  for (const name of ["release.lock", "release-operations.jsonl"]) {
    const f = fixture(t);
    const original = readFileSync(join(f.root, name));
    linkSync(join(f.root, name), join(f.root, "other-link"));
    rejectHost(f.direct(f.request(), bytes));
    assert.deepEqual(readFileSync(join(f.root, "other-link")), original);
  }
  const f = fixture(t);
  const alias = `${f.root}-alias`;
  symlinkSync(f.root, alias);
  t.after(() => rmSync(alias));
  rejectHost(
    f.direct(f.request(), bytes, (code) =>
      code.replace(
        `ROOT = Path(${JSON.stringify(f.root)})`,
        `ROOT = Path(${JSON.stringify(alias)})`,
      ),
    ),
  );
  rejectHost(
    f.direct(f.request(), bytes, (code) =>
      code.replace(
        "def transfer():",
        "_actual_uid = os.getuid()\nos.getuid = lambda: _actual_uid + 1\n\ndef transfer():",
      ),
    ),
  );
});

test("read validates private descriptors, identity and exact single-link payload bytes", async (t) => {
  for (const change of [
    "payload-link",
    "descriptor-link",
    "payload-symlink",
    "descriptor-symlink",
    "payload-permission",
    "descriptor-permission",
    "corrupt-payload",
    "foreign-identity",
    "malformed-descriptor",
    "extra-payload",
  ]) {
    const f = fixture(t);
    const options = f.options();
    await retainLaunchTrace(config, options);
    const record = f.record(options.traceId);
    const payload = join(record, "trace.json");
    const descriptor = join(record, "descriptor.json");
    if (change.endsWith("-link"))
      linkSync(
        change.startsWith("payload") ? payload : descriptor,
        join(f.root, "hardlink"),
      );
    else if (change.endsWith("-symlink")) {
      const target = change.startsWith("payload") ? payload : descriptor;
      const foreign = join(f.root, "foreign-file");
      writeFileSync(foreign, readFileSync(target), { mode: 0o600 });
      rmSync(target);
      symlinkSync(foreign, target);
    } else if (change.endsWith("-permission"))
      chmodSync(change.startsWith("payload") ? payload : descriptor, 0o644);
    else if (change === "corrupt-payload")
      writeFileSync(payload, '{"different":true}');
    else if (change === "extra-payload")
      writeFileSync(payload, Buffer.concat([bytes, Buffer.from(" ")]));
    else if (change === "malformed-descriptor")
      writeFileSync(descriptor, "synthetic raw invalid metadata");
    else {
      const value = JSON.parse(readFileSync(descriptor));
      value.identity.planDigest = "c".repeat(64);
      writeFileSync(descriptor, JSON.stringify(value));
    }
    await assert.rejects(readLaunchTrace(config, options), failure);
  }
});

test("the controller rejects mismatched acknowledgements and downloaded descriptors", async (t) => {
  const f = fixture(t);
  const options = f.options();
  const respond = (response) => (_command, _args, launch) =>
    spawn(
      "python3",
      [
        "-c",
        `import sys,base64;sys.stdin.buffer.read();sys.stdout.buffer.write(base64.b64decode('${response.toString("base64")}'))`,
      ],
      launch,
    );
  const ack = {
    durable: true,
    traceId: options.traceId,
    sha256: digest(bytes),
    size: bytes.length,
  };
  for (const change of [
    { durable: false },
    { sha256: "c".repeat(64) },
    { size: bytes.length + 1 },
    { traceId: randomUUID() },
  ]) {
    await assert.rejects(
      retainLaunchTrace(config, {
        ...options,
        start: respond(Buffer.from(JSON.stringify({ ...ack, ...change }))),
      }),
      failure,
    );
  }
  const descriptor = {
    schemaVersion: 1,
    identity,
    traceId: options.traceId,
    sha256: digest(bytes),
    size: bytes.length,
  };
  for (const change of [
    { sha256: "c".repeat(64) },
    { size: bytes.length + 1 },
    { identity: { ...identity, planDigest: "c".repeat(64) } },
    { traceId: randomUUID() },
  ]) {
    const response = Buffer.concat([
      Buffer.from(`${JSON.stringify({ ...descriptor, ...change })}\n`),
      bytes,
    ]);
    await assert.rejects(
      readLaunchTrace(config, { ...options, start: respond(response) }),
      failure,
    );
  }
  await assert.rejects(
    readLaunchTrace(config, {
      ...options,
      start: respond(Buffer.alloc(256 * 1024 + 4097)),
    }),
    failure,
  );
});

function mockSSH(signal) {
  const child = new EventEmitter();
  child.pid = 321;
  child.killed = false;
  child.stdin = new PassThrough();
  child.stdin.resume();
  child.stdout = new PassThrough({ highWaterMark: 8 });
  child.stderr = new PassThrough();
  const term = Promise.withResolvers();
  const kill = Promise.withResolvers();
  const signals = [];
  child.kill = (kind) => {
    signals.push(kind);
    child.killed = true;
    (kind === "SIGTERM" ? term : kill).resolve();
    return true;
  };
  const options = {
    identity,
    traceId: randomUUID(),
    bytes,
    signal,
    environment: { PATH: "/tools", HOME: "/synthetic", LANG: "C" },
    start: (_command, _args, launch) => {
      assert.equal(launch.signal, signal);
      assert.equal(launch.timeout, 30000);
      return child;
    },
  };
  const acknowledgement = Buffer.from(
    JSON.stringify({
      durable: true,
      traceId: options.traceId,
      sha256: digest(bytes),
      size: bytes.length,
    }),
  );
  return {
    child,
    options,
    acknowledgement,
    signals,
    term: term.promise,
    kill: kill.promise,
    finish: (status = 0) => {
      child.exitCode = status;
      child.stdin.destroy();
      if (!child.stdout.writableEnded) child.stdout.end();
      if (!child.stderr.writableEnded) child.stderr.end();
      child.emit("close", status);
    },
  };
}

function observe(promise) {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return () => settled;
}

test("pre-aborted transfers never spawn SSH", async () => {
  const controller = new AbortController();
  controller.abort(new Error("synthetic-private cancellation"));
  const options = {
    identity,
    traceId: randomUUID(),
    bytes,
    signal: controller.signal,
    start: () => assert.fail("pre-aborted transfer must not spawn"),
  };
  await assert.rejects(retainLaunchTrace(config, options), failure);
  await assert.rejects(readLaunchTrace(config, options), failure);
});

test("cancellation escalates an owned SSH child after two seconds and awaits its actual close", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const ssh = mockSSH(controller.signal);
  const run = retainLaunchTrace(config, ssh.options);
  const settled = observe(run);
  const rejected = assert.rejects(run, failure);
  controller.abort(new Error("synthetic-private cancellation"));
  await ssh.term;
  assert.deepEqual(ssh.signals, ["SIGTERM"]);
  t.mock.timers.tick(1999);
  assert.equal(settled(), false);
  assert.deepEqual(ssh.signals, ["SIGTERM"]);
  t.mock.timers.tick(1);
  await ssh.kill;
  assert.deepEqual(ssh.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(settled(), false);
  ssh.finish(null);
  await rejected;
});

test("the thirty-second transfer deadline has only the existing two-second termination grace", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ssh = mockSSH();
  const run = retainLaunchTrace(config, ssh.options);
  const rejected = assert.rejects(run, failure);
  t.mock.timers.tick(29999);
  assert.deepEqual(ssh.signals, []);
  t.mock.timers.tick(1);
  await ssh.term;
  t.mock.timers.tick(2000);
  await ssh.kill;
  ssh.finish(null);
  await rejected;
});

test("a spawned child error is not evidence of process closure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ssh = mockSSH();
  const run = retainLaunchTrace(config, ssh.options);
  const settled = observe(run);
  const rejected = assert.rejects(run, failure);
  ssh.child.emit("error", new Error("synthetic-private SSH error"));
  await ssh.term;
  assert.equal(settled(), false);
  ssh.finish(1);
  await rejected;
  t.mock.timers.tick(2000);
  assert.deepEqual(ssh.signals, ["SIGTERM"]);
});

test("an AbortError after Node sends TERM still requires KILL or actual close", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const ssh = mockSSH(controller.signal);
  const run = retainLaunchTrace(config, ssh.options);
  const settled = observe(run);
  const rejected = assert.rejects(run, failure);
  ssh.child.kill("SIGTERM");
  const cleanup = once(ssh.child.stdin, "close");
  controller.abort();
  ssh.child.emit(
    "error",
    Object.assign(new Error("synthetic-private abort"), { name: "AbortError" }),
  );
  await cleanup;
  assert.equal(settled(), false);
  t.mock.timers.tick(2000);
  await ssh.kill;
  assert.deepEqual(ssh.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(settled(), false);
  ssh.finish(null);
  await rejected;
});

test("failed spawn without a PID can reject without an impossible process close", async () => {
  const ssh = mockSSH();
  ssh.child.pid = undefined;
  const run = retainLaunchTrace(config, ssh.options);
  ssh.child.emit("error", new Error("synthetic-private spawn error"));
  await assert.rejects(run, failure);
  assert.deepEqual(ssh.signals, []);
  ssh.child.stderr.end();
});

test("oversized output and stdin errors terminate SSH, without resolving on TERM", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const kind of ["output", "stdin"]) {
    const ssh = mockSSH();
    const run = retainLaunchTrace(config, ssh.options);
    const settled = observe(run);
    const rejected = assert.rejects(run, failure);
    if (kind === "output")
      ssh.child.stdout.end(Buffer.alloc(256 * 1024 + 4097));
    else
      ssh.child.stdin.emit(
        "error",
        new Error("synthetic-private stream error"),
      );
    await ssh.term;
    assert.equal(settled(), false);
    t.mock.timers.tick(2000);
    await ssh.kill;
    assert.equal(settled(), false);
    ssh.finish(null);
    await rejected;
  }
});

test("cancellation after a durable acknowledgement and close cannot report success", async () => {
  const controller = new AbortController();
  const ssh = mockSSH(controller.signal);
  const run = retainLaunchTrace(config, ssh.options);
  ssh.child.stdout.end(ssh.acknowledgement);
  ssh.finish(0);
  controller.abort();
  await assert.rejects(run, failure);
  assert.deepEqual(ssh.signals, []);
});

test("an acknowledgement must drain and SSH must close successfully before return", async () => {
  const ssh = mockSSH();
  const run = retainLaunchTrace(config, ssh.options);
  const settled = observe(run);
  ssh.child.emit("exit", 0);
  const drain = once(ssh.child.stdout, "drain");
  assert.equal(
    ssh.child.stdout.write(ssh.acknowledgement.subarray(0, 32)),
    false,
  );
  await drain;
  assert.equal(settled(), false);
  ssh.child.stderr.write("synthetic-private raw SSH diagnostic".repeat(1000));
  const end = once(ssh.child.stdout, "end");
  ssh.child.stdout.end(ssh.acknowledgement.subarray(32));
  await end;
  assert.equal(settled(), false);
  ssh.finish(0);
  assert.deepEqual(await run, {
    traceId: ssh.options.traceId,
    sha256: digest(bytes),
    size: bytes.length,
  });
  assert.deepEqual(ssh.signals, []);
});

test("nonzero SSH closure rejects even an otherwise valid durable acknowledgement", async () => {
  const ssh = mockSSH();
  const run = retainLaunchTrace(config, ssh.options);
  ssh.child.stdout.end(ssh.acknowledgement);
  ssh.finish(7);
  await assert.rejects(run, failure);
  assert.deepEqual(ssh.signals, []);
});

test("transport failures expose no raw host diagnostics, payload or exception cause", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    retainLaunchTrace(
      config,
      f.options({
        start: () => {
          throw new Error(`synthetic-private ${bytes}`);
        },
      }),
    ),
    (error) => {
      assert.match(error.message, failure);
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(
        error.message,
        /synthetic-private|dialogs|release-diagnostics/,
      );
      return true;
    },
  );
  const options = f.options({
    start: (_command, _args, launch) =>
      spawn(
        "python3",
        [
          "-c",
          "import sys;sys.stderr.write('synthetic-private raw dialog');print('synthetic-private malformed ack')",
        ],
        launch,
      ),
  });
  await assert.rejects(retainLaunchTrace(config, options), failure);
});
