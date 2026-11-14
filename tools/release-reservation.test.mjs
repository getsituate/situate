import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  statSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  allocateReleaseIdentity,
  appleBuildNumber,
  appleBuildSequence,
  createGitReservationAdapter,
  inspectReservation,
  reconcileReservation,
  reservationAnnotation,
  reserveRelease,
  validateReservation,
} from "./release-reservation.mjs";
import {
  allocatorProgram,
  createAllocatorLock,
  createBuilderNotaryJournal,
  createHostNotaryJournal,
  createHostReleaseCoordinator,
} from "../infrastructure/releases/allocator.mjs";
import { qualifyPublishedMigrations } from "./published-migrations.mjs";

const source = "a".repeat(40),
  fragmentDigest = "b".repeat(64),
  generatedInputDigest = "c".repeat(64);
const at = (date = "2026-11-30T23:59:59Z") => new Date(date);
const inventory = (tags = [], builds = []) => ({
  complete: true,
  tags,
  builds,
});
const legacy = (name) => ({ name });
const request = (operationId = "candidate-1", now = at()) => ({
  operationId,
  sourceRevision: source,
  fragmentDigest,
  now,
  prepareInputs: async () => ({ generatedInputDigest, fragmentDigest }),
});
const recorded = (value) => ({
  name: value.tag,
  annotated: true,
  sourceRevision: value.sourceRevision,
  reservation: value,
});

function memoryAdapter() {
  let queue = Promise.resolve(),
    pending = null;
  const tags = new Map();
  let creates = 0;
  const adapter = {
    tags,
    get creates() {
      return creates;
    },
    get pending() {
      return pending;
    },
    withAllocatorLock: async (fn) => {
      const previous = queue;
      let release;
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await fn({
          pending: async () => structuredClone(pending),
          saveIntent: async (value) => {
            assert.equal(pending, null);
            pending = structuredClone(value);
          },
          clearIntent: async (value) => {
            assert.deepEqual(pending, value);
            pending = null;
          },
          assertHeld: async () => {},
        });
      } finally {
        release();
      }
    },
    readInventory: async () =>
      inventory(
        [...tags.values()].map((tag) => recorded(JSON.parse(tag.annotation))),
      ),
    inspectTag: async (name) => tags.get(name) ?? null,
    createAnnotatedTag: async (value) => {
      creates++;
      assert.equal(value.force, false);
      assert.equal(tags.has(value.tag), false);
      assert.notEqual(pending, null);
      tags.set(value.tag, {
        annotated: true,
        sourceRevision: value.sourceRevision,
        annotation: value.annotation,
      });
    },
  };
  return adapter;
}

function hostFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "situate-allocator-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const program = allocatorProgram().replace(
    "ROOT = Path('/opt/situate')",
    `ROOT = Path(${JSON.stringify(root)})`,
  );
  const withAllocatorLock = createAllocatorLock({
    start: () => spawn("python3", ["-u", "-c", program]),
    timeoutMs: 30000,
  });
  return { root, withAllocatorLock, program };
}

test("allocation uses UTC monthly maximum, not tag counts, and ignores unrelated tags", () => {
  assert.deepEqual(
    allocateReleaseIdentity(
      inventory(
        [
          legacy("v0.1.27"),
          legacy("v2026.11.2"),
          legacy("v2026.11.8"),
          legacy("tools-v99"),
        ],
        ["42"],
      ),
      at(),
    ),
    {
      version: "2026.11.9",
      tag: "v2026.11.9",
      buildSequence: 420001,
      buildNumber: "42.0.1",
    },
  );
  assert.equal(
    allocateReleaseIdentity(
      inventory([legacy("v2026.11.8")]),
      at("2026-12-01T00:15:00+01:00"),
    ).version,
    "2026.11.9",
  );
});

test("month/year boundaries reset only public sequence, preserving reserved builds and gaps", async () => {
  const adapter = memoryAdapter();
  const first = (await reserveRelease(request(), adapter)).reservation;
  const next = allocateReleaseIdentity(
    inventory([recorded(first)], ["99.99.99"]),
    at("2026-12-01T00:00:00Z"),
  );
  assert.equal(next.version, "2026.12.1");
  assert.equal(next.buildNumber, "100.0.0");
  assert.equal(
    allocateReleaseIdentity(
      inventory([legacy("v2026.12.99")]),
      at("2027-01-01T00:00:00Z"),
    ).version,
    "2027.1.1",
  );
});

test("historical Apple integer and tuple values retain numerical ordering", () => {
  for (const [value, expected] of [
    ["7", 70000],
    ["7.1", 70100],
    ["7.1.2", 70102],
    ["0.1.27", 127],
  ])
    assert.equal(appleBuildSequence(value), expected);
  assert.equal(appleBuildNumber(10099), "1.0.99");
  assert.equal(appleBuildNumber(10100), "1.1.0");
  assert.equal(appleBuildNumber(99999999), "9999.99.99");
  assert.throws(
    () => allocateReleaseIdentity(inventory([], ["9999.99.99"]), at()),
    /exhausted/u,
  );
  for (const value of ["01", "1.100.0", "10000.0.0", "1.2.3.4", "1a", "1.0b1"])
    assert.throws(() => appleBuildSequence(value), /Apple/u);
});

test("clock regression and unsupported/malformed release namespaces fail closed", () => {
  for (const name of ["v2026.12.1", "v2027.1.1", "v9999.1.1"])
    assert.throws(
      () => allocateReleaseIdentity(inventory([legacy(name)]), at()),
      /clock regressed/u,
    );
  for (const name of [
    "v2026.011.1",
    "v2026.x.1",
    "v2026.13.1",
    "v2026.0.1",
    "v2026.11.0",
  ])
    assert.throws(
      () => allocateReleaseIdentity(inventory([legacy(name)]), at()),
      /Malformed/u,
    );
  assert.throws(
    () =>
      allocateReleaseIdentity(
        inventory([legacy("v2026.11.9007199254740991")]),
        at(),
      ),
    /exhausted/u,
  );
  assert.throws(
    () => allocateReleaseIdentity(inventory(), new Date("bad")),
    /clock/u,
  );
});

test("failed inventory reads, incomplete pagination and duplicate identities cannot bootstrap", async () => {
  for (const value of [
    { tags: [], builds: [] },
    { complete: true, tags: [] },
    inventory([legacy("v0.1.1"), legacy("v0.1.1")]),
  ])
    assert.throws(
      () => allocateReleaseIdentity(value, at()),
      /inventory|Duplicate/u,
    );
  const adapter = memoryAdapter();
  adapter.readInventory = async () => {
    throw new Error("history unavailable");
  };
  await assert.rejects(
    reserveRelease(request(), adapter),
    /history unavailable/u,
  );
  assert.equal(adapter.creates, 0);
  assert.equal(adapter.pending, null);
});

test("simultaneous creators across UTC month boundaries share global build uniqueness", async () => {
  const adapter = memoryAdapter();
  const [a, b] = await Promise.all([
    reserveRelease(request("a"), adapter),
    reserveRelease(request("b", at("2026-12-01T00:00:00Z")), adapter),
  ]);
  assert.equal(a.reservation.version, "2026.11.1");
  assert.equal(b.reservation.version, "2026.12.1");
  assert.equal(a.reservation.buildNumber, "1.0.0");
  assert.equal(b.reservation.buildNumber, "1.0.1");
  assert.equal(adapter.tags.size, 2);
});

test("the same operation resumes unchanged after midnight, year changes and clock regression", async () => {
  const adapter = memoryAdapter();
  const first = await reserveRelease(request(), adapter);
  for (const date of [
    "2026-12-01T00:00:00Z",
    "2027-01-01T00:00:00Z",
    "2025-01-01T00:00:00Z",
  ])
    assert.deepEqual(
      await reserveRelease(request("candidate-1", at(date)), adapter),
      first,
    );
  assert.equal(adapter.creates, 1);
});

test("operation source, fragment and sealed input bindings are immutable", async () => {
  const adapter = memoryAdapter();
  await reserveRelease(request(), adapter);
  for (const change of [
    { sourceRevision: "d".repeat(40) },
    { fragmentDigest: "d".repeat(64) },
    { prepareInputs: async () => ({ generatedInputDigest: "d".repeat(64) }) },
  ])
    await assert.rejects(
      reserveRelease({ ...request(), ...change }, adapter),
      /binding differs|inputs differ/u,
    );
  assert.equal(adapter.creates, 1);
});

test("input preparation failure leaves no intent or tag; digest mismatch blocks creation", async () => {
  const adapter = memoryAdapter();
  await assert.rejects(
    reserveRelease(
      {
        ...request(),
        prepareInputs: async () => {
          throw new Error("compile failed");
        },
      },
      adapter,
    ),
    /compile failed/u,
  );
  await assert.rejects(
    reserveRelease(
      {
        ...request(),
        prepareInputs: async () => ({
          generatedInputDigest,
          fragmentDigest: "d".repeat(64),
        }),
      },
      adapter,
    ),
    /fragment digest differs/u,
  );
  assert.equal(adapter.pending, null);
  assert.equal(adapter.creates, 0);
});

test("unknown tag creation is inspected without retry, then explicitly reconciled", async () => {
  const adapter = memoryAdapter(),
    create = adapter.createAnnotatedTag;
  adapter.createAnnotatedTag = async (value) => {
    await create(value);
    throw new Error("lost response");
  };
  const result = await reserveRelease(request(), adapter);
  assert.equal(result.status, "unknown");
  await assert.rejects(
    reserveRelease(request("other"), adapter),
    /unresolved/u,
  );
  assert.equal(
    (await inspectReservation(result.reservation, adapter)).status,
    "reserved",
  );
  assert.notEqual(adapter.pending, null);
  assert.equal(
    (await reconcileReservation(result.reservation, adapter)).status,
    "reserved",
  );
  assert.equal(adapter.pending, null);
  assert.equal(adapter.creates, 1);
});

test("authoritative absence retains intent and explicit retry uses only its original immutable tag", async () => {
  const adapter = memoryAdapter(),
    create = adapter.createAnnotatedTag;
  adapter.createAnnotatedTag = async () => {
    throw new Error("unknown push");
  };
  const result = await reserveRelease(request(), adapter);
  assert.equal(
    (await reconcileReservation(result.reservation, adapter)).status,
    "absent",
  );
  assert.deepEqual(adapter.pending, result.reservation);
  adapter.createAnnotatedTag = create;
  const order = [],
    inspect = adapter.inspectTag;
  adapter.inspectTag = async (name) => {
    order.push("inspect");
    return inspect(name);
  };
  adapter.createAnnotatedTag = async (value) => {
    order.push("create");
    await create(value);
  };
  assert.equal(
    (
      await reconcileReservation(result.reservation, adapter, {
        retryAbsent: true,
      })
    ).status,
    "reserved",
  );
  assert.deepEqual(order, ["inspect", "create", "inspect"]);
  assert.equal(adapter.tags.size, 1);
});

test("stale allocation rejection never advances silently to a fresh identity", async () => {
  const adapter = memoryAdapter();
  adapter.createAnnotatedTag = async (value) => {
    adapter.tags.set(value.tag, {
      annotated: true,
      sourceRevision: "d".repeat(40),
      annotation: value.annotation,
    });
    throw new Error("rejected existing ref");
  };
  const result = await reserveRelease(request(), adapter);
  assert.equal(result.status, "unknown");
  await assert.rejects(
    reconcileReservation(result.reservation, adapter, { retryAbsent: true }),
    /exact source/u,
  );
  assert.deepEqual(adapter.pending, result.reservation);
  await assert.rejects(
    reserveRelease(request("successor"), adapter),
    /unresolved/u,
  );
});

test("inspection rejects lightweight tags, changed JSON, source and build bindings", async () => {
  const adapter = memoryAdapter();
  const { reservation } = await reserveRelease(request(), adapter);
  assert.deepEqual(JSON.parse(reservationAnnotation(reservation)), reservation);
  for (const tag of [
    {
      annotated: false,
      sourceRevision: source,
      annotation: reservationAnnotation(reservation),
    },
    {
      annotated: true,
      sourceRevision: source,
      annotation: JSON.stringify({
        ...reservation,
        generatedInputDigest: "d".repeat(64),
      }),
    },
  ]) {
    adapter.tags.set(reservation.tag, tag);
    await assert.rejects(
      inspectReservation(reservation, adapter),
      /annotated|annotation differs/u,
    );
  }
  assert.throws(
    () => validateReservation({ ...reservation, buildNumber: "1.0.2" }),
    /identity differs/u,
  );
  assert.throws(
    () => validateReservation({ ...reservation, unrecognized: true }),
    /schema/u,
  );
});

test("inventory detects duplicate global build IDs and inconsistent annotated bindings", async () => {
  const { reservation } = await reserveRelease(request(), memoryAdapter());
  assert.throws(
    () =>
      allocateReleaseIdentity(
        inventory([
          recorded(reservation),
          recorded({
            ...reservation,
            operationId: "second",
            tag: "v2026.11.2",
            version: "2026.11.2",
          }),
        ]),
        at(),
      ),
    /Duplicate reservation/u,
  );
  assert.throws(
    () =>
      allocateReleaseIdentity(
        inventory([{ ...recorded(reservation), annotated: false }]),
        at(),
      ),
    /binding differs/u,
  );
});

test("real Git adapter binds non-force annotated tags to original commits with host build inventory", async (t) => {
  const { root, withAllocatorLock } = hostFixture(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(root, "source"), "reviewed source\n");
  git("add", "source");
  git("commit", "-qm", "feat: reviewed fixture");
  const sourceRevision = git("rev-parse", "HEAD");
  const adapter = createGitReservationAdapter({
    root,
    remote: root,
    withAllocatorLock,
    readVerifiedBuilds: async ({ hostSnapshot }) => {
      assert.equal(hostSnapshot.complete, true);
      return { complete: true, builds: ["42"] };
    },
    executeGit: async (args, input) => {
      if (args[0] === "remote")
        return "https://github.com/getsituate/situate.git\n";
      return execFileSync("git", args, {
        cwd: root,
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_COMMITTER_NAME: "Situate Release",
          GIT_COMMITTER_EMAIL: "release@getsituate.com",
        },
      });
    },
  });
  const result = await reserveRelease(
    { ...request(), sourceRevision },
    adapter,
  );
  assert.equal(result.status, "reserved");
  assert.equal(result.reservation.buildNumber, "42.0.1");
  assert.equal(
    git("rev-parse", `${result.reservation.tag}^{commit}`),
    sourceRevision,
  );
  assert.equal(git("cat-file", "-t", result.reservation.tag), "tag");
  assert.match(
    git("cat-file", "tag", result.reservation.tag),
    /^tagger Situate Release <release@getsituate.com> /mu,
  );
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), "");
  assert.equal(
    (await inspectReservation(result.reservation, adapter)).status,
    "reserved",
  );
  await assert.rejects(
    adapter.createAnnotatedTag({
      tag: result.reservation.tag,
      sourceRevision,
      annotation: reservationAnnotation({
        ...result.reservation,
        operationId: "different",
      }),
      force: false,
    }),
    /Command failed/u,
  );
  assert.equal(
    (await inspectReservation(result.reservation, adapter)).status,
    "reserved",
  );
  const [second, third] = await Promise.all([
    reserveRelease({ ...request("parallel-two"), sourceRevision }, adapter),
    reserveRelease({ ...request("parallel-three"), sourceRevision }, adapter),
  ]);
  assert.equal(second.status, "reserved");
  assert.equal(third.status, "reserved");
  assert.deepEqual(
    [second.reservation.buildSequence, third.reservation.buildSequence].sort(),
    [420002, 420003],
  );
  assert.equal(git("rev-list", "--count", "HEAD"), "1");
});

test("Git writer rejects wrong repositories and push URLs before any tag or ref write", async () => {
  const { reservation } = await reserveRelease(request(), memoryAdapter());
  for (const urls of [
    [
      "https://github.com/other/project.git",
      "https://github.com/getsituate/situate.git",
    ],
    [
      "https://github.com/getsituate/situate.git",
      "git@github.com:other/project.git",
    ],
    [
      "https://github.com/getsituate/situate.git",
      "https://github.com/getsituate/situate.git\nhttps://github.com/other/project.git",
    ],
    [
      "https://github.com/getsituate/situate.git",
      "https://github.com/getsituate/situate-extra.git",
    ],
  ]) {
    const calls = [];
    const adapter = createGitReservationAdapter({
      root: "/fixture",
      withAllocatorLock: async () => {},
      readVerifiedBuilds: async () => ({ complete: true, builds: [] }),
      executeGit: async (args) => {
        calls.push(args);
        return args.includes("--push") ? urls[1] : urls[0];
      },
    });
    await assert.rejects(
      adapter.createAnnotatedTag({
        tag: reservation.tag,
        sourceRevision: source,
        annotation: reservationAnnotation(reservation),
        force: false,
      }),
      /exactly getsituate/u,
    );
    assert(calls.every((args) => args[0] === "remote"));
  }
});

test("host inventory preserves old default build versions, explicit builds and migration tuples", async (t) => {
  const { root, withAllocatorLock } = hostFixture(t);
  for (const [version, buildNumber] of [
    ["0.1.27", undefined],
    ["0.2.0", "50.0.9"],
  ]) {
    const directory = join(root, "releases", version);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        status: "complete",
        dirty: false,
        distribution: "direct",
        version,
        revision: source,
        artifacts: [
          { platform: "macos", ...(buildNumber ? { buildNumber } : {}) },
        ],
      }),
    );
  }
  await withAllocatorLock(async (lease) => {
    const result = await lease.inventory();
    assert.equal(result.complete, true);
    assert.deepEqual(result.builds, ["0.1.27", "50.0.9"]);
    assert.deepEqual(
      result.releases.map((release) => release.version),
      ["0.1.27", "0.2.0"],
    );
    assert(
      result.releases.every((release) =>
        /^[a-f0-9]{64}$/u.test(release.manifestSha256),
      ),
    );
  });
  writeFileSync(join(root, "releases/0.2.0/manifest.json"), "broken");
  await assert.rejects(
    withAllocatorLock((lease) => lease.inventory()),
    /connection lost/u,
  );
});

test("controlled host uses the existing publication lock across separate processes", async (t) => {
  const { root, withAllocatorLock } = hostFixture(t);
  const events = [];
  let unlock, acquired;
  const held = new Promise((resolve) => {
    acquired = resolve;
  });
  const gate = new Promise((resolve) => {
    unlock = resolve;
  });
  const first = withAllocatorLock(async (lease) => {
    events.push("first");
    await lease.saveIntent({ operationId: "one" });
    acquired();
    await gate;
  });
  await held;
  const second = withAllocatorLock(async (lease) => {
    events.push("second");
    assert.deepEqual(await lease.pending(), { operationId: "one" });
  });
  assert.deepEqual(events, ["first"]);
  unlock();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first", "second"]);
  assert.equal(statSync(join(root, "release.lock")).mode & 0o777, 0o600);
});

test("durable host intent survives connection loss and requires exact reconciliation", async (t) => {
  const { root, withAllocatorLock } = hostFixture(t);
  await assert.rejects(
    withAllocatorLock(async (lease) => {
      await lease.saveIntent({ operationId: "one" });
      throw new Error("runner lost");
    }),
    /runner lost/u,
  );
  await withAllocatorLock(async (lease) => {
    assert.deepEqual(await lease.pending(), { operationId: "one" });
  });
  await assert.rejects(
    withAllocatorLock((lease) => lease.clearIntent({ operationId: "other" })),
    /connection lost/u,
  );
  await withAllocatorLock((lease) => lease.clearIntent({ operationId: "one" }));
  assert.throws(
    () => readFileSync(join(root, "release-allocation-pending.json")),
    /ENOENT/u,
  );
});

test("host allocator refuses symlink intent files without following them", async (t) => {
  const { root, withAllocatorLock } = hostFixture(t);
  const target = join(root, "untouched");
  writeFileSync(target, "private");
  symlinkSync(target, join(root, "release-allocation-pending.json"));
  await assert.rejects(
    withAllocatorLock((lease) => lease.pending()),
    /connection lost/u,
  );
  assert.equal(readFileSync(target, "utf8"), "private");
});

test("notary journal persists intent before submission and append-only completion", async (t) => {
  const { root, withAllocatorLock } = hostFixture(t);
  const journal = createHostNotaryJournal(
    {},
    { operationId: "notary-one", withAllocatorLock },
  );
  await assert.rejects(
    journal.persist({ phase: "submission", submissionId: "apple-1" }),
    /connection lost/u,
  );
  assert.deepEqual(
    await journal.persist({
      phase: "intent",
      archiveSha256: generatedInputDigest,
    }),
    { durable: true, operationId: "notary-one" },
  );
  await assert.rejects(
    journal.persist({ phase: "intent", archiveSha256: generatedInputDigest }),
    /connection lost/u,
  );
  const prefix = readFileSync(
    join(root, "release-notary-journal.jsonl"),
    "utf8",
  );
  assert.deepEqual(
    await journal.persist({ phase: "submission", submissionId: "apple-1" }),
    { durable: true, operationId: "notary-one" },
  );
  await journal.complete({ outcome: "success" });
  const bytes = readFileSync(
    join(root, "release-notary-journal.jsonl"),
    "utf8",
  );
  assert(bytes.startsWith(prefix));
  assert.deepEqual(
    (await journal.inspect()).records.map((item) => item.phase),
    ["intent", "submission", "completion"],
  );
  assert.equal(
    readFileSync(join(root, "release-notary-journal.jsonl"), "utf8"),
    bytes,
  );
  await assert.rejects(
    journal.complete({ outcome: "failed" }),
    /connection lost/u,
  );
});

test("builder notary records map app ZIP and DMG payloads to durable child families", async (t) => {
  const { withAllocatorLock } = hostFixture(t);
  const operationId = "release-builder";
  const journal = createBuilderNotaryJournal(
    {},
    { operationId, withAllocatorLock },
  );
  const payloads = [
    {
      operationId,
      file: "Situate-app.zip",
      sha256: "a".repeat(64),
      id: "11111111-1111-1111-1111-111111111111",
    },
    {
      operationId,
      file: "Situate-direct.dmg",
      sha256: "b".repeat(64),
      id: "22222222-2222-2222-2222-222222222222",
    },
  ];
  for (const { id, ...payload } of payloads) {
    assert.deepEqual(
      await journal.persist({ ...payload, status: "submitting" }),
      { durable: true, operationId },
    );
    assert.deepEqual(
      await journal.persist({ ...payload, id, status: "submitted" }),
      { durable: true, operationId },
    );
    assert.deepEqual(
      await journal.persist({ ...payload, id, status: "Accepted" }),
      { durable: true, operationId },
    );
    assert.deepEqual(
      await journal.complete({ ...payload, id, status: "Accepted" }),
      { durable: true, operationId },
    );
  }
  const reopened = createBuilderNotaryJournal(
    {},
    { operationId, withAllocatorLock },
  );
  const inspection = await reopened.inspect();
  assert.equal(inspection.operationId, operationId);
  assert.deepEqual(
    inspection.operations.map((child) => child.operationId),
    [
      "release-builder-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "release-builder-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ],
  );
  for (const [index, child] of inspection.operations.entries()) {
    assert.deepEqual(
      child.records.map((record) => record.phase),
      ["intent", "submission", "completion"],
    );
    assert.equal(child.records[1].submissionId, payloads[index].id);
    assert.equal(child.records[2].outcome, "success");
    assert(
      child.records.every(
        (record) =>
          record.file === payloads[index].file &&
          record.sha256 === payloads[index].sha256 &&
          record.parentOperationId === operationId,
      ),
    );
  }
  const { id: _id, ...payload } = payloads[0];
  await assert.rejects(
    reopened.persist({ ...payload, status: "submitting" }),
    /connection lost/u,
  );
  assert.deepEqual(await reopened.inspect(), inspection);
});

test("builder unknown payloads survive executor loss and never authorize a new submission", async (t) => {
  const { withAllocatorLock } = hostFixture(t);
  const options = { operationId: "unknown-builder", withAllocatorLock };
  const journal = createBuilderNotaryJournal({}, options);
  const payload = {
    operationId: options.operationId,
    file: "Situate-app.zip",
    sha256: fragmentDigest,
  };
  await journal.persist({ ...payload, status: "submitting" });
  await journal.persist({ ...payload, status: "unknown" });
  const reopened = createBuilderNotaryJournal({}, options);
  await assert.rejects(
    reopened.persist({ ...payload, status: "submitting" }),
    /connection lost/u,
  );
  await assert.rejects(
    reopened.persist({
      ...payload,
      file: "Situate-direct.dmg",
      sha256: generatedInputDigest,
      status: "submitting",
    }),
    /connection lost/u,
  );
  const inspection = await reopened.inspect();
  assert.equal(inspection.operations.length, 1);
  assert.equal(inspection.operations[0].records.at(-1).outcome, "unknown");
  const unrelated = createHostNotaryJournal(
    {},
    { operationId: "unknown-builder-unrelated", withAllocatorLock },
  );
  assert.deepEqual((await unrelated.inspect()).records, []);
  assert.deepEqual(await reopened.inspect(), inspection);
});

test("builder unknown submissions retain Apple IDs and permit only recorded terminal reconciliation", async (t) => {
  const { withAllocatorLock } = hostFixture(t);
  const operationId = "submitted-builder";
  const journal = createBuilderNotaryJournal(
    {},
    { operationId, withAllocatorLock },
  );
  const payload = {
    operationId,
    file: "Situate-direct.dmg",
    sha256: generatedInputDigest,
  };
  const id = "55555555-5555-5555-5555-555555555555";
  await journal.persist({ ...payload, status: "submitting" });
  await journal.persist({ ...payload, id, status: "submitted" });
  await journal.persist({ ...payload, id, status: "unknown" });
  const reopened = createBuilderNotaryJournal(
    {},
    { operationId, withAllocatorLock },
  );
  const inspection = await reopened.inspect();
  assert.equal(inspection.operations[0].records.at(-1).submissionId, id);
  await assert.rejects(
    reopened.persist({ ...payload, status: "submitting" }),
    /connection lost/u,
  );
  await assert.rejects(
    reopened.persist({ ...payload, id, status: "submitted" }),
    /connection lost/u,
  );
  await reopened.complete({ ...payload, id, status: "Accepted" });
  const resolved = await reopened.inspect();
  assert.equal(resolved.operations[0].records.at(-1).outcome, "success");
  assert.equal(
    resolved.operations[0].records.filter(
      (record) => record.phase === "submission",
    ).length,
    1,
  );
});

test("builder terminal statuses retain failure, submission identity and full payload bindings", async (t) => {
  const { withAllocatorLock } = hostFixture(t);
  const operationId = "failed-builder";
  const journal = createBuilderNotaryJournal(
    {},
    { operationId, withAllocatorLock },
  );
  for (const [status, sha256] of [
    ["Invalid", "d".repeat(64)],
    ["Rejected", "e".repeat(64)],
  ]) {
    const payload = { operationId, file: "Situate-direct.dmg", sha256 };
    const id = "33333333-3333-3333-3333-333333333333";
    await journal.persist({ ...payload, status: "submitting" });
    await journal.persist({ ...payload, id, status: "submitted" });
    await assert.rejects(
      journal.persist({
        ...payload,
        id: "44444444-4444-4444-4444-444444444444",
        status,
      }),
      /connection lost/u,
    );
    await assert.rejects(
      journal.persist({ ...payload, file: "different.dmg", id, status }),
      /connection lost/u,
    );
    await assert.rejects(
      journal.persist({
        ...payload,
        sha256: `${sha256.slice(0, 32)}${"f".repeat(32)}`,
        id,
        status,
      }),
      /connection lost/u,
    );
    await journal.persist({ ...payload, id, status });
    await journal.complete({ ...payload, id, status });
  }
  const inspection = await journal.inspect();
  assert.deepEqual(
    inspection.operations.map((child) => child.records.at(-1).outcome),
    ["failed", "failed"],
  );
});

test("builder wrapper rejects mismatched operation, unsupported status and malformed payloads locally", async (t) => {
  const { withAllocatorLock } = hostFixture(t);
  const operationId = "validated-builder";
  const journal = createBuilderNotaryJournal(
    {},
    { operationId, withAllocatorLock },
  );
  const payload = {
    operationId,
    file: "Situate-app.zip",
    sha256: fragmentDigest,
    status: "submitting",
  };
  for (const change of [
    { operationId: "different" },
    { file: "../payload.zip" },
    { sha256: "short" },
    { status: "invented" },
    { status: "submitted", id: "invalid" },
  ])
    await assert.rejects(
      journal.persist({ ...payload, ...change }),
      /differs|Invalid/u,
    );
  await assert.rejects(journal.complete(payload), /status/u);
  assert.deepEqual((await journal.inspect()).operations, []);
});

test("release coordinator retains claims across processes and requires inspect-first explicit resume", async (t) => {
  const { root, withAllocatorLock } = hostFixture(t);
  const options = {
    operationId: "release-one",
    planDigest: fragmentDigest,
    sourceRevision: source,
    withAllocatorLock,
  };
  const first = createHostReleaseCoordinator({}, options);
  assert.equal((await first.claim()).durable, true);
  const journal = readFileSync(join(root, "release-operations.jsonl"), "utf8");
  const reopened = createHostReleaseCoordinator({}, options);
  await assert.rejects(reopened.claim(), /connection lost/u);
  await assert.rejects(reopened.claim({ resume: true }), /inspection first/u);
  const inspected = await reopened.inspect();
  assert.deepEqual(inspected.active, {
    operationId: "release-one",
    planDigest: fragmentDigest,
    sourceRevision: source,
  });
  assert.equal(
    readFileSync(join(root, "release-operations.jsonl"), "utf8"),
    journal,
  );
  assert.equal((await reopened.claim({ resume: true })).resumed, true);
  const competitor = createHostReleaseCoordinator(
    {},
    { ...options, operationId: "release-two" },
  );
  await assert.rejects(competitor.claim(), /connection lost/u);
  await assert.rejects(
    createHostReleaseCoordinator(
      {},
      { ...options, planDigest: generatedInputDigest },
    ).inspect(),
    /connection lost/u,
  );
  await reopened.complete();
  await competitor.claim();
  assert.equal((await competitor.inspect()).active.operationId, "release-two");
  await first.complete();
  assert.equal((await competitor.inspect()).active.operationId, "release-two");
  assert(
    readFileSync(join(root, "release-operations.jsonl"), "utf8").startsWith(
      journal,
    ),
  );
});

test("release coordinator rejects stale inspection and never permits two concurrent candidates", async (t) => {
  const { withAllocatorLock } = hostFixture(t);
  const options = {
    planDigest: fragmentDigest,
    sourceRevision: source,
    withAllocatorLock,
  };
  const a = createHostReleaseCoordinator({}, { ...options, operationId: "a" });
  const b = createHostReleaseCoordinator({}, { ...options, operationId: "b" });
  const outcomes = await Promise.allSettled([a.claim(), b.claim()]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  const winner = outcomes[0].status === "fulfilled" ? a : b;
  await winner.inspect();
  await winner.complete();
  await assert.rejects(winner.claim({ resume: true }), /connection lost/u);
});

test("unknown notary operations block new submissions until explicit reconciliation", async (t) => {
  const { withAllocatorLock } = hostFixture(t);
  const first = createHostNotaryJournal(
    {},
    { operationId: "one", withAllocatorLock },
  );
  const second = createHostNotaryJournal(
    {},
    { operationId: "two", withAllocatorLock },
  );
  await first.persist({ phase: "intent" });
  await first.complete({ outcome: "unknown" });
  await assert.rejects(second.persist({ phase: "intent" }), /connection lost/u);
  assert.equal((await first.inspect()).records.at(-1).outcome, "unknown");
  await first.complete({
    outcome: "failed",
    inspection: "authoritative absence",
  });
  await second.persist({ phase: "intent" });
});

test("interrupted append and symlink journals fail closed without erasing records", async (t) => {
  const { root, withAllocatorLock } = hostFixture(t);
  const journal = createHostNotaryJournal(
    {},
    { operationId: "one", withAllocatorLock },
  );
  writeFileSync(join(root, "release-notary-journal.jsonl"), '{"partial":');
  await assert.rejects(journal.inspect(), /connection lost/u);
  assert.equal(
    readFileSync(join(root, "release-notary-journal.jsonl"), "utf8"),
    '{"partial":',
  );
});

test("two reservations retain original source ancestry and strict migration checkpoint verification", async (t) => {
  const { root } = hostFixture(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  const directory = join(root, "client/crates/situate-migrations/src");
  mkdirSync(join(directory, "migrations"), { recursive: true });
  writeFileSync(
    join(directory, "registry.rs"),
    "pub const MIGRATIONS: &[MigrationDescriptor] = &[\nMigrationDescriptor::of::<migrations::m0001_initial::Migration>(),\n];\n",
  );
  writeFileSync(
    join(directory, "migrations/mod.rs"),
    "pub(crate) mod m0001_initial;\n",
  );
  writeFileSync(
    join(directory, "migrations/m0001_initial.rs"),
    "pub struct Migration;\n",
  );
  git("add", "client");
  git("commit", "-qm", "feat: initial fixture");
  const firstSource = git("rev-parse", "HEAD");
  const adapter = memoryAdapter(),
    memoryCreate = adapter.createAnnotatedTag;
  adapter.createAnnotatedTag = async (value) => {
    git("tag", "-a", value.tag, value.sourceRevision, "-m", value.annotation);
    await memoryCreate(value);
  };
  const first = (
    await reserveRelease({ ...request(), sourceRevision: firstSource }, adapter)
  ).reservation;
  const release = {
    version: first.version,
    revision: firstSource,
    manifestSha256: createHash("sha256")
      .update("fixture manifest")
      .digest("hex"),
  };
  mkdirSync(join(root, "releases"));
  writeFileSync(
    join(root, "releases/migration-checkpoint.json"),
    JSON.stringify({ schemaVersion: 1, release }),
  );
  git("add", "releases");
  git("commit", "-qm", "chore: retain checkpoint");
  const secondSource = git("rev-parse", "HEAD");
  const second = (
    await reserveRelease(
      { ...request("second"), sourceRevision: secondSource },
      adapter,
    )
  ).reservation;
  assert.equal(git("rev-parse", `${first.tag}^{commit}`), firstSource);
  assert.equal(git("rev-parse", `${second.tag}^{commit}`), secondSource);
  assert.equal(git("rev-list", "--count", "HEAD"), "2");
  git("merge-base", "--is-ancestor", firstSource, secondSource);
  const history = {
    schemaVersion: 1,
    releases: [release],
    qualifications: [
      {
        release,
        qualification: {
          schemaVersion: 1,
          source: "macos-direct-publication",
          releases: [],
          migrations: 1,
        },
      },
    ],
  };
  assert.equal(
    qualifyPublishedMigrations(root, { revision: secondSource, history })
      .migrations,
    1,
  );
  writeFileSync(
    join(directory, "migrations/m0001_initial.rs"),
    "pub struct Changed;\n",
  );
  git("add", "client");
  git("commit", "-qm", "test: change published migration");
  assert.throws(
    () => qualifyPublishedMigrations(root, { revision: "HEAD", history }),
    /Published migration changed/u,
  );
});
