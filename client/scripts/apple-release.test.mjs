import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { qualificationFixture } from "../../tools/release-qualification-fixture.mjs";
import {
  appleEnvironment,
  applePlan,
  buildAppleRelease,
  inspectNotarization,
  loadAppleSettings,
  notarize,
  runAppleRelease,
} from "./apple-release.mjs";

const settings = {
  teamId: "TEAM123456",
  macosSigningIdentity: "Developer ID Application: Example (TEAM123456)",
  notaryProfile: "synthetic",
};
const id = "11111111-2222-3333-4444-555555555555";
function durableJournal() {
  const entries = [];
  return {
    operationId: "synthetic-operation",
    entries,
    async persist(entry) {
      entries.push({ ...entry });
      return { durable: true, operationId: this.operationId };
    },
    async complete(entry) {
      entries.push({ ...entry, completed: true });
      return { durable: true, operationId: this.operationId };
    },
  };
}
function notaryFixture(t) {
  const { directory } = qualificationFixture(t);
  mkdirSync(join(directory, "target/apple-release"), { recursive: true });
  const path = join(directory, "candidate.zip");
  writeFileSync(path, "synthetic signed app archive");
  const journal = durableJournal();
  return {
    root: directory,
    path,
    journal,
    options: { cwd: directory, env: {}, capture: true },
    local: join(directory, "target/apple-release/notary-pending.json"),
  };
}

test("release selection permits only macOS direct universal, never deferred packaging", () => {
  const plan = applePlan({ settings, host: "darwin" });
  assert.deepEqual(plan.platforms, ["macos"]);
  assert.deepEqual(plan.rustTargets, [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
  ]);
  assert.equal(plan.distribution, "direct");
  for (const override of [
    { platform: "ios" },
    { platform: "all" },
    { macosArch: "arm64" },
    { distribution: "external" },
  ])
    assert.throws(
      () => applePlan({ settings, host: "darwin", ...override }),
      /macOS\/direct\/universal/,
    );
  assert.throws(() => applePlan({ settings, host: "linux" }), /require macOS/);
});

test("distribution environment excludes signing keys, personal settings and ambient overrides", () => {
  const env = appleEnvironment(
    {
      PATH: "/usr/bin",
      HOME: "/synthetic",
      APPLE_API_PRIVATE_KEY: "excluded",
      TAURI_SIGNING_PRIVATE_KEY: "excluded",
      TAURI_CONFIG: "excluded",
      CARGO_TARGET_DIR: "/foreign",
      NODE_OPTIONS: "excluded",
    },
    "/synthetic/client",
  );
  assert.equal(env.HOME, "/synthetic");
  assert.equal(
    env.CARGO_TARGET_DIR,
    "/synthetic/client/target/apple-release/cargo",
  );
  for (const name of [
    "APPLE_API_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_CONFIG",
    "NODE_OPTIONS",
  ])
    assert.equal(env[name], undefined);
});

test("signing settings retain private dotenv, explicit-empty precedence and CI environment-only behavior", (t) => {
  const { directory } = qualificationFixture(t);
  const root = join(directory, "client");
  mkdirSync(root);
  writeFileSync(
    join(directory, ".env"),
    'APPLE_TEAM_ID="TEAM123456"\nAPPLE_MACOS_SIGNING_IDENTITY="Developer ID Application: Example (TEAM123456)"\n',
    { mode: 0o600 },
  );
  assert.deepEqual(loadAppleSettings(root, undefined, {}), {
    teamId: settings.teamId,
    macosSigningIdentity: settings.macosSigningIdentity,
  });
  assert.throws(
    () => loadAppleSettings(root, undefined, { APPLE_TEAM_ID: "" }),
    /APPLE_TEAM_ID/,
  );
  assert.throws(
    () => loadAppleSettings(root, undefined, { CI: "true" }),
    /APPLE_TEAM_ID/,
  );
});

test("durable notary intent precedes submission; accepted submission IDs persist before waiting", async (t) => {
  const fixture = notaryFixture(t);
  const calls = [];
  await notarize(
    fixture.path,
    { ...settings, notaryJournal: fixture.journal },
    async (_command, args) => {
      calls.push(args);
      if (args[1] === "submit") {
        assert.equal(fixture.journal.entries[0].status, "submitting");
        assert.ok(existsSync(fixture.local));
        return JSON.stringify({ id });
      }
      assert.equal(args[1], "wait");
      assert.equal(fixture.journal.entries.at(-1).id, id);
      return JSON.stringify({ id, status: "Accepted" });
    },
    fixture.options,
  );
  assert.equal(calls.length, 2);
  assert.equal(fixture.journal.entries.at(-1).completed, true);
  assert.ok(!existsSync(fixture.local));
});

test("missing or non-durable controlled-host acknowledgment blocks notarization before external effects", async (t) => {
  const fixture = notaryFixture(t);
  let calls = 0;
  await assert.rejects(
    notarize(
      fixture.path,
      settings,
      async () => {
        calls++;
      },
      fixture.options,
    ),
    /controlled-host durable/,
  );
  fixture.journal.persist = async () => ({
    durable: false,
    operationId: fixture.journal.operationId,
  });
  await assert.rejects(
    notarize(
      fixture.path,
      { ...settings, notaryJournal: fixture.journal },
      async () => {
        calls++;
      },
      fixture.options,
    ),
    /did not acknowledge/,
  );
  assert.equal(calls, 0);
  assert.ok(existsSync(fixture.local));
});

test("unknown submissions and interrupted waits preserve evidence and cannot resubmit", async (t) => {
  for (const failAt of ["submit", "wait"]) {
    const fixture = notaryFixture(t);
    let submissions = 0;
    const execute = async (_command, args) => {
      if (args[1] === "submit") submissions++;
      if (args[1] === failAt) throw new Error("synthetic transport failure");
      return JSON.stringify({ id });
    };
    await assert.rejects(
      notarize(
        fixture.path,
        { ...settings, notaryJournal: fixture.journal },
        execute,
        fixture.options,
      ),
      /transport failure/,
    );
    const pending = JSON.parse(readFileSync(fixture.local));
    assert.equal(pending.status, failAt === "submit" ? "unknown" : "submitted");
    assert.equal(pending.id, failAt === "submit" ? undefined : id);
    await assert.rejects(
      notarize(
        fixture.path,
        { ...settings, notaryJournal: fixture.journal },
        execute,
        fixture.options,
      ),
      /EEXIST/,
    );
    assert.equal(submissions, 1);
  }
});

test("inspect queries only exact known submission IDs and never resubmits unknown attempts", async () => {
  let calls = 0;
  const entry = {
    operationId: "synthetic-operation",
    sha256: "a".repeat(64),
    status: "unknown",
  };
  assert.equal(
    (
      await inspectNotarization(entry, {
        settings,
        execute: async () => {
          calls++;
        },
      })
    ).inspectionRequired,
    true,
  );
  const result = await inspectNotarization(
    { ...entry, id },
    {
      settings,
      execute: async (_command, args) => {
        calls++;
        assert.deepEqual(args.slice(0, 3), ["notarytool", "info", id]);
        return JSON.stringify({ id, status: "Accepted" });
      },
    },
  );
  assert.equal(result.status, "Accepted");
  assert.equal(calls, 1);
});

function buildFixture(t) {
  const fixture = qualificationFixture(t);
  const root = join(fixture.directory, "client");
  mkdirSync(join(root, "app/src-tauri"), { recursive: true });
  mkdirSync(join(root, "node_modules/@tauri-apps/cli"), { recursive: true });
  writeFileSync(join(root, "node_modules/@tauri-apps/cli/tauri.js"), "");
  writeFileSync(
    join(root, "app/src-tauri/tauri.conf.json"),
    JSON.stringify({ version: "0.1.5", identifier: "com.example.situate" }),
  );
  const certificate = join(fixture.directory, "synthetic.p12");
  writeFileSync(certificate, "synthetic certificate", { mode: 0o600 });
  const calls = [];
  const state = {
    revision: fixture.manifest.revision,
    dirty: "",
    toolVersions: {
      node: "v24.21.0",
      npm: "11.19.1",
      rustc: "rustc 1.92.0 (abc123def 2026-10-01)",
      cargo: "cargo 1.92.0 (def456abc 2026-10-01)",
      xcodebuild: "Xcode 26.1\nBuild version 17B55",
      swift:
        "swift-driver version: 1.127.14.1 Apple Swift version 6.2 (swiftlang-6.2.0.19.9 clang-1700.3.19.1)\nTarget: arm64-apple-macosx26.0",
    },
  };
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === process.execPath && args[0] === "--version")
      return state.toolVersions.node;
    if (
      Object.hasOwn(state.toolVersions, command) &&
      ["--version", "-version"].includes(args[0])
    )
      return state.toolVersions[command];
    if (command === "git")
      return args[0] === "rev-parse" ? state.revision : state.dirty;
    if (command === "rustup")
      return args[0] === "which"
        ? "/synthetic/bin/rustc"
        : "aarch64-apple-darwin\nx86_64-apple-darwin";
    if (command === "security" && args[0] === "find-identity")
      return `${"A".repeat(40)} "${settings.macosSigningIdentity}"`;
    return "{}";
  };
  return {
    root,
    releaseInputs: fixture.releaseInputs,
    evidence: fixture.manifest,
    settings,
    host: "darwin",
    expectedVersion: fixture.manifest.version,
    environment: {
      CI: "false",
      PATH: "/usr/bin",
      HOME: fixture.directory,
      SITUATE_UPDATER_PUBLIC_KEY: fixture.artifact.buildConfiguration.publicKey,
      TAURI_SIGNING_PRIVATE_KEY: "synthetic",
      APPLE_DEVELOPER_ID_P12_FILE: certificate,
      APPLE_DEVELOPER_ID_P12_PASSWORD: "synthetic-pass",
    },
    notaryJournal: durableJournal(),
    execute,
    calls,
    state,
  };
}

test("generated version replaces committed version without source edits and migration ancestry remains mandatory", async (t) => {
  const fixture = buildFixture(t);
  let migrations = 0;
  await assert.rejects(
    buildAppleRelease({
      ...fixture,
      qualifyMigrations: async (root, options) => {
        migrations++;
        assert.equal(root, dirname(fixture.root));
        assert.equal(options.revision, fixture.state.revision);
        return {
          schemaVersion: 1,
          source: "macos-direct-publication",
          releases: [],
          migrations: 0,
        };
      },
      collectLicenses: async () => {
        throw new Error("synthetic license stop");
      },
    }),
    /synthetic license stop/,
  );
  assert.equal(migrations, 1);
  assert.equal(
    JSON.parse(
      readFileSync(join(fixture.root, "app/src-tauri/tauri.conf.json")),
    ).version,
    "0.1.5",
  );
  assert.equal(fixture.calls.at(-1).args[0], "delete-keychain");
  const output = join(
    fixture.root,
    "artifacts",
    readdirSync(join(fixture.root, "artifacts"))[0],
  );
  const manifest = JSON.parse(readFileSync(join(output, "manifest.json")));
  assert.equal(manifest.publicCompatibility, undefined);
  assert.equal(manifest.sourceVerification, undefined);
  assert.deepEqual(manifest.verificationHost, {
    platform: process.platform,
    architecture: process.arch,
    runnerImage: { kind: "local" },
    toolchains: fixture.state.toolVersions,
  });
  const probes = fixture.calls.filter(
    ({ command, args }) =>
      (command === process.execPath ||
        Object.hasOwn(fixture.state.toolVersions, command)) &&
      ["--version", "-version"].includes(args[0]),
  );
  assert.equal(probes.length, 6);
  for (const { options } of probes) {
    assert.equal(options.capture, true);
    for (const name of [
      "APPLE_DEVELOPER_ID_P12_PASSWORD",
      "APPLE_API_PRIVATE_KEY",
      "TAURI_SIGNING_PRIVATE_KEY",
      "SITUATE_UPDATER_PUBLIC_KEY",
    ])
      assert.equal(options.env[name], undefined);
  }
});

test("public union and successful source results bind the same manifest and pre-sign distribution resource", async (t) => {
  const fixture = buildFixture(t);
  const { releaseInputsSha256: _binding, ...sourceVerification } =
    fixture.evidence.sourceVerification;
  const publicCompatibility = fixture.evidence.publicCompatibility;
  const hostProof = fixture.evidence.migrationQualification;
  let distribution;
  await assert.rejects(
    buildAppleRelease({
      ...fixture,
      publicCompatibility,
      sourceVerification,
      qualifyMigrations: async () => hostProof,
      collectLicenses: async ({ output }) => {
        mkdirSync(output, { recursive: true });
        return {};
      },
      execute: async (command, args, options) => {
        if (command === process.execPath && args[1] === "build") {
          const overlay = JSON.parse(args[args.indexOf("--config") + 1]);
          const resource = Object.entries(overlay.bundle.resources).find(
            ([, destination]) => destination === "situate-distribution.json",
          )[0];
          distribution = JSON.parse(readFileSync(resource, "utf8"));
          throw new Error("synthetic pre-sign build stop");
        }
        return fixture.execute(command, args, options);
      },
    }),
    /synthetic pre-sign build stop/,
  );
  const output = join(
    fixture.root,
    "artifacts",
    readdirSync(join(fixture.root, "artifacts"))[0],
  );
  const manifest = JSON.parse(readFileSync(join(output, "manifest.json")));
  assert.deepEqual(manifest.publicCompatibility, publicCompatibility);
  assert.deepEqual(manifest.migrationQualification, hostProof);
  assert.equal(manifest.migrationQualification.releases.length, 1);
  assert.equal(manifest.publicCompatibility.qualification.releases.length, 2);
  assert.deepEqual(manifest.sourceVerification, {
    ...sourceVerification,
    releaseInputsSha256: manifest.releaseInputs.sha256,
  });
  for (const name of [
    "publicCompatibility",
    "sourceVerification",
    "migrationQualification",
  ])
    assert.deepEqual(distribution[name], manifest[name]);
  assert.ok(!fixture.calls.some(({ command }) => command === "codesign"));
});

test("public evidence rejects foreign source, failed or incomplete suites and private extra fields before building", async (t) => {
  for (const fault of [
    "public-source",
    "public-private-field",
    "source",
    "failed",
    "missing",
    "duplicate",
    "private-field",
  ]) {
    const fixture = buildFixture(t);
    const publicCompatibility = structuredClone(
      fixture.evidence.publicCompatibility,
    );
    const { releaseInputsSha256: _binding, ...sourceVerification } =
      structuredClone(fixture.evidence.sourceVerification);
    if (fault === "public-source") publicCompatibility.source = "f".repeat(40);
    if (fault === "public-private-field")
      publicCompatibility.qualification.logs = "/private/synthetic";
    if (fault === "source") sourceVerification.source = "f".repeat(40);
    if (fault === "failed") sourceVerification.results[0].status = "failed";
    if (fault === "missing") sourceVerification.results = [];
    if (fault === "duplicate")
      sourceVerification.lanes.push(sourceVerification.lanes[0]);
    if (fault === "private-field")
      sourceVerification.results[0].logs = "/private/synthetic";
    await assert.rejects(
      buildAppleRelease({
        ...fixture,
        publicCompatibility,
        sourceVerification,
        qualifyMigrations: async () => fixture.evidence.migrationQualification,
        collectLicenses: async () =>
          assert.fail("invalid evidence must not reach the build"),
      }),
      /Public compatibility evidence|Source verification/,
    );
  }
});

test("runner metadata records resolved image values and rejects unsafe image or tool output", async (t) => {
  for (const scenario of ["hosted", "unsafe-image", "unsafe-tool"]) {
    const fixture = buildFixture(t);
    fixture.environment.ImageOS = "macos-26";
    fixture.environment.ImageVersion = "20261113.1.0";
    if (scenario === "unsafe-image")
      fixture.environment.ImageVersion = "/private/synthetic-host";
    if (scenario === "unsafe-tool")
      fixture.state.toolVersions.rustc =
        "rustc 1.92.0 (/private/synthetic-host)";
    await assert.rejects(
      buildAppleRelease({
        ...fixture,
        qualifyMigrations: async () => ({
          schemaVersion: 1,
          source: "macos-direct-publication",
          releases: [],
          migrations: 0,
        }),
        collectLicenses: async () => {
          throw new Error("synthetic license stop");
        },
      }),
      scenario === "hosted" ? /synthetic license stop/ : /safe/,
    );
    const output = join(
      fixture.root,
      "artifacts",
      readdirSync(join(fixture.root, "artifacts"))[0],
    );
    const bytes = readFileSync(join(output, "manifest.json"), "utf8");
    const manifest = JSON.parse(bytes);
    assert.ok(!bytes.includes("/private/synthetic-host"));
    if (scenario === "hosted")
      assert.deepEqual(manifest.verificationHost.runnerImage, {
        os: "macos-26",
        version: "20261113.1.0",
      });
    else assert.equal(manifest.verificationHost, undefined);
  }
});

test("generated identity, dirty source and migration failures cannot reach the compiler", async (t) => {
  for (const failure of ["version", "source", "dirty", "migration"]) {
    const fixture = buildFixture(t);
    if (failure === "version") fixture.expectedVersion = "2026.11.2";
    if (failure === "source") fixture.state.revision = "f".repeat(40);
    if (failure === "dirty") fixture.state.dirty = " M tracked-file";
    await assert.rejects(
      buildAppleRelease({
        ...fixture,
        qualifyMigrations: async () => {
          throw new Error("synthetic migration rejection");
        },
      }),
      /version differs|source differs|clean committed|migration rejection/,
    );
    assert.ok(
      !fixture.calls.some(({ command }) => command === process.execPath),
    );
  }
});

test("TestFlight creation is rejected before upload or build", async () => {
  await assert.rejects(
    runAppleRelease({ uploadTestFlight: true }),
    /outside macOS/,
  );
});
