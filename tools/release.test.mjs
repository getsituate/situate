import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { compileBuildReleaseHistory } from "../client/scripts/release-history.mjs";
import {
  catalogDigest,
  compareVersions,
  compileReleaseCatalog,
  loadRelease,
  localePath,
  readJson,
  requiredLocales,
  safePath,
  validateLocale,
  validateReleaseForBuild,
  validateVersionPins,
} from "./release-catalog.mjs";
import {
  approveRelease,
  collectEvidence,
  finalizeRelease,
  generateRelease,
  prepareRelease,
  releaseStatus,
  setVersion,
  translateRelease,
  withReleaseLock,
} from "./release-preparation.mjs";
import { runReleaseCommand } from "./release.mjs";

function snapshot(root) {
  return Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true })
      .filter((file) => file !== ".git" && !file.startsWith(`.git${path.sep}`))
      .filter((file) => fs.lstatSync(path.join(root, file)).isFile())
      .sort()
      .map((file) => [
        file,
        fs.readFileSync(path.join(root, file)).toString("base64"),
      ]),
  );
}

test("historical status reports dirty files without modifying them or preparing a release", async (t) => {
  const f = fixture(t);
  f.write("scratch.txt", "Untracked work\n");
  f.write("client/package.json", {
    version: f.version,
    description: "Local edit",
  });
  f.git("add", "client/package.json");
  const before = snapshot(f.root);
  const head = f.git("rev-parse", "HEAD");
  const status = await runReleaseCommand(f.root, [
    "status",
    "--version",
    "1.11.0",
  ]);
  assert.equal(status.phase, "unprepared");
  assert.match(status.checkoutChanges, /M {2}client\/package.json/u);
  assert.match(status.checkoutChanges, /\?\? scratch.txt/u);
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.equal(fs.existsSync(path.join(f.root, ".release-preparation")), false);
});

test("historical status honors global ignore rules without hiding other changes", async (t) => {
  const f = fixture(t);
  const configRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "situate-git-config-"),
  );
  const previous = process.env.GIT_CONFIG_GLOBAL;
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
    fs.rmSync(configRoot, { recursive: true, force: true });
  });
  const excludes = path.join(configRoot, "ignore");
  fs.writeFileSync(excludes, ".idea/\n");
  process.env.GIT_CONFIG_GLOBAL = path.join(configRoot, "config");
  fs.writeFileSync(
    process.env.GIT_CONFIG_GLOBAL,
    `[core]\nexcludesFile = ${JSON.stringify(excludes)}\n`,
  );
  f.write(".idea/misc.xml", "Local IDE settings\n");
  f.write("requirements/.idea/misc.xml", "Nested IDE settings\n");
  assert.equal(
    (await runReleaseCommand(f.root, ["status"])).checkoutChanges,
    "",
  );
  f.write("scratch.txt", "Untracked work\n");
  const before = snapshot(f.root);
  assert.match(
    (await runReleaseCommand(f.root, ["status"])).checkoutChanges,
    /\?\? scratch.txt/u,
  );
  assert.deepEqual(snapshot(f.root), before);
});

const notes = (title = "Reviewed changes") => ({
  title,
  entries: [
    {
      id: "keep-drafts",
      type: "fixed",
      platforms: ["macos", "ios"],
      title: "Keep drafts",
      paragraphs: ["Drafts remain available after switching views."],
    },
  ],
});
function fixture(t, version = "1.10.0") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "situate-release-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, bytes) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(
      path.join(root, file),
      typeof bytes === "string" ? bytes : `${JSON.stringify(bytes, null, 2)}\n`,
    );
  };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = (message = "fixture") => {
    git("add", ".");
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  write(".gitignore", ".release-preparation/\n");
  write("client/packages/localization/locales.json", {
    source: "en",
    locales: ["en", "de"],
  });
  fs.mkdirSync(path.join(root, "releases"), { recursive: true });
  write("client/package.json", { name: "fixture", version });
  write("client/app/package.json", { name: "fixture-app", version });
  write("client/package-lock.json", {
    version,
    packages: { "": { version }, app: { version } },
  });
  write("client/app/src-tauri/tauri.conf.json", { version });
  const names = [
    "situate-client",
    "situate-agent",
    "situate-core",
    "tauri-plugin-workspace-access",
  ];
  const members = names.map((name) =>
    name === "situate-client" ? "app/src-tauri" : `crates/${name}`,
  );
  write(
    "client/Cargo.toml",
    `[workspace]\nmembers = [${members.map((m) => `"${m}"`).join(", ")}]\n[workspace.package]\nversion = "${version}"\n`,
  );
  names.forEach((name, i) =>
    write(
      `client/${members[i]}/Cargo.toml`,
      `[package]\nname = "${name}"\nversion.workspace = true\n`,
    ),
  );
  write(
    "client/Cargo.lock",
    names
      .map((name) => `[[package]]\nname = "${name}"\nversion = "${version}"\n`)
      .join("\n"),
  );
  const baseline = commit("legacy baseline");
  write("client/source.txt", "draft retention\n");
  const revision = commit("legacy draft retention change");
  const prepare = () =>
    prepareRelease(root, version, {
      baseline,
      revision,
    });
  const fake = async (request) =>
    request.task === "analyze" || request.task === "consolidate"
      ? { observations: [`Evidence ${revision}`], uncertainties: [] }
      : request.task === "translate"
        ? notes("Geprüfte Änderungen")
        : {
            source: notes(),
            evidence: { "keep-drafts": [revision] },
            uncertainties: [],
          };
  const generate = () => generateRelease(root, version, fake);
  const approve = () =>
    approveRelease(root, version, releaseStatus(root, version).sourceHash);
  const translated = async () => {
    prepare();
    await generate();
    approve();
    await translateRelease(root, version, fake);
  };
  const finalize = async () => {
    await translated();
    finalizeRelease(root, version);
  };
  return {
    root,
    write,
    git,
    commit,
    baseline,
    revision,
    version,
    prepare,
    fake,
    generate,
    approve,
    translated,
    finalize,
  };
}

async function finalizeFixture(
  f,
  version = f.version,
  options = { baseline: f.baseline },
) {
  prepareRelease(f.root, version, options);
  f.write(`.release-preparation/${version}/en.json`, notes());
  approveRelease(f.root, version, releaseStatus(f.root, version).sourceHash);
  await translateRelease(f.root, version, f.fake);
  finalizeRelease(f.root, version);
  f.commit("docs(release): retain fixture notes");
}

test("distribution validation requires trusted migration history without changing legacy release records", async (t) => {
  const f = fixture(t);
  const original = process.env.SITUATE_MIGRATIONS_PUBLISHED_REVISION;
  t.after(() => {
    if (original === undefined)
      delete process.env.SITUATE_MIGRATIONS_PUBLISHED_REVISION;
    else process.env.SITUATE_MIGRATIONS_PUBLISHED_REVISION = original;
  });
  delete process.env.SITUATE_MIGRATIONS_PUBLISHED_REVISION;
  const source = "client/crates/situate-migrations/src/";
  f.write(
    `${source}registry.rs`,
    "pub const MIGRATIONS: &[MigrationDescriptor] = &[\n    MigrationDescriptor::of::<migrations::m0001_metadata::Migration>(),\n];\n",
  );
  f.write(`${source}migrations/mod.rs`, "pub(crate) mod m0001_metadata;\n");
  f.write(`${source}migrations/m0001_metadata.rs`, "pub struct Migration;\n");
  f.commit("feat: initialize compatibility metadata");
  await finalizeFixture(f);
  const retained = snapshot(f.root);
  assert.throws(
    () => validateReleaseForBuild(f.root, f.version),
    /explicit full published Git commit/u,
  );
  process.env.SITUATE_MIGRATIONS_PUBLISHED_REVISION = "HEAD";
  assert.throws(
    () => validateReleaseForBuild(f.root, f.version),
    /explicit full published Git commit/u,
  );
  process.env.SITUATE_MIGRATIONS_PUBLISHED_REVISION = f.baseline;
  assert.equal(
    validateReleaseForBuild(f.root, f.version).installedVersion,
    f.version,
  );
  assert.deepEqual(snapshot(f.root), retained);
});

test("external release history requires the supplied full published source commit", async (t) => {
  const f = fixture(t);
  const source = "client/crates/situate-migrations/src/";
  f.write(
    `${source}registry.rs`,
    "pub const MIGRATIONS: &[MigrationDescriptor] = &[\n    MigrationDescriptor::of::<migrations::m0001_metadata::Migration>(),\n];\n",
  );
  f.write(`${source}migrations/mod.rs`, "pub(crate) mod m0001_metadata;\n");
  f.write(`${source}migrations/m0001_metadata.rs`, "pub struct Migration;\n");
  f.commit("feat: initialize migrations");
  await finalizeFixture(f);
  assert.equal(
    (
      await compileBuildReleaseHistory(f.root, f.version, {
        distribution: "external",
        environment: { SITUATE_MIGRATIONS_PUBLISHED_REVISION: f.baseline },
      })
    ).installedVersion,
    f.version,
  );
  for (const environment of [
    {},
    { SITUATE_MIGRATIONS_PUBLISHED_REVISION: "a".repeat(40) },
  ])
    await assert.rejects(
      compileBuildReleaseHistory(f.root, f.version, {
        distribution: "external",
        environment,
      }),
      /explicit full published Git commit|Missing local migration history commit/u,
    );
});

test("historical preparation status retains the explicit source and baseline commits", async (t) => {
  const f = fixture(t);
  f.prepare();
  const prepared = await runReleaseCommand(f.root, ["status"]);
  assert.equal(prepared.phase, "draft");
  assert.equal(prepared.baseline, f.baseline);
  assert.equal(prepared.revision, f.revision);
  assert.equal(fs.existsSync(path.join(f.root, "releases/index.json")), false);
});

test("historical finalized records retain approval, automatic baselines and source binding", async (t) => {
  const f = fixture(t, "0.1.6");
  assert.equal(f.git("rev-list", "--max-parents=0", "HEAD"), f.baseline);
  assert.equal(f.git("remote"), "");
  assert.deepEqual(
    compileReleaseCatalog(f.root, { version: f.version }).releases,
    [],
  );
  const first = prepareRelease(f.root, f.version, { baseline: f.baseline });
  assert.equal(first.baseline, f.baseline);
  assert.equal(first.revision, f.revision);
  for (const version of [f.version, "0.1.7"]) {
    if (version !== f.version) {
      setVersion(f.root, version);
      f.commit("build: select fixture version");
      f.write("client/source.txt", "More retained drafts\n");
      const revision = f.commit("fix: retain more drafts");
      const next = prepareRelease(f.root, version);
      assert.equal(next.baseline, first.revision);
      assert.equal(next.revision, revision);
    }
    f.write(`.release-preparation/${version}/en.json`, notes());
    const hash = releaseStatus(f.root, version).sourceHash;
    assert.throws(
      () => finalizeRelease(f.root, version),
      /approval|translations/u,
    );
    approveRelease(f.root, version, hash);
    await translateRelease(f.root, version, f.fake);
    finalizeRelease(f.root, version);
    f.commit(`docs(release): retain ${version}`);
    assert.equal(
      validateReleaseForBuild(f.root, version).installedVersion,
      version,
    );
    assert.equal(
      loadRelease(f.root, version).metadata.baseline,
      version === f.version ? f.baseline : first.revision,
    );
  }
  assert.equal(
    compileReleaseCatalog(f.root, { version: "0.1.7", requireCurrent: true })
      .releases.length,
    2,
  );
  f.write("client/source.txt", "Unreviewed product change\n");
  f.commit("fix: change draft behavior");
  assert.throws(
    () => validateReleaseForBuild(f.root, "0.1.7"),
    /Application source changed after analysis/u,
  );
});

test("historical records preserve the highest earlier committed release baseline", async (t) => {
  const f = fixture(t, "1.9.0");
  await f.finalize();
  f.commit("docs(release): retain 1.9.0");
  setVersion(f.root, "1.10.0");
  f.commit("build: select fixture version");
  const previousRevision = f.git("rev-parse", "HEAD");
  await finalizeFixture(f, "1.10.0", {});
  setVersion(f.root, "1.11.0");
  f.write("client/source.txt", "Another product change\n");
  const head = f.commit("fix: retain more drafts");
  prepareRelease(f.root, "1.11.0");
  const prepared = await runReleaseCommand(f.root, [
    "status",
    "--version",
    "1.11.0",
  ]);
  assert.equal(prepared.baseline, previousRevision);
  assert.equal(prepared.revision, head);
  assert.equal(prepared.phase, "draft");
  assert.equal(fs.existsSync(path.join(f.root, "releases/index.json")), false);
});

test("retired release preparation commands and options cannot write files or create commits", async (t) => {
  const f = fixture(t);
  const before = snapshot(f.root);
  const head = f.git("rev-parse", "HEAD");
  for (const command of [
    "start-local",
    "complete-local",
    "accept-local-translations",
    "prepare",
    "generate",
    "approve",
    "translate",
    "finalize",
    "set-version",
    "import-historical",
    "record-publication",
  ]) {
    await assert.rejects(
      runReleaseCommand(f.root, [command, "--version", f.version]),
      /Usage/u,
    );
  }
  for (const option of [
    "--baseline",
    "--revision",
    "--source-hash",
    "--provider",
    "--model",
    "--api-key-env",
    "--date",
    "--feedback",
    "--allow-model-call",
    "--retry-failed-model-call",
    "--revise-draft",
    "--input",
    "--content-revision",
    "--allow-unpublished-baseline",
  ]) {
    await assert.rejects(
      runReleaseCommand(f.root, ["status", option]),
      /Unknown option/u,
    );
  }
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.equal(fs.existsSync(path.join(f.root, ".release-preparation")), false);
});

test("CLI build validation reports a digest without flooding terminal output with history", async (t) => {
  const f = fixture(t);
  await f.finalize();
  f.commit("docs(release): Finalize reviewed notes");
  const result = await runReleaseCommand(f.root, ["validate"]);
  assert.equal(result.phase, "ready");
  assert.equal(result.version, f.version);
  assert.equal(
    result.sha256,
    catalogDigest(validateReleaseForBuild(f.root, f.version)),
  );
  assert.equal(Object.hasOwn(result, "catalog"), false);
});

test("distribution builds require finalized current notes and strict locale structure", (t) => {
  const f = fixture(t);
  assert.deepEqual(
    compileReleaseCatalog(f.root, { version: f.version }).releases,
    [],
  );
  assert.throws(
    () =>
      compileReleaseCatalog(f.root, {
        version: f.version,
        requireCurrent: true,
      }),
    /not finalized/u,
  );
  assert.equal(compareVersions("1.10.0", "1.9.0") > 0, true);
  assert.throws(() => compareVersions("01.1.0", "1.0.0"), /numeric/u);
  assert.throws(
    () => validateLocale({ ...notes(), html: "unsafe" }),
    /fields/u,
  );
  assert.throws(
    () =>
      validateLocale({
        ...notes(),
        entries: [...notes().entries, ...notes().entries],
      }),
    /duplicate/u,
  );
  const translated = notes();
  translated.entries[0].platforms = ["macos"];
  assert.throws(() => validateLocale(translated, notes()), /preserve/u);
  const html = notes();
  html.entries[0].paragraphs = ["<script>bad</script>"];
  assert.throws(() => validateLocale(html), /plain text/u);
  f.write("client/packages/localization/locales.json", {
    source: "en",
    locales: ["de", "en"],
  });
  assert.throws(() => requiredLocales(f.root), /locale definition/u);
});

test("persisted workflow binds exact source bytes and final digest without model calls in builds", async (t) => {
  const f = fixture(t);
  assert.equal(releaseStatus(f.root, f.version).phase, "unprepared");
  assert.equal(
    (await runReleaseCommand(f.root, ["status", "--json"])).phase,
    "unprepared",
  );
  f.prepare();
  assert.equal(releaseStatus(f.root, f.version).phase, "draft");
  await f.generate();
  const status = releaseStatus(f.root, f.version);
  assert.equal(status.phase, "awaiting-approval");
  assert.equal(typeof status.baseline, "string");
  assert.equal(status.localePaths.en, status.sourcePath);
  assert.throws(
    () => approveRelease(f.root, f.version, "wrong"),
    /hash changed/u,
  );
  f.approve();
  await translateRelease(f.root, f.version, f.fake);
  assert.equal(releaseStatus(f.root, f.version).phase, "translated");
  finalizeRelease(f.root, f.version);
  assert.equal(releaseStatus(f.root, f.version).phase, "ready-to-commit");
  assert.throws(() => validateReleaseForBuild(f.root, f.version), /committed/u);
  f.commit("chore(release): Add reviewed notes");
  assert.equal(releaseStatus(f.root, f.version).phase, "ready");
  const catalog = validateReleaseForBuild(f.root, f.version);
  assert.deepEqual(catalog, {
    schemaVersion: 1,
    installedVersion: f.version,
    releases: [
      {
        version: f.version,
        locales: { en: notes(), de: notes("Geprüfte Änderungen") },
      },
    ],
  });
  assert.equal(
    catalogDigest(catalog),
    catalogDigest(JSON.parse(JSON.stringify(catalog))),
  );
  assert.equal(catalogDigest({ b: 1, a: 2 }), catalogDigest({ a: 2, b: 1 }));
  f.write(localePath(f.version, "de"), notes("Changed translation"));
  assert.throws(
    () => compileReleaseCatalog(f.root, { version: f.version }),
    /content changed/u,
  );
});

test("source edits invalidate approval and translations; reapproval does not reuse old translations", async (t) => {
  const f = fixture(t);
  await f.translated();
  const before = releaseStatus(f.root, f.version).sourceHash;
  f.write(
    `.release-preparation/${f.version}/en.json`,
    notes("Changed English"),
  );
  assert.equal(releaseStatus(f.root, f.version).phase, "stale");
  await assert.rejects(translateRelease(f.root, f.version, f.fake), /stale/u);
  assert.throws(() => finalizeRelease(f.root, f.version), /stale/u);
  assert.throws(
    () => approveRelease(f.root, f.version, before),
    /hash changed/u,
  );
  f.approve();
  assert.equal(releaseStatus(f.root, f.version).phase, "approved");
  let calls = 0;
  await translateRelease(f.root, f.version, async () => {
    calls++;
    return notes("New translation");
  });
  assert.equal(calls, 1);
  assert.equal(releaseStatus(f.root, f.version).phase, "translated");
  finalizeRelease(f.root, f.version);
});

test("analysis revision, changed code and version pins cannot drift", async (t) => {
  const f = fixture(t);
  f.prepare();
  assert.throws(
    () =>
      prepareRelease(f.root, f.version, {
        baseline: "HEAD",
      }),
    /full 40/u,
  );
  f.write("client/source.txt", "uncommitted change");
  assert.equal(releaseStatus(f.root, f.version).phase, "stale");
  await assert.rejects(f.generate(), /source changed/u);
  f.git("checkout", "--", "client/source.txt");
  assert.throws(
    () =>
      prepareRelease(f.root, f.version, {
        baseline: f.revision,
        revision: f.revision,
      }),
    /Conflicting/u,
  );
  f.write("client/package-lock.json", {
    version: f.version,
    packages: { "": { version: "1.9.0" } },
  });
  assert.throws(
    () => validateVersionPins(f.root, f.version),
    /version mismatch/u,
  );
});

test("app package and npm workspace versions must match the release", (t) => {
  for (const file of ["client/app/package.json", "client/package-lock.json"]) {
    const f = fixture(t);
    const value = JSON.parse(fs.readFileSync(path.join(f.root, file), "utf8"));
    if (file.endsWith("package-lock.json"))
      value.packages.app.version = "1.8.0";
    else value.version = "1.8.0";
    f.write(file, value);
    assert.throws(
      () => validateVersionPins(f.root, f.version),
      /version mismatch/u,
    );
    const revision = f.commit("test: change an app version pin");
    assert.throws(
      () => validateVersionPins(f.root, f.version, revision),
      /version mismatch/u,
    );
  }
});

test("interrupted finalization has no valid marker and resumes only identical files", async (t) => {
  const f = fixture(t);
  await f.translated();
  assert.throws(
    () =>
      finalizeRelease(f.root, f.version, {
        afterLocaleWrite: () => {
          throw new Error("interrupted");
        },
      }),
    /interrupted/u,
  );
  assert.equal(
    fs.existsSync(path.join(f.root, `releases/${f.version}/release.json`)),
    false,
  );
  assert.throws(
    () =>
      compileReleaseCatalog(f.root, {
        version: f.version,
        requireCurrent: true,
      }),
    /not finalized/u,
  );
  finalizeRelease(f.root, f.version);
  loadRelease(f.root, f.version);
  finalizeRelease(f.root, f.version);
  f.write(localePath(f.version, "en"), notes("tampered"));
  assert.throws(() => finalizeRelease(f.root, f.version), /content changed/u);
});

test("Git evidence is bounded, includes legacy commits and final reverts, excludes duplicate merge records", (t) => {
  const f = fixture(t);
  f.git("checkout", "-b", "feature");
  f.write("client/feature.txt", "feature\n");
  const feature = f.commit("feat: Add example");
  f.git("checkout", "main");
  f.write("workshop/example.txt", "experiment\n");
  f.commit("workshop experiment");
  f.git("merge", "--no-ff", "feature", "-m", "Merge feature");
  f.git("revert", "--no-edit", feature);
  f.write("client/large.txt", "bounded evidence\n".repeat(500));
  const target = f.commit("legacy large correction");
  const evidence = collectEvidence(
    f.root,
    { baseline: f.baseline, revision: target },
    1000,
  );
  assert.equal(new Set(evidence.commits).size, evidence.commits.length);
  assert.equal(
    evidence.chunks.every((chunk) => chunk.text.length <= 1000),
    true,
  );
  assert.equal(
    evidence.chunks
      .filter((chunk) => chunk.kind === "commit")
      .some((chunk) => chunk.text.includes("legacy")),
    true,
  );
  const diff = evidence.chunks
    .filter((chunk) => chunk.kind === "final-diff")
    .map((chunk) => chunk.text)
    .join("");
  assert.equal(diff.includes("client/feature.txt"), false);
  assert.equal(diff.includes("workshop/example.txt"), true);
  f.write("client/too-large.txt", "x".repeat(1100000));
  const oversizedTarget = f.commit("legacy oversized evidence");
  assert.throws(
    () =>
      collectEvidence(
        f.root,
        { baseline: f.baseline, revision: oversizedTarget },
        1000,
      ),
    /bounded analysis limit/u,
  );
  f.git("checkout", "--orphan", "divergent");
  f.write("other.txt", "other");
  const divergent = f.commit("other history");
  assert.throws(() =>
    prepareRelease(f.root, f.version, {
      baseline: divergent,
      revision: target,
    }),
  );
});

test("removed publication commands and options are rejected", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    runReleaseCommand(f.root, ["record-publication"]),
    /Usage/u,
  );
  for (const option of [
    "--confirm-published",
    "--platform",
    "--channel",
    "--url",
    "--evidence",
  ])
    await assert.rejects(
      runReleaseCommand(f.root, ["validate", option]),
      /Unknown option/u,
    );
});

test("release inputs reject symlinks, hardlinks, oversized files, unknown locales and concurrent writers", async (t) => {
  const f = fixture(t);
  assert.throws(() => safePath(f.root, "../elsewhere"), /Unsafe/u);
  fs.symlinkSync(os.tmpdir(), path.join(f.root, ".release-preparation"));
  assert.throws(
    () => safePath(f.root, ".release-preparation/state.json"),
    /Symlink/u,
  );
  assert.throws(() => f.prepare());
  fs.unlinkSync(path.join(f.root, ".release-preparation"));
  f.prepare();
  fs.linkSync(
    path.join(f.root, ".release-preparation", f.version, "state.json"),
    path.join(f.root, "hardlink.json"),
  );
  assert.throws(
    () => readJson(f.root, `.release-preparation/${f.version}/state.json`),
    /regular/u,
  );
  fs.unlinkSync(path.join(f.root, "hardlink.json"));
  f.write("oversized.json", " ".repeat(4 * 1024 * 1024 + 1));
  assert.throws(() => readJson(f.root, "oversized.json"), /4 MiB/u);
  fs.unlinkSync(path.join(f.root, "oversized.json"));
  await withReleaseLock(f.root, async () => {
    assert.throws(() => withReleaseLock(f.root, () => {}), /locked/u);
  });
});

test("finalized histories sort numerically and preserve the installed ceiling without a publication index", async (t) => {
  const f = fixture(t, "1.8.0");
  const oldVersion = f.version;
  for (const version of ["1.8.0", "1.9.0"]) {
    let target = f.revision;
    if (version !== f.version) {
      setVersion(f.root, version);
      target = f.commit(`build: Select ${version}`);
    }
    prepareRelease(
      f.root,
      version,
      version === f.version ? { baseline: f.baseline } : {},
    );
    const agent = async (request) =>
      request.task === "generate"
        ? {
            source: notes(version),
            evidence: { "keep-drafts": [target] },
            uncertainties: [],
          }
        : f.fake(request);
    await generateRelease(f.root, version, agent);
    approveRelease(f.root, version, releaseStatus(f.root, version).sourceHash);
    await translateRelease(f.root, version, agent);
    finalizeRelease(f.root, version);
    f.commit(`chore(release): Finalize ${version}`);
  }
  assert.deepEqual(
    compileReleaseCatalog(f.root, { version: "1.10.0" }).releases.map(
      (entry) => entry.version,
    ),
    ["1.9.0", "1.8.0"],
  );
  assert.deepEqual(
    compileReleaseCatalog(f.root, { version: oldVersion }).releases.map(
      (entry) => entry.version,
    ),
    [oldVersion],
  );
  assert.throws(
    () => prepareRelease(f.root, "1.8.1", { baseline: f.revision }),
    /version mismatch|newer/u,
  );
  setVersion(f.root, "1.10.0");
  f.write("releases/9.0.0/release.json", { draft: true });
  f.write("releases/1.7.0/en.json", notes("Unfinalized notes"));
  const target = f.commit("build: Choose next version");
  prepareRelease(f.root, "1.10.0", { revision: target });
  const fake = async (request) =>
    request.task === "generate"
      ? {
          source: notes(),
          evidence: { "keep-drafts": [target] },
          uncertainties: [],
        }
      : f.fake(request);
  await generateRelease(f.root, "1.10.0", fake);
  approveRelease(f.root, "1.10.0", releaseStatus(f.root, "1.10.0").sourceHash);
  await translateRelease(f.root, "1.10.0", fake);
  finalizeRelease(f.root, "1.10.0");
  f.commit("chore(release): Add current notes");
  assert.deepEqual(
    validateReleaseForBuild(f.root, "1.10.0").releases.map(
      (entry) => entry.version,
    ),
    ["1.10.0", "1.9.0", "1.8.0"],
  );
  f.write(localePath("1.8.0", "de"), notes("Changed historical translation"));
  assert.throws(
    () => compileReleaseCatalog(f.root, { version: "1.10.0" }),
    /content changed/u,
  );
  f.git("checkout", "--", localePath("1.8.0", "de"));
  f.write("client/source.txt", "temporary source change");
  f.commit("fix: Temporary change");
  f.write("client/source.txt", "draft retention\n");
  f.commit("revert: Restore earlier code");
  assert.throws(
    () => validateReleaseForBuild(f.root, "1.10.0"),
    /source changed/u,
  );
});

test("malformed retained source cannot appear approved or finalized during inspection", async (t) => {
  const f = fixture(t);
  f.prepare();
  f.write(`.release-preparation/${f.version}/en.json`, {
    observations: "invalid source",
  });
  const before = snapshot(f.root);
  const status = await runReleaseCommand(f.root, ["status"]);
  assert.equal(status.phase, "stale");
  assert.equal(status.sourceHash, null);
  assert.ok(status.error);
  await assert.rejects(
    runReleaseCommand(f.root, ["validate"]),
    /not finalized/u,
  );
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(
    fs.existsSync(path.join(f.root, `releases/${f.version}/release.json`)),
    false,
  );
});

test("historical status discovers retained targets and leaves uncertain completion journals untouched", async (t) => {
  const f = fixture(t);
  const target = "1.11.0";
  prepareRelease(f.root, target, { baseline: f.baseline, local: true });
  f.write(`.release-preparation/${target}/en.json`, notes());
  const hash = releaseStatus(f.root, target).sourceHash;
  approveRelease(f.root, target, hash);
  f.write(".release-preparation/active.json", { version: target });
  f.write(`.release-preparation/${target}/local-session.json`, {
    phase: "prompting",
    paneId: "fixture:p2",
    retained: "unknown outcome",
  });
  f.write(`.release-preparation/${target}/completion.json`, {
    head: f.revision,
    originals: { "client/package.json": "retained bytes" },
    updates: {},
    retained: "unknown field",
  });
  const call = "a".repeat(64);
  f.write(`.release-preparation/${target}/calls/${call}.pending.json`, {
    identity: call,
    state: "incomplete",
  });
  const archived = `.release-preparation/archive/${target}/retained`;
  f.write(
    `${archived}/state.json`,
    readJson(f.root, `.release-preparation/${target}/state.json`),
  );
  f.write(`${archived}/en.json`, notes());
  const before = snapshot(f.root);
  const index = fs.readFileSync(path.join(f.root, ".git/index"));
  for (const args of [["status"], ["status", "--version", target, "--json"]]) {
    const status = await runReleaseCommand(f.root, args);
    assert.equal(status.version, target);
    assert.equal(status.phase, "approved");
    assert.equal(status.sourceHash, hash);
    assert.equal(status.revision, f.revision);
  }
  assert.equal(
    readJson(f.root, `${archived}/state.json`).sourceApproval.sourceHash,
    hash,
  );
  assert.equal(
    readJson(
      f.root,
      `.release-preparation/${target}/calls/${call}.pending.json`,
    ).state,
    "incomplete",
  );
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(fs.readFileSync(path.join(f.root, ".git/index")), index);
  assert.equal(f.git("rev-parse", "HEAD"), f.revision);
});

test("historical readers reject invalid targets and report partial state without replacing retained files", async (t) => {
  const f = fixture(t);
  f.write(".release-preparation/active.json", { version: "../invalid" });
  let before = snapshot(f.root);
  await assert.rejects(runReleaseCommand(f.root, ["status"]), /numeric/u);
  assert.deepEqual(snapshot(f.root), before);
  f.write(".release-preparation/active.json", { version: f.version });
  f.write(`.release-preparation/${f.version}/state.json`, '{"schemaVersion":');
  before = snapshot(f.root);
  const status = await runReleaseCommand(f.root, ["status"]);
  assert.equal(status.phase, "stale");
  assert.ok(status.error);
  await assert.rejects(
    runReleaseCommand(f.root, ["validate"]),
    /not finalized/u,
  );
  assert.deepEqual(snapshot(f.root), before);
});

test("historical CLI reads status and rejects mutation without a command queue or agent helpers", (t) => {
  const f = fixture(t);
  for (const file of [
    "release.mjs",
    "release-preparation.mjs",
    "release-catalog.mjs",
    "release-version.mjs",
    "migration-history.mjs",
  ])
    f.write(
      `tools/${file}`,
      fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8"),
    );
  f.commit("test: install historical CLI fixture");
  const before = snapshot(f.root);
  const invoke = (...args) =>
    spawnSync(
      process.execPath,
      [fs.realpathSync(path.join(f.root, "tools/release.mjs")), ...args],
      {
        cwd: f.root,
        encoding: "utf8",
        timeout: 10000,
        env: {
          PATH: process.env.PATH,
          HOME: f.root,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
      },
    );
  const status = invoke("status", "--json");
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).phase, "unprepared");
  assert.equal(JSON.parse(status.stdout).version, f.version);
  const validate = invoke("validate");
  assert.equal(validate.status, 1);
  assert.match(validate.stderr, /not finalized/u);
  for (const command of [
    "start-local",
    "complete-local",
    "generate",
    "set-version",
  ]) {
    const result = invoke(command, "--version", f.version);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /Usage: node tools\/release\.mjs <status\|validate>/u,
    );
  }
  assert.deepEqual(snapshot(f.root), before);
});

test("historical validation returns the retained digest without rewriting catalog or private state", async (t) => {
  const f = fixture(t);
  await f.finalize();
  f.commit("docs(release): retain finalized notes");
  f.write(`.release-preparation/${f.version}/completion.json`, {
    head: f.revision,
    commit: f.git("rev-parse", "HEAD"),
    retained: "recovery evidence",
  });
  const before = snapshot(f.root);
  const head = f.git("rev-parse", "HEAD");
  const result = await runReleaseCommand(f.root, [
    "validate",
    "--version",
    f.version,
    "--distribution",
    "external",
    "--json",
  ]);
  assert.equal(result.version, f.version);
  assert.equal(result.phase, "ready");
  assert.equal(
    result.sha256,
    catalogDigest(
      compileReleaseCatalog(f.root, {
        version: f.version,
        requireCurrent: true,
      }),
    ),
  );
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(f.git("rev-parse", "HEAD"), head);
});
