import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { digest } from "./release-catalog.mjs";
import {
  collectFragments,
  runFragmentCli,
  validateFragment,
  validateFragmentRange,
} from "./change-fragments.mjs";

const locales = ["en", "de"];
function draft(id = "test-change", empty = false) {
  const entries = empty
    ? []
    : [
        {
          id: "navigation",
          type: "fixed",
          platforms: ["macos"],
          title: "Navigation",
          paragraphs: ["Recent files open in the selected pane."],
        },
      ];
  return {
    schemaVersion: 2,
    id,
    locales: Object.fromEntries(
      locales.map((locale) => [
        locale,
        { title: "Changes", entries: structuredClone(entries) },
      ]),
    ),
    ...(empty ? { emptyReason: "Internal test tooling only." } : {}),
  };
}
function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "situate-fragments-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Test Author");
  git("config", "user.email", "test@example.invalid");
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  write(
    "client/packages/localization/locales.json",
    JSON.stringify({ source: "en", locales }),
  );
  write("app.txt", "initial");
  const commit = () => {
    git("add", ".");
    git("commit", "-qm", "test: fixture");
    return git("rev-parse", "HEAD");
  };
  return { root, git, write, commit, base: commit() };
}

test("empty reasons are mandatory and locale completeness follows the inventory", () => {
  const value = draft("empty", true);
  assert.doesNotThrow(() => validateFragment(value, { locales }));
  delete value.emptyReason;
  assert.throws(
    () => validateFragment(value, { locales }),
    /nonempty plain text/,
  );
  const extra = draft();
  extra.locales.fr = structuredClone(extra.locales.en);
  assert.doesNotThrow(() =>
    validateFragment(extra, {
      locales: [...locales, "fr"],
    }),
  );
  assert.throws(() => validateFragment(extra, { locales }), /Unexpected/);
  extra.locales.de.entries[0].platforms = ["ios"];
  assert.throws(
    () =>
      validateFragment(extra, {
        locales: [...locales, "fr"],
      }),
    /preserve entry/,
  );
});

test("Git ranges require new immutable declarations, ancestry and historical catalog immutability", (t) => {
  const repo = repository(t);
  const value = draft();
  repo.write("changes/test-change.json", JSON.stringify(value));
  const head = repo.commit();
  assert.deepEqual(
    validateFragmentRange(repo.root, { base: repo.base, head }).map(
      (item) => item.id,
    ),
    ["test-change"],
  );
  assert.throws(
    () => validateFragmentRange(repo.root, { base: head, head }),
    /requires a new declaration/,
  );
  repo.write("app.txt", "changed after review");
  const changed = repo.commit();
  assert.equal(
    validateFragmentRange(repo.root, { base: repo.base, head: changed }).length,
    1,
  );
  repo.write(
    "changes/test-change.json",
    JSON.stringify(draft("test-change", true)),
  );
  const amended = repo.commit();
  assert.throws(
    () => collectFragments(repo.root, { base: head, head: amended }),
    /immutable/,
  );
  repo.git("checkout", "--detach", head);
  repo.write("releases/0.1.6/release.json", "{}");
  const historic = repo.commit();
  assert.throws(
    () => collectFragments(repo.root, { base: head, head: historic }),
    /historical catalogs/,
  );
  assert.throws(() =>
    collectFragments(repo.root, { base: amended, head: historic }),
  );
  assert.throws(() =>
    collectFragments(repo.root, { base: "f".repeat(40), head: historic }),
  );
});

test("only content-preserving upgrades of legacy declarations are allowed", (t) => {
  const repo = repository(t);
  const file = "changes/test-change.json";
  const value = draft();
  const legacyBytes = JSON.stringify({
    ...value,
    schemaVersion: 1,
    behaviorDigest: "a".repeat(64),
    sourceApproval: { action: "approve", sourceHash: "b".repeat(64) },
    translationApprovals: {
      de: { sourceHash: "b".repeat(64), translationHash: "c".repeat(64) },
    },
  });
  repo.write(file, legacyBytes);
  const legacy = repo.commit();
  assert.throws(
    () => validateFragmentRange(repo.root, { base: repo.base, head: legacy }),
    /Unexpected fragment fields/,
  );
  assert.deepEqual(
    collectFragments(repo.root, { base: repo.base, head: legacy }),
    [
      {
        id: value.id,
        path: file,
        sha256: digest(legacyBytes),
        fragment: value,
      },
    ],
  );

  repo.write(file, JSON.stringify(value));
  const upgraded = repo.commit();
  assert.deepEqual(
    collectFragments(repo.root, { base: legacy, head: upgraded }),
    [],
  );
  assert.throws(
    () => validateFragmentRange(repo.root, { base: legacy, head: upgraded }),
    /requires a new declaration/,
  );

  repo.write("changes/tooling.json", JSON.stringify(draft("tooling", true)));
  const head = repo.commit();
  assert.deepEqual(
    validateFragmentRange(repo.root, { base: legacy, head }).map(
      ({ id }) => id,
    ),
    ["tooling"],
  );
  assert.deepEqual(
    collectFragments(repo.root, { base: repo.base, head }).map(({ id }) => id),
    ["test-change", "tooling"],
  );

  value.locales.de.entries[0].title = "Changed translation";
  repo.write(file, JSON.stringify(value));
  const edited = repo.commit();
  for (const base of [legacy, upgraded]) {
    assert.throws(
      () => collectFragments(repo.root, { base, head: edited }),
      /immutable/,
    );
  }
});

test("release collection crosses migration metadata replacement but keeps catalogs immutable", (t) => {
  const repo = repository(t);
  repo.write("releases/legacy-migration-evidence.json", "{}");
  repo.write("releases/0.1.6/release.json", "{}");
  repo.write(
    "client/packages/localization/src/catalogs/releases/0.1.6/en.json",
    "{}",
  );
  const baseline = repo.commit();
  repo.git("rm", "releases/legacy-migration-evidence.json");
  repo.write(
    "releases/migration-checkpoint.json",
    JSON.stringify({ release: { revision: baseline } }),
  );
  repo.commit();
  const value = draft("migration-metadata", true);
  repo.write("changes/migration-metadata.json", JSON.stringify(value));
  const head = repo.commit();
  assert.deepEqual(
    collectFragments(repo.root, { base: baseline, head }).map(
      (item) => item.id,
    ),
    ["migration-metadata"],
  );
  assert.throws(
    () => validateFragmentRange(repo.root, { base: baseline, head }),
    /historical catalogs/,
  );
  for (const file of [
    "releases/0.1.6/release.json",
    "releases/0.1.7/release.json",
    "client/packages/localization/src/catalogs/releases/0.1.6/en.json",
    "releases/other-metadata.json",
  ]) {
    repo.git("checkout", "--detach", head);
    repo.write(file, '{"changed":true}');
    const changed = repo.commit();
    assert.throws(
      () => collectFragments(repo.root, { base: baseline, head: changed }),
      /historical catalogs/,
      file,
    );
  }
});

test("concurrent PRs use independent IDs and assembly retains both declarations", (t) => {
  const repo = repository(t);
  for (const id of ["change-alpha", "change-beta"]) {
    repo.git("checkout", "--detach", repo.base);
    const value = draft(id, true);
    repo.write(`changes/${id}.json`, JSON.stringify(value));
    const head = repo.commit();
    assert.equal(
      validateFragmentRange(repo.root, { base: repo.base, head })[0].id,
      id,
    );
    repo[id] = head;
  }
  repo.git("cherry-pick", repo["change-alpha"]);
  const head = repo.git("rev-parse", "HEAD");
  assert.deepEqual(
    collectFragments(repo.root, { base: repo.base, head }).map(
      (item) => item.id,
    ),
    ["change-alpha", "change-beta"],
  );
});

test("range validation rejects reused identities, missing locales, symlinks and shallow history", (t) => {
  const repo = repository(t);
  const value = draft();
  repo.write("changes/different-name.json", JSON.stringify(value));
  let head = repo.commit();
  assert.throws(
    () => validateFragmentRange(repo.root, { base: repo.base, head }),
    /filename and ID/,
  );
  fs.rmSync(path.join(repo.root, "changes/different-name.json"));
  const missing = structuredClone(value);
  delete missing.locales.de;
  repo.write("changes/test-change.json", JSON.stringify(missing));
  head = repo.commit();
  assert.throws(
    () => validateFragmentRange(repo.root, { base: repo.base, head }),
    /Unexpected fragment fields/,
  );
  fs.rmSync(path.join(repo.root, "changes/test-change.json"));
  fs.symlinkSync(
    "../app.txt",
    path.join(repo.root, "changes/test-change.json"),
  );
  head = repo.commit();
  assert.throws(
    () => validateFragmentRange(repo.root, { base: repo.base, head }),
    /file type/,
  );
  const clone = `${repo.root}-shallow`;
  t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
  execFileSync(
    "git",
    ["clone", "--quiet", "--depth", "1", `file://${repo.root}`, clone],
    { stdio: "pipe" },
  );
  assert.throws(
    () => collectFragments(clone, { base: head, head }),
    /Complete Git history/,
  );
});

test("CLI authors versionless declarations and validates them without approval", (t) => {
  const repo = repository(t);
  const authored = runFragmentCli(
    ["author", "--id", "tooling", "--reason", "Test runner maintenance."],
    repo.root,
  );
  assert.deepEqual(
    runFragmentCli(["validate", "--id", "tooling"], repo.root),
    authored,
  );
  const input = path.join(repo.root, "localized.json");
  repo.write("localized.json", JSON.stringify(draft().locales));
  assert.deepEqual(
    runFragmentCli(
      ["author", "--id", "navigation", "--input", input],
      repo.root,
    ),
    { id: "navigation" },
  );
  const head = repo.commit();
  assert.deepEqual(
    runFragmentCli(
      ["validate", "--base", repo.base, "--head", head],
      repo.root,
    ).map(({ id }) => id),
    ["navigation", "tooling"],
  );
  assert.throws(
    () =>
      runFragmentCli(
        ["author", "--id", "tooling", "--reason", "Another declaration."],
        repo.root,
      ),
    /EEXIST/,
  );
});
