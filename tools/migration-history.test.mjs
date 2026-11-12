import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
