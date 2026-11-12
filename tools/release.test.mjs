import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { compileBuildReleaseHistory } from "../client/scripts/release-history.mjs";
import { legacyEvidencePath } from "./legacy-migration-evidence.mjs";
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
import { agentEnvironment, createReleaseAgent } from "./release-agent.mjs";
import { runReleaseCommand } from "./release.mjs";
import {
  acceptLocalTranslations,
  completeLocal,
  startLocal,
} from "./release-local.mjs";

function localHerdr(t, calls = [], failure) {
  const original = process.env.HERDR_ENV;
  process.env.HERDR_ENV = "1";
  t.after(() => {
    if (original === undefined) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = original;
  });
  return async (args) => {
    calls.push(args);
    if (failure) throw failure;
    if (args[0] === "pane" && args[1] === "split")
      return { result: { pane: { pane_id: "fixture:p2" } } };
    if (args[1] === "process-info") {
      assert.deepEqual(args, ["pane", "process-info", "--pane", "fixture:p2"]);
      return {
        result: {
          process_info: { shell_pid: 123, foreground_process_group_id: 123 },
        },
      };
    }
    return { result: {} };
  };
}
test("local preparation reports dirty files before starting an agent", async (t) => {
  const f = fixture(t);
  const calls = [];
  const herdr = localHerdr(t, calls);
  assert.equal(releaseStatus(f.root, "1.11.0").checkoutChanges, "");
  f.write("scratch.txt", "Untracked work\n");
  f.write("client/package.json", {
    version: f.version,
    description: "Local edit",
  });
  f.git("add", "client/package.json");
  const status = await runReleaseCommand(f.root, [
    "status",
    "--version",
    "1.11.0",
  ]);
  assert.equal(status.phase, "unprepared");
  assert.match(status.checkoutChanges, /M {2}client\/package.json/u);
  assert.match(status.checkoutChanges, /\?\? scratch.txt/u);
  await assert.rejects(
    () =>
      runReleaseCommand(
        f.root,
        ["start-local", "--version", "1.11.0", "--baseline", f.baseline],
        { herdr },
      ),
    (error) => {
      assert.match(error.message, /clean checkout/u);
      assert.match(error.message, /client\/package.json/u);
      assert.match(error.message, /scratch.txt/u);
      return true;
    },
  );
  assert.deepEqual(calls, []);
  assert.equal(
    fs.readFileSync(path.join(f.root, "scratch.txt"), "utf8"),
    "Untracked work\n",
  );
  assert.equal(
    fs.existsSync(
      path.join(f.root, ".release-preparation/1.11.0/local-session.json"),
    ),
    false,
  );
  f.git("restore", "--staged", "client/package.json");
  f.git("restore", "client/package.json");
  fs.rmSync(path.join(f.root, "scratch.txt"));
  assert.equal(releaseStatus(f.root, "1.11.0").checkoutChanges, "");
  await startLocal(f.root, "1.11.0", { baseline: f.baseline, herdr });
  assert.ok(calls.some((args) => args[0] === "agent" && args[1] === "start"));
});

test("local release checks honor global ignore rules without hiding other changes", async (t) => {
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
  assert.equal(releaseStatus(f.root, "1.11.0").checkoutChanges, "");
  f.write("scratch.txt", "Untracked work\n");
  assert.match(
    releaseStatus(f.root, "1.11.0").checkoutChanges,
    /\?\? scratch.txt/u,
  );
  await assert.rejects(
    () =>
      startLocal(f.root, "1.11.0", {
        baseline: f.baseline,
        herdr: localHerdr(t),
      }),
    /scratch.txt/u,
  );
  fs.rmSync(path.join(f.root, "scratch.txt"));
  const target = await localDraft(t, f);
  assert.equal((await completeLocal(f.root, target)).phase, "ready");
  validateReleaseForBuild(f.root, target);
  f.write("client/package.json", {
    version: target,
    description: "Local edit",
  });
  assert.match(
    releaseStatus(f.root, target).checkoutChanges,
    /client\/package.json/u,
  );
  assert.throws(
    () => validateReleaseForBuild(f.root, target),
    /clean checkout/u,
  );
  assert.equal(
    fs.readFileSync(path.join(f.root, ".idea/misc.xml"), "utf8"),
    "Local IDE settings\n",
  );
});

async function localDraft(t, f, target = "1.11.0") {
  await startLocal(f.root, target, {
    baseline: f.baseline,
    herdr: localHerdr(t),
  });
  f.write(`.release-preparation/${target}/en.json`, notes());
  const hash = releaseStatus(f.root, target).sourceHash;
  approveRelease(f.root, target, hash);
  f.write(
    `.release-preparation/${target}/de.json`,
    notes("Geprüfte Änderungen"),
  );
  acceptLocalTranslations(f.root, target, hash);
  return target;
}

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
  await localDraft(t, f, f.version);
  assert.equal((await completeLocal(f.root, f.version)).phase, "ready");
  const commit = f.git("rev-parse", "HEAD");
  assert.equal((await completeLocal(f.root, f.version)).phase, "ready");
  assert.equal(f.git("rev-parse", "HEAD"), commit);
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
});

test("external release history qualifies the exact committed legacy tuple using the supplied environment", async (t) => {
  const f = fixture(t);
  const record = {
    version: "0.1.5",
    revision: "6c310a75ecd7d38ff9b4dcf94ba042580f2b68fa",
    manifestSha256: "c".repeat(64),
    migrations: { implementations: [], entries: [], modules: [] },
  };
  f.write(
    legacyEvidencePath,
    JSON.stringify({ schemaVersion: 1, releases: [record] }),
  );
  const source = "client/crates/situate-migrations/src/";
  f.write(
    `${source}registry.rs`,
    "pub const MIGRATIONS: &[MigrationDescriptor] = &[\n    MigrationDescriptor::of::<migrations::m0001_metadata::Migration>(),\n];\n",
  );
  f.write(`${source}migrations/mod.rs`, "pub(crate) mod m0001_metadata;\n");
  f.write(`${source}migrations/m0001_metadata.rs`, "pub struct Migration;\n");
  f.commit("build: record synthetic publication evidence");
  await localDraft(t, f, f.version);
  await completeLocal(f.root, f.version);
  const environment = {
    SITUATE_MIGRATIONS_PUBLISHED_VERSION: record.version,
    SITUATE_MIGRATIONS_PUBLISHED_REVISION: record.revision,
    SITUATE_MIGRATIONS_PUBLISHED_MANIFEST_SHA256: record.manifestSha256,
  };
  assert.equal(
    (
      await compileBuildReleaseHistory(f.root, f.version, {
        distribution: "external",
        environment,
      })
    ).installedVersion,
    f.version,
  );
  await assert.rejects(
    compileBuildReleaseHistory(f.root, f.version, {
      distribution: "external",
      environment: {
        ...environment,
        SITUATE_MIGRATIONS_PUBLISHED_MANIFEST_SHA256: "d".repeat(64),
      },
    }),
    /Missing exact legacy publication evidence/u,
  );
  await assert.rejects(
    compileBuildReleaseHistory(f.root, f.version, {
      distribution: "external",
      environment: {},
    }),
    /explicit full published Git commit/u,
  );
});

test("first release preparation uses an explicit Git baseline without previous release records", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    runReleaseCommand(f.root, ["prepare"]),
    /explicit Git comparison revision/u,
  );
  const prepared = await runReleaseCommand(f.root, [
    "prepare",
    "--baseline",
    f.baseline,
  ]);
  assert.equal(prepared.phase, "draft");
  assert.equal(prepared.baseline, f.baseline);
  assert.equal(prepared.revision, f.revision);
  assert.equal(fs.existsSync(path.join(f.root, "releases/index.json")), false);
});

test("fresh-root releases retain approval, automatic baselines and source binding without agents", async (t) => {
  const f = fixture(t, "0.1.6");
  assert.equal(f.git("rev-list", "--max-parents=0", "HEAD"), f.baseline);
  assert.equal(f.git("remote"), "");
  assert.deepEqual(
    compileReleaseCatalog(f.root, { version: f.version }).releases,
    [],
  );
  await assert.rejects(
    runReleaseCommand(f.root, ["prepare"]),
    /explicit Git comparison revision/u,
  );
  const first = await runReleaseCommand(f.root, [
    "prepare",
    "--baseline",
    f.baseline,
  ]);
  assert.equal(first.baseline, f.baseline);
  assert.equal(first.revision, f.revision);
  for (const version of [f.version, "0.1.7"]) {
    if (version !== f.version) {
      setVersion(f.root, version);
      f.commit("chore(release): select next version");
      f.write("client/source.txt", "More retained drafts\n");
      const revision = f.commit("fix: retain more drafts");
      const next = await runReleaseCommand(f.root, ["prepare"]);
      assert.equal(next.baseline, first.revision);
      assert.equal(next.revision, revision);
    }
    f.write(`.release-preparation/${version}/en.json`, notes());
    const hash = releaseStatus(f.root, version).sourceHash;
    await assert.rejects(
      runReleaseCommand(f.root, ["finalize"]),
      /approval|translations/u,
    );
    await runReleaseCommand(f.root, ["approve", "--source-hash", hash]);
    f.write(
      `.release-preparation/${version}/de.json`,
      notes("Geprüfte Änderungen"),
    );
    await runReleaseCommand(f.root, [
      "accept-local-translations",
      "--version",
      version,
      "--source-hash",
      hash,
    ]);
    await runReleaseCommand(f.root, ["finalize"]);
    f.commit(`chore(release): finalize ${version}`);
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

test("an empty baseline uses the highest earlier committed release notes", async (t) => {
  const f = fixture(t, "1.9.0");
  await f.finalize();
  assert.throws(
    () => prepareRelease(f.root, "1.11.0", { local: true }),
    /explicit Git comparison revision/u,
  );
  f.commit("chore(release): prepare 1.9.0");
  const target = await localDraft(t, f, "1.10.0");
  const previousRevision = releaseStatus(f.root, target).revision;
  await completeLocal(f.root, target);
  f.write("client/source.txt", "Another product change\n");
  const head = f.commit("fix: retain more drafts");
  const prepared = await runReleaseCommand(
    f.root,
    ["start-local", "--version", "1.11.0"],
    { herdr: localHerdr(t) },
  );
  assert.equal(prepared.baseline, previousRevision);
  assert.equal(prepared.revision, head);
  assert.equal(prepared.phase, "draft");
  assert.equal(fs.existsSync(path.join(f.root, "releases/index.json")), false);
});

test("removed import commands and options are rejected without writing preparation files", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    runReleaseCommand(f.root, ["import-historical"]),
    /Usage/u,
  );
  for (const option of [
    "--input",
    "--content-revision",
    "--allow-unpublished-baseline",
  ]) {
    await assert.rejects(
      runReleaseCommand(f.root, ["prepare", option]),
      /Unknown option/u,
    );
  }
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

test("cancellation and failed model outcomes require explicit retry; completed calls resume", async (t) => {
  const f = fixture(t);
  f.prepare();
  let calls = 0;
  const controller = new AbortController();
  await assert.rejects(
    generateRelease(
      f.root,
      f.version,
      async (request) => {
        calls++;
        if (calls === 2) {
          controller.abort(new Error("cancelled"));
          throw new Error("cancelled");
        }
        return f.fake(request);
      },
      { signal: controller.signal },
    ),
    /cancelled/u,
  );
  const completed = calls;
  await assert.rejects(
    generateRelease(f.root, f.version, f.fake),
    /explicitly retry/u,
  );
  assert.equal(calls, completed);
  await generateRelease(
    f.root,
    f.version,
    async (request) => {
      calls++;
      return f.fake(request);
    },
    { retryFailedModelCall: true },
  );
  assert.equal(releaseStatus(f.root, f.version).phase, "awaiting-approval");
  const after = calls;
  await f.generate();
  assert.equal(calls, after);
  f.approve();
  let translations = 0;
  await translateRelease(f.root, f.version, async () => {
    translations++;
    return notes("Translation");
  });
  await translateRelease(f.root, f.version, async () => {
    throw new Error("must not call again");
  });
  assert.equal(translations, 1);
});

test("explicit draft revision archives approved source, resets translation and uses fresh requests", async (t) => {
  const f = fixture(t);
  await f.translated();
  const oldHash = releaseStatus(f.root, f.version).sourceHash;
  await assert.rejects(f.generate(), /preserved/u);
  let calls = 0;
  await generateRelease(
    f.root,
    f.version,
    async (request) => {
      calls++;
      if (request.task === "generate")
        return {
          source: notes("Revised draft"),
          evidence: { "keep-drafts": [f.revision] },
          uncertainties: [],
        };
      return f.fake(request);
    },
    { reviseDraft: true, feedback: "Shorten the title" },
  );
  assert.equal(calls > 0, true);
  assert.equal(releaseStatus(f.root, f.version).phase, "awaiting-approval");
  const archive = fs.readdirSync(
    path.join(f.root, `.release-preparation/archive/${f.version}`),
  );
  assert.equal(archive.length, 1);
  const saved = readJson(
    f.root,
    `.release-preparation/archive/${f.version}/${archive[0]}/state.json`,
  );
  assert.equal(saved.sourceApproval.sourceHash, oldHash);
  assert.equal(
    fs.existsSync(
      path.join(f.root, `.release-preparation/${f.version}/de.json`),
    ),
    false,
  );
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
      runReleaseCommand(f.root, ["prepare", option]),
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
  assert.deepEqual(agentEnvironment("/private-fixture"), {
    PATH: path.dirname(process.execPath),
    HOME: "/private-fixture",
    TMPDIR: "/private-fixture",
    LANG: "en_US.UTF-8",
    NO_COLOR: "1",
  });
  assert.throws(() => createReleaseAgent({}), /allow-model-call/u);
  assert.throws(
    () => createReleaseAgent({}, { allowModelCall: true }),
    /Configure provider/u,
  );
});

test("set-version updates only intended package and workspace pins", (t) => {
  const f = fixture(t);
  const result = setVersion(f.root, "2.0.0");
  assert.equal(result.paths.length, 6);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(f.root, "client/app/package.json"), "utf8"),
    ).version,
    "2.0.0",
  );
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(f.root, "client/package-lock.json"), "utf8"),
    ).packages.app.version,
    "2.0.0",
  );
  validateVersionPins(f.root, "2.0.0");
  assert.equal(
    f.git("log", "--format=%s", "-1"),
    "legacy draft retention change",
  );
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

test("malformed agent output cannot approve or finalize content", async (t) => {
  const f = fixture(t);
  f.prepare();
  await assert.rejects(
    generateRelease(f.root, f.version, async () => ({
      observations: "bad",
      uncertainties: [],
    })),
    /Malformed/u,
  );
  assert.equal(releaseStatus(f.root, f.version).phase, "draft");
  await assert.rejects(
    generateRelease(f.root, f.version, f.fake),
    /explicitly retry/u,
  );
  await generateRelease(f.root, f.version, f.fake, {
    retryFailedModelCall: true,
  });
  assert.equal(releaseStatus(f.root, f.version).phase, "awaiting-approval");
  assert.throws(() => finalizeRelease(f.root, f.version));
  assert.equal(
    fs.existsSync(path.join(f.root, `releases/${f.version}/release.json`)),
    false,
  );
});

test("local startup captures HEAD and keeps version pins unchanged; status discovers its target", async (t) => {
  const f = fixture(t);
  const calls = [];
  const herdr = localHerdr(t, calls);
  await assert.rejects(
    startLocal(f.root, "1.11.0", { herdr }),
    /explicit Git comparison/u,
  );
  assert.equal(calls.length, 0);
  const result = await runReleaseCommand(
    f.root,
    ["start-local", "--version", "1.11.0", "--baseline", f.baseline],
    { herdr },
  );
  assert.equal(result.revision, f.revision);
  assert.equal(readJson(f.root, "client/package.json").version, f.version);
  assert.equal((await runReleaseCommand(f.root, ["status"])).version, "1.11.0");
  assert.deepEqual(
    calls.map((args) => args.slice(0, 2)),
    [
      ["pane", "split"],
      ["pane", "process-info"],
      ["agent", "start"],
      ["agent", "prompt"],
    ],
  );
  assert.ok(calls[0].includes("SITUATE_AUTO_TESTS=0"));
  const prompt = calls.at(-1).at(-1);
  assert.match(prompt, /First write English only/u);
  assert.match(prompt, /STOP and wait/u);
  assert.match(prompt, /Never open an editor, commit/u);
  assert.match(prompt, /AGENTS.md/u);
  assert.match(prompt, /Write for people using Situate, not for developers/u);
  assert.match(prompt, /Default to one short sentence in one paragraph/u);
  assert.match(
    prompt,
    /Do not explain the technical cause or recovery internals/u,
  );
  assert.match(prompt, /never hide consequences merely to shorten an entry/u);
  assert.match(
    prompt,
    /Omit purely internal changes without a meaningful user-visible effect/u,
  );
  assert.match(prompt, /Do not create one entry per commit/u);
  assert.match(
    prompt,
    /Apply the same brevity and natural language to translations/u,
  );
  await assert.rejects(
    startLocal(f.root, "1.11.0", { baseline: f.baseline, herdr }),
    /already requested/u,
  );
  assert.equal(calls.length, 4);
});

test("local completion makes one normal hooked commit with versions and catalogs and can be repeated", async (t) => {
  const f = fixture(t);
  const target = await localDraft(t, f);
  f.git("config", "user.name", "Fixture");
  f.git("config", "user.email", "fixture@example.invalid");
  f.write(
    ".git/hooks/pre-commit",
    "#!/bin/sh\nprintf hooked > .release-preparation/hook-ran\n",
  );
  fs.chmodSync(path.join(f.root, ".git/hooks/pre-commit"), 0o700);
  const before = f.git("rev-list", "--count", "HEAD");
  assert.equal(
    (await runReleaseCommand(f.root, ["complete-local", "--version", target]))
      .phase,
    "ready",
  );
  assert.equal(
    Number(f.git("rev-list", "--count", "HEAD")),
    Number(before) + 1,
  );
  assert.equal(
    fs.readFileSync(path.join(f.root, ".release-preparation/hook-ran"), "utf8"),
    "hooked",
  );
  const files = f
    .git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
    .split("\n");
  assert.equal(files.length, 9);
  assert.ok(files.includes("client/Cargo.lock"));
  assert.ok(files.includes(`releases/${target}/release.json`));
  assert.equal(f.git("status", "--porcelain"), "");
  validateReleaseForBuild(f.root, target);
  const commit = f.git("rev-parse", "HEAD");
  assert.equal((await completeLocal(f.root, target)).phase, "ready");
  assert.equal(f.git("rev-parse", "HEAD"), commit);
  const next = await startLocal(f.root, "1.12.0", { herdr: localHerdr(t) });
  assert.equal(next.baseline, releaseStatus(f.root, target).revision);
});

test("local completion refuses user changes and rolls back after a hook failure for explicit retry", async (t) => {
  const f = fixture(t);
  const target = await localDraft(t, f);
  f.write("personal.txt", "retain this staged file\n");
  f.git("add", "personal.txt");
  await assert.rejects(() => completeLocal(f.root, target), /clean checkout/u);
  assert.equal(f.git("diff", "--cached", "--name-only"), "personal.txt");
  f.git("reset", "--", "personal.txt");
  fs.rmSync(path.join(f.root, "personal.txt"));
  f.git("config", "user.name", "Fixture");
  f.git("config", "user.email", "fixture@example.invalid");
  f.write(".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
  fs.chmodSync(path.join(f.root, ".git/hooks/pre-commit"), 0o700);
  await assert.rejects(() => completeLocal(f.root, target));
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(readJson(f.root, "client/package.json").version, f.version);
  assert.equal(releaseStatus(f.root, target).phase, "translated");
  fs.rmSync(path.join(f.root, ".git/hooks/pre-commit"));
  assert.equal((await completeLocal(f.root, target)).phase, "ready");
});

test("manual translations cannot bind to edited English and application edits cannot hide in version files", async (t) => {
  const f = fixture(t);
  const target = await localDraft(t, f);
  const hash = releaseStatus(f.root, target).sourceHash;
  f.write(`.release-preparation/${target}/en.json`, notes("Revised English"));
  assert.throws(
    () => acceptLocalTranslations(f.root, target, hash),
    /changed or is not approved/u,
  );
  await assert.rejects(
    () => completeLocal(f.root, target),
    /complete all translations/u,
  );
  f.write(`.release-preparation/${target}/en.json`, notes());
  f.write("client/app/src-tauri/tauri.conf.json", {
    version: f.version,
    identifier: "changed.application",
  });
  f.commit("feat: change application identifier");
  assert.equal(releaseStatus(f.root, target).phase, "stale");
  await assert.rejects(
    () => completeLocal(f.root, target),
    /complete all translations/u,
  );
});

test("a failing hook that deletes an existing version file retains recovery data", async (t) => {
  const f = fixture(t);
  const target = await localDraft(t, f);
  f.git("config", "user.name", "Fixture");
  f.git("config", "user.email", "fixture@example.invalid");
  f.write(
    ".git/hooks/pre-commit",
    "#!/bin/sh\nrm client/package.json\nexit 1\n",
  );
  fs.chmodSync(path.join(f.root, ".git/hooks/pre-commit"), 0o700);
  await assert.rejects(completeLocal(f.root, target));
  assert.equal(fs.existsSync(path.join(f.root, "client/package.json")), false);
  assert.ok(
    readJson(f.root, `.release-preparation/${target}/completion.json`)
      .originals["client/package.json"],
  );
  assert.equal(f.git("rev-parse", "HEAD"), f.revision);
});

test("cancellation observed before commit restores prepared files without committing", async (t) => {
  const f = fixture(t);
  const target = await localDraft(t, f);
  const controller = new AbortController();
  const completing = completeLocal(f.root, target, {
    signal: controller.signal,
  });
  controller.abort(new Error("cancelled before commit"));
  await assert.rejects(completing, /cancelled before commit/u);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(f.git("rev-parse", "HEAD"), f.revision);
});

test("completion preserves staging that appears immediately before the real index lock", async (t) => {
  const f = fixture(t);
  const target = await localDraft(t, f);
  const open = fs.openSync;
  let staged = false;
  t.mock.method(fs, "openSync", function (file, ...args) {
    if (!staged && file === path.join(f.root, ".git/index.lock")) {
      staged = true;
      f.write("personal.txt", "retain staged content\n");
      f.git("add", "personal.txt");
    }
    return open.call(this, file, ...args);
  });
  await assert.rejects(() => completeLocal(f.root, target), /clean checkout/u);
  assert.equal(staged, true);
  assert.equal(f.git("diff", "--cached", "--name-only"), "personal.txt");
  assert.equal(readJson(f.root, "client/package.json").version, f.version);
  assert.equal(f.git("rev-parse", "HEAD"), f.revision);
});

test("local preparation rejects Git environment overrides, detached HEAD, active operations and older versions", async (t) => {
  const f = fixture(t);
  const herdr = localHerdr(t);
  await assert.rejects(
    startLocal(f.root, "1.9.0", { baseline: f.baseline, herdr }),
    /older/u,
  );
  for (const name of [
    "GIT_INDEX_FILE",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
  ]) {
    const previous = process.env[name];
    try {
      process.env[name] = "";
      await assert.rejects(
        startLocal(f.root, "1.11.0", { baseline: f.baseline, herdr }),
        /Unset GIT_/u,
      );
      await assert.rejects(
        () => completeLocal(f.root, "1.11.0"),
        /Unset GIT_/u,
      );
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  }
  f.git("checkout", "--detach", "HEAD");
  await assert.rejects(
    startLocal(f.root, "1.11.0", { baseline: f.baseline, herdr }),
    /named branch/u,
  );
  f.git("checkout", "main");
  f.write(".git/MERGE_HEAD", `${f.baseline}\n`);
  await assert.rejects(
    startLocal(f.root, "1.11.0", { baseline: f.baseline, herdr }),
    /active Git operation/u,
  );
  fs.rmSync(path.join(f.root, ".git/MERGE_HEAD"));
  assert.equal(
    (await startLocal(f.root, f.version, { baseline: f.baseline, herdr }))
      .phase,
    "draft",
  );
});

test("local startup waits for shell initialization and retries only a rejected busy start", async (t) => {
  const f = fixture(t);
  const calls = [];
  const invoke = localHerdr(t, calls);
  let inspections = 0;
  let starts = 0;
  const herdr = async (args) => {
    const result = await invoke(args);
    if (args[1] === "process-info") {
      inspections++;
      result.result.process_info.foreground_processes =
        inspections === 1 ? [{ pid: 123 }, { pid: 456 }] : [{ pid: 123 }];
    }
    if (args[0] === "agent" && args[1] === "start") {
      assert.ok(inspections > 1);
      if (++starts === 1)
        throw Object.assign(new Error("Herdr rejected startup"), {
          stderr: JSON.stringify({ error: { code: "agent_pane_busy" } }),
        });
    }
    return result;
  };
  await startLocal(f.root, "1.11.0", { baseline: f.baseline, herdr });
  assert.equal(starts, 2);
  assert.equal(calls.filter((args) => args[1] === "split").length, 1);
  assert.equal(calls.filter((args) => args[1] === "prompt").length, 1);
  assert.equal(
    readJson(f.root, ".release-preparation/1.11.0/local-session.json").phase,
    "prompted",
  );
});

test("local startup never retries an uncertain start or a failed prompt", async (t) => {
  for (const [operation, stderr] of [
    ["start", "connection lost"],
    ["start", JSON.stringify({ error: { code: "agent_not_ready" } })],
    ["prompt", JSON.stringify({ error: { code: "agent_pane_busy" } })],
  ]) {
    await t.test(`${operation}: ${stderr}`, async (t) => {
      const f = fixture(t);
      const calls = [];
      const invoke = localHerdr(t, calls);
      const herdr = async (args) => {
        const result = await invoke(args);
        if (args[0] === "agent" && args[1] === operation)
          throw Object.assign(new Error("Startup outcome unknown"), { stderr });
        return result;
      };
      await assert.rejects(
        startLocal(f.root, "1.11.0", { baseline: f.baseline, herdr }),
        /did not finish/u,
      );
      assert.equal(calls.filter((args) => args[1] === "start").length, 1);
      assert.equal(
        calls.filter((args) => args[1] === "prompt").length,
        operation === "prompt" ? 1 : 0,
      );
      const before = calls.length;
      await assert.rejects(
        startLocal(f.root, "1.11.0", { baseline: f.baseline, herdr }),
        /already requested/u,
      );
      assert.equal(calls.length, before);
    });
  }
});

test("waiting for a rejected busy start remains cancellable", async (t) => {
  const f = fixture(t);
  const calls = [];
  const invoke = localHerdr(t, calls);
  const controller = new AbortController();
  const herdr = async (args) => {
    const result = await invoke(args);
    if (args[0] === "agent" && args[1] === "start") {
      controller.abort(new Error("cancelled"));
      throw Object.assign(new Error("Herdr rejected startup"), {
        stderr: JSON.stringify({ error: { code: "agent_pane_busy" } }),
      });
    }
    return result;
  };
  await assert.rejects(
    startLocal(f.root, "1.11.0", {
      baseline: f.baseline,
      herdr,
      signal: controller.signal,
    }),
    /did not finish/u,
  );
  assert.equal(calls.filter((args) => args[1] === "start").length, 1);
  assert.equal(calls.filter((args) => args[1] === "prompt").length, 0);
  assert.equal(
    readJson(f.root, ".release-preparation/1.11.0/local-session.json").phase,
    "starting",
  );
});

test("uncertain Herdr startup and cancellation preserve private state without resubmitting", async (t) => {
  const f = fixture(t);
  const calls = [];
  const herdr = localHerdr(t, calls, new Error("connection lost"));
  await assert.rejects(
    startLocal(f.root, "1.11.0", { baseline: f.baseline, herdr }),
    /did not finish/u,
  );
  await assert.rejects(
    startLocal(f.root, "1.11.0", { baseline: f.baseline, herdr }),
    /already requested/u,
  );
  assert.equal(calls.length, 1);
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(
    startLocal(f.root, "1.12.0", {
      baseline: f.baseline,
      herdr,
      signal: controller.signal,
    }),
    /cancelled/u,
  );
  assert.equal(calls.length, 1);
  assert.equal(f.git("rev-parse", "HEAD"), f.revision);
});
