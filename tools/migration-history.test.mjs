import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { legacyEvidencePath } from "./legacy-migration-evidence.mjs";
import test from "node:test";
import {
  qualifyMigrationHistory,
  verifyMigrationHistory,
} from "./migration-history.mjs";

const source = "client/crates/situate-migrations/src/";
const names = ["m0001_metadata", "m0002_history"];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "migration-history-"));
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
  const registry = (entries) =>
    put(
      `${source}registry.rs`,
      `pub const MIGRATIONS: &[MigrationDescriptor] = &[\n${entries.map((name) => `    MigrationDescriptor::of::<migrations::${name}::Migration>(),`).join("\n")}\n];\n`,
    );
  const migrations = (entries) => {
    registry(entries);
    put(
      `${source}migrations/mod.rs`,
      entries.map((name) => `pub(crate) mod ${name};\n`).join(""),
    );
    for (const name of entries)
      put(
        `${source}migrations/${name}.rs`,
        `// ${name}\npub struct Migration;\n`,
      );
  };
  put("legacy.txt", "legacy release\n");
  const legacy = commit();
  return { root, git, put, commit, registry, migrations, legacy };
}

test("released files and registry prefix permit only append-only evolution", (t) => {
  const f = fixture(t);
  f.migrations(names.slice(0, 1));
  const publishedRevision = f.commit();
  f.migrations(names);
  f.commit();
  assert.deepEqual(verifyMigrationHistory(f.root, { publishedRevision }), {
    publishedRevision,
    releasedMigrations: 1,
    migrations: 2,
  });
  f.registry([...names].reverse());
  f.commit();
  assert.throws(
    () => verifyMigrationHistory(f.root, { publishedRevision }),
    /registry prefix changed/u,
  );
});

test("published module order remains immutable after append-only evolution", (t) => {
  const f = fixture(t);
  f.migrations(names);
  const publishedRevision = f.commit();
  f.put(
    `${source}migrations/mod.rs`,
    [...names]
      .reverse()
      .map((name) => `pub(crate) mod ${name};\n`)
      .join(""),
  );
  f.commit();
  assert.throws(
    () => verifyMigrationHistory(f.root, { publishedRevision }),
    /module prefix changed/u,
  );
});

test("qualification rejects edited, deleted and renamed released implementations", async (t) => {
  for (const change of ["edit", "delete", "rename"])
    await t.test(change, (t) => {
      const f = fixture(t);
      f.migrations(names.slice(0, 1));
      const publishedRevision = f.commit();
      if (change === "edit")
        f.put(`${source}migrations/${names[0]}.rs`, "pub struct Changed;\n");
      else {
        rmSync(join(f.root, `${source}migrations/${names[0]}.rs`));
        f.migrations(change === "rename" ? [names[1]] : []);
      }
      f.commit();
      assert.throws(
        () => verifyMigrationHistory(f.root, { publishedRevision }),
        /Published migration changed or disappeared/u,
      );
    });
});

test("pre-migration published commit establishes an empty prefix, never an implicit baseline", (t) => {
  const f = fixture(t);
  assert.deepEqual(qualifyMigrationHistory(f.root, {}), {
    status: "not-applicable",
    migrations: 0,
  });
  assert.throws(
    () => verifyMigrationHistory(f.root),
    /explicit full published Git commit/u,
  );
  f.migrations(names.slice(0, 1));
  f.commit();
  assert.throws(
    () => qualifyMigrationHistory(f.root),
    /explicit full published Git commit/u,
  );
  assert.equal(
    verifyMigrationHistory(f.root, { publishedRevision: f.legacy })
      .releasedMigrations,
    0,
  );
  for (const publishedRevision of ["HEAD", "", "a".repeat(40)])
    assert.throws(() => verifyMigrationHistory(f.root, { publishedRevision }));
});

test("unsupported or inconsistent source declarations fail closed", async (t) => {
  for (const variant of ["registry", "duplicate", "unregistered", "module"])
    await t.test(variant, (t) => {
      const f = fixture(t);
      f.migrations(names.slice(0, 1));
      if (variant === "registry")
        f.put(
          `${source}registry.rs`,
          "pub const MIGRATIONS: &[MigrationDescriptor] = make_registry!();\n",
        );
      if (variant === "duplicate") f.registry([names[0], names[0]]);
      if (variant === "unregistered")
        f.put(`${source}migrations/${names[1]}.rs`, "pub struct Migration;\n");
      if (variant === "module")
        f.put(
          `${source}migrations/mod.rs`,
          `#[path = "other.rs"]\npub(crate) mod ${names[0]};\n`,
        );
      f.commit();
      assert.throws(
        () => verifyMigrationHistory(f.root, { publishedRevision: f.legacy }),
        /Unsupported|must name every/u,
      );
    });
});

const legacyRecord = () => ({
  version: "0.1.5",
  revision: "6c310a75ecd7d38ff9b4dcf94ba042580f2b68fa",
  manifestSha256: "c".repeat(64),
  migrations: { implementations: [], entries: [], modules: [] },
});

function legacyOptions(record = legacyRecord()) {
  return {
    publishedRevision: record.revision,
    publishedVersion: record.version,
    publishedManifestSha256: record.manifestSha256,
  };
}

test("exact committed legacy publication evidence qualifies without old objects or remotes", (t) => {
  const f = fixture(t);
  const record = legacyRecord();
  const bytes = JSON.stringify({ schemaVersion: 1, releases: [record] });
  f.put(legacyEvidencePath, bytes);
  f.migrations(names);
  f.commit();
  assert.throws(() => f.git("cat-file", "-t", record.revision));
  assert.equal(f.git("remote"), "");
  assert.deepEqual(verifyMigrationHistory(f.root, legacyOptions()), {
    publishedRevision: record.revision,
    releasedMigrations: 0,
    migrations: 2,
    legacyEvidence: {
      version: record.version,
      manifestSha256: record.manifestSha256,
      evidenceSha256: createHash("sha256").update(bytes).digest("hex"),
    },
  });
  assert.deepEqual(
    qualifyMigrationHistory(f.root, {
      environment: {
        SITUATE_MIGRATIONS_PUBLISHED_REVISION: record.revision,
        SITUATE_MIGRATIONS_PUBLISHED_VERSION: record.version,
        SITUATE_MIGRATIONS_PUBLISHED_MANIFEST_SHA256: record.manifestSha256,
      },
    }),
    verifyMigrationHistory(f.root, legacyOptions()),
  );
  f.put(legacyEvidencePath, "uncommitted tampering");
  assert.equal(verifyMigrationHistory(f.root, legacyOptions()).migrations, 2);
});

test("legacy evidence cannot infer identity, use note-analysis revisions or qualify missing records", (t) => {
  const f = fixture(t);
  f.migrations(names);
  f.commit();
  assert.throws(
    () => verifyMigrationHistory(f.root, legacyOptions()),
    /Missing committed legacy/u,
  );
  f.put(
    legacyEvidencePath,
    JSON.stringify({ schemaVersion: 1, releases: [legacyRecord()] }),
  );
  f.commit();
  for (const options of [
    { publishedVersion: undefined },
    { publishedVersion: "0.1.4" },
    { publishedManifestSha256: undefined },
    { publishedManifestSha256: "d".repeat(64) },
    { publishedRevision: "a8ed3f0a5edf15affb0c1759f7b6a88a62f1c7c6" },
    { publishedRevision: "a".repeat(40) },
  ])
    assert.throws(() =>
      verifyMigrationHistory(f.root, { ...legacyOptions(), ...options }),
    );
  f.put(`${source}registry.rs`, "unsupported registry\n");
  f.commit();
  assert.throws(
    () => verifyMigrationHistory(f.root, legacyOptions()),
    /Unsupported/u,
  );
});

test("malformed and unaudited legacy inventories fail closed", async (t) => {
  for (const change of [
    "empty",
    "duplicate",
    "version",
    "revision",
    "manifest",
    "implementation",
    "entry",
    "module",
    "schema",
    "extra",
  ])
    await t.test(change, (t) => {
      const f = fixture(t);
      const record = legacyRecord();
      const evidence = { schemaVersion: 1, releases: [record] };
      if (change === "empty") evidence.releases = [];
      if (change === "duplicate") evidence.releases.push(record);
      if (change === "version") record.version = "0.1.4";
      if (change === "revision") record.revision = "a".repeat(40);
      if (change === "manifest") record.manifestSha256 = "invalid";
      if (change === "implementation")
        record.migrations.implementations.push({
          path: "m0001_metadata.rs",
          sha256: "a".repeat(64),
        });
      if (change === "entry") record.migrations.entries.push("m0001_metadata");
      if (change === "module") record.migrations.modules.push("m0001_metadata");
      if (change === "schema") evidence.schemaVersion = 2;
      if (change === "extra") evidence.unreviewed = true;
      f.put(legacyEvidencePath, JSON.stringify(evidence));
      f.commit();
      assert.throws(() => verifyMigrationHistory(f.root, legacyOptions()));
    });
});

test("baseline must be an ancestor and local history checking never fetches", (t) => {
  const f = fixture(t);
  f.migrations(names.slice(0, 1));
  const publishedRevision = f.commit();
  f.git("checkout", "--orphan", "unrelated");
  f.git("rm", "-rf", ".");
  f.put("unrelated.txt", "unrelated\n");
  f.commit();
  assert.throws(() => verifyMigrationHistory(f.root, { publishedRevision }));
});
