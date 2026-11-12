import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { qualifyPublishedMigrations } from "./published-migrations.mjs";
import { readPublicationHistory } from "../infrastructure/releases/transport.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "published-migrations-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Migration Test");
  git("config", "user.email", "migration@example.invalid");
  const put = (file, bytes) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), bytes);
  };
  const commit = () => {
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "test: snapshot");
    return git("rev-parse", "HEAD");
  };
  const source = "client/crates/situate-migrations/src/";
  const migrations = (names) => {
    put(
      `${source}registry.rs`,
      `pub const MIGRATIONS: &[MigrationDescriptor] = &[\n${names.map((name) => `    MigrationDescriptor::of::<migrations::${name}::Migration>(),`).join("\n")}\n];\n`,
    );
    put(
      `${source}migrations/mod.rs`,
      names.map((name) => `pub(crate) mod ${name};\n`).join(""),
    );
    for (const name of names)
      put(`${source}migrations/${name}.rs`, "pub struct Migration;\n");
  };
  put("legacy.txt", "legacy\n");
  const legacy = commit();
  const record = (version, revision) => ({
    version,
    revision,
    manifestSha256: "a".repeat(64),
  });
  const history = (releases) => ({ schemaVersion: 1, releases });
  return {
    root,
    git,
    put,
    commit,
    source,
    migrations,
    legacy,
    record,
    history,
  };
}

test("publication history protects every released prefix and records exact comparison commits", (t) => {
  const f = fixture(t);
  f.migrations(["m0001_metadata"]);
  const first = f.commit();
  f.migrations(["m0001_metadata", "m0002_history"]);
  const second = f.commit();
  const releases = [f.record("0.1.0", f.legacy), f.record("0.2.0", first)];
  const result = qualifyPublishedMigrations(f.root, {
    history: f.history(releases),
  });
  assert.deepEqual(result, {
    schemaVersion: 1,
    source: "macos-direct-publication",
    releases,
    migrations: 2,
  });
  f.put(
    `${f.source}migrations/m0002_history.rs`,
    "// changed after publication\npub struct Migration;\n",
  );
  f.commit();
  assert.throws(
    () =>
      qualifyPublishedMigrations(f.root, {
        history: f.history([...releases, f.record("0.3.0", second)]),
      }),
    /Published migration changed/u,
  );
  // Publication verifies the artifact commit, not the invoking checkout.
  assert.equal(
    qualifyPublishedMigrations(f.root, {
      revision: second,
      history: f.history([...releases, f.record("0.3.0", second)]),
    }).migrations,
    2,
  );
});

function checkpointFixture(t) {
  const f = fixture(t);
  const predecessor = f.record("0.1.0", "c".repeat(40));
  f.migrations(["m0001_metadata"]);
  const artifact = f.commit();
  const checkpoint = f.record("0.2.0", artifact);
  const pin = { schemaVersion: 1, release: checkpoint };
  f.put("releases/migration-checkpoint.json", JSON.stringify(pin));
  f.commit();
  const proof = {
    release: { ...checkpoint },
    qualification: {
      schemaVersion: 1,
      source: "macos-direct-publication",
      releases: [{ ...predecessor }],
      migrations: 1,
      legacyEvidenceSha256: "retained unknown field",
    },
  };
  const history = {
    ...f.history([predecessor, checkpoint]),
    qualifications: [proof],
  };
  return { ...f, predecessor, artifact, checkpoint, history };
}

test("committed tool checkpoint qualifies an older artifact and retains the complete race baseline", (t) => {
  const f = checkpointFixture(t);
  assert.throws(() => f.git("cat-file", "-t", f.predecessor.revision));
  assert.throws(() =>
    f.git("show", `${f.artifact}:releases/migration-checkpoint.json`),
  );
  f.put("releases/migration-checkpoint.json", "uncommitted tampering");
  const result = qualifyPublishedMigrations(f.root, {
    revision: f.artifact,
    history: f.history,
  });
  assert.deepEqual(result, {
    schemaVersion: 1,
    source: "macos-direct-publication",
    checkpoint: f.checkpoint,
    releases: f.history.releases,
    migrations: 1,
  });
});

test("checkpoint proof rejects missing, altered, duplicate, forward and unknown publication evidence", async (t) => {
  const changes = {
    empty: (h) => {
      h.releases = [];
    },
    missingCheckpoint: (h) => {
      h.releases.pop();
    },
    missingPredecessor: (h) => {
      h.releases.shift();
    },
    alteredHash: (h) => {
      h.releases[0].manifestSha256 = "d".repeat(64);
    },
    alteredCheckpoint: (h) => {
      h.releases[1].manifestSha256 = "d".repeat(64);
    },
    missingHash: (h) => {
      delete h.qualifications[0].qualification.releases[0].manifestSha256;
    },
    missingProof: (h) => {
      delete h.qualifications;
    },
    duplicateProof: (h) => {
      h.qualifications.push(h.qualifications[0]);
    },
    unboundProof: (h) => {
      h.qualifications[0].release.manifestSha256 = "d".repeat(64);
    },
    wrongSchema: (h) => {
      h.qualifications[0].qualification.schemaVersion = 2;
    },
    wrongSource: (h) => {
      h.qualifications[0].qualification.source = "external";
    },
    wrongCount: (h) => {
      h.qualifications[0].qualification.migrations = 0;
    },
    duplicateCoverage: (h) => {
      h.qualifications[0].qualification.releases.push(h.releases[0]);
    },
    cycle: (h) => {
      h.qualifications[0].qualification.releases = [h.releases[1]];
    },
    forward: (h) => {
      h.qualifications[0].qualification.releases = [
        {
          version: "0.3.0",
          revision: "d".repeat(40),
          manifestSha256: "d".repeat(64),
        },
      ];
    },
    unknown: (h) => {
      h.releases.push({
        version: "0.0.9",
        revision: "d".repeat(40),
        manifestSha256: "d".repeat(64),
      });
    },
    duplicateRecord: (h) => {
      h.releases.push(h.releases[0]);
    },
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, (t) => {
      const f = checkpointFixture(t);
      const history = structuredClone(f.history);
      change(history);
      assert.throws(() => qualifyPublishedMigrations(f.root, { history }));
    });
});

test("uncommitted pins cannot cover missing objects and malformed committed pins fail closed", (t) => {
  const f = fixture(t);
  const checkpoint = f.record("0.2.0", f.legacy);
  f.put(
    "releases/migration-checkpoint.json",
    JSON.stringify({ schemaVersion: 1, release: checkpoint }),
  );
  const history = f.history([f.record("0.1.0", "d".repeat(40)), checkpoint]);
  assert.throws(
    () => qualifyPublishedMigrations(f.root, { history }),
    /Missing local migration history commit/u,
  );
  f.put(
    "releases/migration-checkpoint.json",
    JSON.stringify({ schemaVersion: 2, release: checkpoint }),
  );
  f.commit();
  assert.throws(
    () => qualifyPublishedMigrations(f.root, { history }),
    /Invalid migration checkpoint/u,
  );
});

test("checkpoint and subsequent releases keep ordinary ancestry and immutable byte checks", (t) => {
  const f = checkpointFixture(t);
  f.migrations(["m0001_metadata", "m0002_history"]);
  const later = f.commit();
  f.history.releases.push(f.record("0.3.0", later));
  assert.equal(
    qualifyPublishedMigrations(f.root, { history: f.history }).migrations,
    2,
  );
  f.put(`${f.source}migrations/m0002_history.rs`, "changed\n");
  f.commit();
  assert.throws(
    () => qualifyPublishedMigrations(f.root, { history: f.history }),
    /Published migration changed/u,
  );
  f.git("checkout", "--orphan", "unrelated");
  f.git("rm", "-rf", ".");
  f.put(
    "releases/migration-checkpoint.json",
    JSON.stringify({ schemaVersion: 1, release: f.checkpoint }),
  );
  f.commit();
  assert.throws(() =>
    qualifyPublishedMigrations(f.root, { history: f.history }),
  );
});

test("an empty server bootstraps automatically, but invalid history never becomes an empty baseline", (t) => {
  const f = fixture(t);
  f.migrations(["m0001_metadata"]);
  f.commit();
  assert.deepEqual(
    qualifyPublishedMigrations(f.root, { history: f.history([]) }).releases,
    [],
  );
  for (const history of [
    {},
    { schemaVersion: 1 },
    f.history([f.record("0.1.0", "HEAD")]),
    f.history([f.record("0.1.0", f.legacy), f.record("0.1.0", f.legacy)]),
  ])
    assert.throws(
      () => qualifyPublishedMigrations(f.root, { history }),
      /Invalid/u,
    );
  assert.throws(
    () =>
      qualifyPublishedMigrations(f.root, {
        history: f.history([f.record("0.1.0", "b".repeat(40))]),
      }),
    /Missing local migration history commit/u,
  );
  assert.throws(
    () =>
      qualifyPublishedMigrations(f.root, {
        readHistory() {
          throw new Error("offline");
        },
      }),
    /offline/u,
  );
});

test("history uses root dotenv as data and preserves explicit empty and CI settings", (t) => {
  const f = fixture(t);
  f.put(
    ".env",
    "WEBSITE_DEPLOY_HOST=dotenv.example.invalid\nWEBSITE_SSH_IDENTITY=/synthetic/key\nUNRELATED_SECRET=not-forwarded\n",
  );
  chmodSync(join(f.root, ".env"), 0o600);
  const execute = (command, args, options) => {
    assert.equal(args.at(-2), "dotenv.example.invalid");
    assert.ok(args.includes("/synthetic/key"));
    assert.equal(options.env.UNRELATED_SECRET, undefined);
    return JSON.stringify(f.history([]));
  };
  assert.deepEqual(
    readPublicationHistory(f.root, {
      environment: { HOME: f.root, PATH: "/usr/bin" },
      execute,
    }).releases,
    [],
  );
  assert.throws(
    () =>
      readPublicationHistory(f.root, {
        environment: { WEBSITE_DEPLOY_HOST: "" },
        execute,
      }),
    /Set WEBSITE_DEPLOY_HOST/u,
  );
  assert.throws(
    () => readPublicationHistory(f.root, { environment: { CI: "1" }, execute }),
    /Set WEBSITE_DEPLOY_HOST/u,
  );
});

test("history SSH uses verified hosts, one bounded attempt and no ambient secrets", (t) => {
  const f = fixture(t);
  const environment = {
    CI: "1",
    WEBSITE_DEPLOY_HOST: "release.example.invalid",
    PATH: "/usr/bin",
    HOME: f.root,
    SSH_AUTH_SOCK: "/synthetic/socket",
    SECRET: "not-forwarded",
  };
  const output = f.history([]);
  const execute = (command, args, options) => {
    assert.equal(command, "ssh");
    assert.ok(args.includes("StrictHostKeyChecking=yes"));
    assert.ok(args.includes("ConnectionAttempts=1"));
    assert.ok(args.at(-1).includes(" history "));
    assert.equal(options.timeout, 30000);
    assert.equal(options.env.SECRET, undefined);
    assert.equal(options.env.WEBSITE_DEPLOY_HOST, undefined);
    assert.equal(options.env.SSH_AUTH_SOCK, environment.SSH_AUTH_SOCK);
    return JSON.stringify(output);
  };
  assert.deepEqual(
    readPublicationHistory(f.root, { environment, execute }),
    output,
  );
  assert.throws(
    () =>
      readPublicationHistory(f.root, {
        environment: { ...environment, WEBSITE_DEPLOY_HOST: "" },
        execute,
      }),
    /Set WEBSITE_DEPLOY_HOST/u,
  );
  assert.throws(
    () =>
      readPublicationHistory(f.root, {
        environment,
        execute() {
          throw new Error("private SSH diagnostic");
        },
      }),
    (error) =>
      /Cannot read published/.test(error.message) &&
      !error.message.includes("private SSH diagnostic"),
  );
  assert.throws(
    () =>
      readPublicationHistory(f.root, {
        environment,
        execute() {
          return "invalid";
        },
      }),
    /invalid publication history/u,
  );
});
