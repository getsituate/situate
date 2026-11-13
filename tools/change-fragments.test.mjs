import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  approveSource,
  acceptTranslation,
  behaviorDigest,
  collectFragments,
  fragmentHashes,
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
    schemaVersion: 1,
    id,
    behaviorDigest: "a".repeat(64),
    locales: Object.fromEntries(
      locales.map((locale) => [
        locale,
        { title: "Changes", entries: structuredClone(entries) },
      ]),
    ),
    ...(empty ? { emptyReason: "Internal test tooling only." } : {}),
    translationApprovals: {},
  };
}
function approved(fragment, inventory = locales) {
  let result = approveSource(fragment, fragmentHashes(fragment).sourceHash, {
    locales: inventory,
  });
  for (const locale of inventory.filter((item) => item !== "en"))
    result = acceptTranslation(
      result,
      locale,
      result.locales[locale],
      fragmentHashes(result).translations[locale],
      { locales: inventory },
    );
  return result;
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

test("source and translation approvals bind source, behavior, locale inventory and exact translation", () => {
  const value = approved(draft());
  assert.equal(validateFragment(value, { locales }), value);
  const translated = structuredClone(value);
  translated.locales.de.entries[0].title = "Andere Navigation";
  assert.throws(
    () => validateFragment(translated, { locales }),
    /Translation approval/,
  );
  for (const mutate of [
    (copy) => {
      copy.locales.en.entries[0].paragraphs = ["Different behavior."];
    },
    (copy) => {
      copy.behaviorDigest = "b".repeat(64);
    },
    (copy) => {
      copy.locales.fr = structuredClone(copy.locales.en);
    },
  ]) {
    const copy = structuredClone(value);
    mutate(copy);
    assert.throws(
      () => validateFragment(copy, { locales: Object.keys(copy.locales) }),
      /Source approval/,
    );
  }
  assert.throws(
    () =>
      acceptTranslation(
        draft(),
        "de",
        draft().locales.de,
        fragmentHashes(draft()).translations.de,
        { locales },
      ),
    /Approve English/,
  );
  const edited = structuredClone(value);
  edited.locales.en.title = "Corrected source";
  const renewed = approveSource(edited, fragmentHashes(edited).sourceHash, {
    locales,
  });
  assert.deepEqual(renewed.translationApprovals, {});
  assert.throws(
    () => validateFragment(renewed, { locales }),
    /Unexpected fragment fields/,
  );
});

test("empty reasons are mandatory and locale completeness follows the inventory", () => {
  const value = draft("empty", true);
  assert.doesNotThrow(() => validateFragment(approved(value), { locales }));
  delete value.emptyReason;
  assert.throws(
    () => validateFragment(value, { locales, requireApprovals: false }),
    /nonempty plain text/,
  );
  const extra = draft();
  extra.locales.fr = structuredClone(extra.locales.en);
  assert.doesNotThrow(() =>
    validateFragment(approved(extra, [...locales, "fr"]), {
      locales: [...locales, "fr"],
    }),
  );
  assert.throws(
    () => validateFragment(extra, { locales, requireApprovals: false }),
    /Unexpected/,
  );
  extra.locales.de.entries[0].platforms = ["ios"];
  assert.throws(
    () =>
      validateFragment(extra, {
        locales: [...locales, "fr"],
        requireApprovals: false,
      }),
    /preserve entry/,
  );
});

test("Git ranges require new immutable declarations, behavior review, ancestry and historical catalog immutability", (t) => {
  const repo = repository(t);
  const value = draft();
  value.behaviorDigest = behaviorDigest(repo.root, repo.base);
  repo.write("changes/test-change.json", JSON.stringify(approved(value)));
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
  assert.throws(
    () => validateFragmentRange(repo.root, { base: repo.base, head: changed }),
    /Behavior changed/,
  );
  assert.equal(
    collectFragments(repo.root, { base: repo.base, head: changed }).length,
    1,
  );
  repo.write(
    "changes/test-change.json",
    JSON.stringify(approved(draft("test-change", true))),
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

test("concurrent PRs use independent IDs and assembly retains both declarations", (t) => {
  const repo = repository(t);
  for (const id of ["change-alpha", "change-beta"]) {
    repo.git("checkout", "--detach", repo.base);
    const value = draft(id, true);
    value.behaviorDigest = behaviorDigest(repo.root, repo.base);
    repo.write(`changes/${id}.json`, JSON.stringify(approved(value)));
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
  value.behaviorDigest = behaviorDigest(repo.root, repo.base);
  repo.write("changes/different-name.json", JSON.stringify(approved(value)));
  let head = repo.commit();
  assert.throws(
    () => validateFragmentRange(repo.root, { base: repo.base, head }),
    /filename and ID/,
  );
  fs.rmSync(path.join(repo.root, "changes/different-name.json"));
  const missing = approved(value);
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

test("CLI authors versionless declarations and requires explicit hash review before validation", (t) => {
  const repo = repository(t);
  const authored = runFragmentCli(
    ["author", "--id", "tooling", "--reason", "Test runner maintenance."],
    repo.root,
  );
  assert.throws(() =>
    runFragmentCli(["validate", "--id", "tooling"], repo.root),
  );
  assert.equal(
    runFragmentCli(["validate", "--draft", "--id", "tooling"], repo.root)
      .sourceHash,
    authored.sourceHash,
  );
  assert.throws(
    () =>
      runFragmentCli(
        ["source-approve", "--id", "tooling", "--hash", "0".repeat(64)],
        repo.root,
      ),
    /Inspect/,
  );
  const source = runFragmentCli(
    ["source-approve", "--id", "tooling", "--hash", authored.sourceHash],
    repo.root,
  );
  runFragmentCli(
    [
      "translation-accept",
      "--id",
      "tooling",
      "--locale",
      "de",
      "--hash",
      source.translations.de,
    ],
    repo.root,
  );
  assert.equal(
    runFragmentCli(["validate", "--id", "tooling"], repo.root).id,
    "tooling",
  );
  const before = fs.readFileSync(
    path.join(repo.root, "changes/tooling.json"),
    "utf8",
  );
  repo.write("app.txt", "new committed behavior");
  repo.commit();
  assert.throws(
    () => runFragmentCli(["validate", "--id", "tooling"], repo.root),
    /Behavior changed/,
  );
  const reviewed = runFragmentCli(
    ["validate", "--draft", "--id", "tooling"],
    repo.root,
  );
  assert.notEqual(reviewed.sourceHash, authored.sourceHash);
  assert.equal(
    fs.readFileSync(path.join(repo.root, "changes/tooling.json"), "utf8"),
    before,
  );
  assert.throws(
    () =>
      runFragmentCli(
        ["source-approve", "--id", "tooling", "--hash", authored.sourceHash],
        repo.root,
      ),
    /Inspect/,
  );
  runFragmentCli(
    ["source-approve", "--id", "tooling", "--hash", reviewed.sourceHash],
    repo.root,
  );
  assert.throws(() =>
    runFragmentCli(["validate", "--id", "tooling"], repo.root),
  );
  runFragmentCli(
    [
      "translation-accept",
      "--id",
      "tooling",
      "--locale",
      "de",
      "--hash",
      reviewed.translations.de,
    ],
    repo.root,
  );
  assert.equal(
    runFragmentCli(["validate", "--id", "tooling"], repo.root).sourceHash,
    reviewed.sourceHash,
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
