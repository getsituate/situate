#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const directory = "client/crates/situate-migrations/src/";
const registryPath = `${directory}registry.rs`;
const migrationsPath = `${directory}migrations/`;
const fullRevision = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_NO_LAZY_FETCH: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function migrationRevision(root, revision = "HEAD") {
  const resolved = git(root, [
    "rev-parse",
    "--verify",
    `${revision}^{commit}`,
  ]).trim();
  assert(fullRevision.test(resolved), "Invalid migration candidate revision");
  return resolved;
}

export function migrationInventory(root, revision) {
  const tree = git(root, ["ls-tree", "-r", "-z", revision, "--", directory]);
  const files = new Map(
    tree
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const [metadata, file] = entry.split("\t");
        const [mode, type, oid] = metadata.split(" ");
        assert(
          mode === "100644" && type === "blob",
          `Unsupported migration source: ${file}`,
        );
        return [file, oid];
      }),
  );
  const implementations = [...files.keys()]
    .filter(
      (file) =>
        file.startsWith(migrationsPath) && file !== `${migrationsPath}mod.rs`,
    )
    .sort();
  for (const file of implementations)
    assert(
      /^m[0-9]{4}_[a-z0-9_]+\.rs$/u.test(file.slice(migrationsPath.length)),
      `Unsupported migration filename: ${file}`,
    );
  if (!files.has(registryPath)) {
    assert(implementations.length === 0, "Missing migration registry");
    return { files, implementations, entries: [], modules: [] };
  }
  const read = (file) => git(root, ["cat-file", "blob", `${revision}:${file}`]);
  const source = read(registryPath);
  const declarations = [
    ...source.matchAll(
      /pub const MIGRATIONS: &\[MigrationDescriptor\] = &\[([\s\S]*?)\];/gu,
    ),
  ];
  assert(
    declarations.length === 1,
    "Unsupported MIGRATIONS registry declaration",
  );
  const body = declarations[0][1];
  const entryPattern =
    /MigrationDescriptor::of::<migrations::(m[0-9]{4}_[a-z0-9_]+)::Migration>\(\),/gu;
  const entries = [...body.matchAll(entryPattern)];
  assert(
    body.replace(entryPattern, "").trim() === "",
    "Unsupported migration registry entry syntax",
  );
  assert.deepEqual(
    entries.map((entry) => `${migrationsPath}${entry[1]}.rs`).sort(),
    implementations,
    "Migration registry must name every implementation exactly once",
  );
  const moduleSource = read(`${migrationsPath}mod.rs`);
  const modulePattern = /pub\(crate\) mod (m[0-9]{4}_[a-z0-9_]+);/gu;
  const modules = [...moduleSource.matchAll(modulePattern)];
  assert(
    moduleSource.replace(modulePattern, "").trim() === "",
    "Unsupported migration module declaration syntax",
  );
  assert.deepEqual(
    modules.map((entry) => entry[1]).sort(),
    entries.map((entry) => entry[1]).sort(),
    "Migration modules must match the registry",
  );
  return {
    files,
    implementations,
    entries: entries.map((entry) => entry[0]),
    modules: modules.map((entry) => entry[0]),
  };
}

export function verifyMigrationHistory(
  root,
  { publishedRevision, revision = "HEAD" } = {},
) {
  assert(
    typeof publishedRevision === "string" &&
      fullRevision.test(publishedRevision),
    "Migration qualification requires an explicit full published Git commit: SITUATE_MIGRATIONS_PUBLISHED_REVISION",
  );
  const candidate = migrationRevision(root, revision);
  for (const at of [publishedRevision, candidate]) {
    let type;
    try {
      type = git(root, ["cat-file", "-t", at]).trim();
    } catch {
      /* Missing local history must not trigger an implicit fetch. */
    }
    assert(type === "commit", `Missing local migration history commit: ${at}`);
  }
  git(root, ["merge-base", "--is-ancestor", publishedRevision, revision]);
  const published = migrationInventory(root, publishedRevision);
  const current = migrationInventory(root, revision);
  for (const file of published.implementations)
    assert.equal(
      current.files.get(file),
      published.files.get(file),
      `Published migration changed or disappeared: ${file}`,
    );
  assert.deepEqual(
    current.entries.slice(0, published.entries.length),
    published.entries,
    "Published migration registry prefix changed",
  );
  assert.deepEqual(
    current.modules.slice(0, published.modules.length),
    published.modules,
    "Published migration module prefix changed",
  );
  return {
    publishedRevision,
    releasedMigrations: published.entries.length,
    migrations: current.entries.length,
  };
}

export function qualifyMigrationHistory(
  root,
  {
    environment = process.env,
    publishedRevision = environment.SITUATE_MIGRATIONS_PUBLISHED_REVISION,
  } = {},
) {
  const current = migrationInventory(root, "HEAD");
  if (publishedRevision === undefined && current.entries.length === 0)
    return { status: "not-applicable", migrations: 0 };
  return verifyMigrationHistory(root, {
    publishedRevision,
  });
}

export function main(args = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({
      args,
      options: {
        "published-revision": { type: "string" },
        revision: { type: "string" },
      },
    });
    console.log(
      JSON.stringify(
        verifyMigrationHistory(process.cwd(), {
          publishedRevision:
            values["published-revision"] ??
            process.env.SITUATE_MIGRATIONS_PUBLISHED_REVISION,
          revision: values.revision,
        }),
      ),
    );
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = main();
