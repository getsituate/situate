import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  statSync,
  realpathSync,
  renameSync,
  symlinkSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateManifest,
  publicationDestination,
  assertReviewedRevision,
  metadata,
  sshArguments,
  verifyStagedRelease,
  verifyImmutableInputs,
  verifyDownloadReceipt,
  verifyPublicationInputs,
  verifyPublicAvailability,
  qualifyPublicationCompatibility,
} from "./publish.mjs";
import { readPublicationHistory } from "./transport.mjs";
import { updaterSignatureFixture } from "../../client/scripts/updater-signing-fixture.mjs";
import { updaterEndpoint } from "../../client/scripts/updater-signing.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("publication rechecks public compatibility and rejects a newer completed candidate", async () => {
  const manifest = { revision: "a".repeat(40), version: "2026.9.1" };
  const history = { schemaVersion: 1, releases: [] };
  const proof = {
    schemaVersion: 1,
    source: "macos-direct-publication",
    migrations: 2,
    releases: [{ version: "2026.8.1" }, { version: manifest.version }],
  };
  const result = await qualifyPublicationCompatibility("/synthetic", manifest, {
    history,
    qualify: async (root, options) => {
      assert.equal(root, "/synthetic");
      assert.deepEqual(options, { revision: manifest.revision, history });
      return proof;
    },
  });
  assert.deepEqual(result, {
    schemaVersion: 1,
    source: manifest.revision,
    qualification: proof,
  });
  await assert.rejects(
    qualifyPublicationCompatibility("/synthetic", manifest, {
      history,
      qualify: async () => ({
        ...proof,
        releases: [...proof.releases, { version: "2026.10.1" }],
      }),
    }),
    /newer release/,
  );
  await assert.rejects(
    qualifyPublicationCompatibility("/synthetic", manifest, {
      history,
      qualify: async () => {
        throw new Error("Public history unavailable");
      },
    }),
    /history unavailable/,
  );
});

function temporary(t) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-publish-test-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fixture(t) {
  const directory = temporary(t);
  const archive = Buffer.from("synthetic updater, not an Apple app");
  const signed = updaterSignatureFixture(archive);
  const files = {
    "Situate-1.2.3-direct.dmg": Buffer.from("synthetic dmg"),
    "Situate-1.2.3-direct.app.tar.gz": archive,
    "Situate-1.2.3-direct.app.tar.gz.sig": Buffer.from(signed.signature),
  };
  for (const [name, bytes] of Object.entries(files))
    writeFileSync(join(directory, name), bytes);
  const details = (name) => ({
    path: name,
    size: files[name].length,
    sha256: sha256(files[name]),
  });
  const artifact = {
    ...details("Situate-1.2.3-direct.dmg"),
    version: "1.2.3",
    platform: "macos",
    distribution: "direct",
    identifier: "dev.example.app",
    teamId: "TEAM123456",
    architecture: "universal",
    architectures: ["arm64", "x86_64"],
    minimumSystemVersion: "13.0",
    notarized: true,
    bundleSha256: "a".repeat(64),
    buildConfiguration: {
      distribution: "direct",
      publicKey: signed.publicKey,
      endpoint: updaterEndpoint,
      sourceRevision: "b".repeat(40),
      sourceDirty: false,
    },
    updater: {
      ...details("Situate-1.2.3-direct.app.tar.gz"),
      signaturePath: "Situate-1.2.3-direct.app.tar.gz.sig",
      signature: signed.signature,
      signatureSize: files["Situate-1.2.3-direct.app.tar.gz.sig"].length,
      signatureSha256: sha256(files["Situate-1.2.3-direct.app.tar.gz.sig"]),
    },
  };
  const manifest = {
    schemaVersion: 1,
    status: "complete",
    version: "1.2.3",
    revision: "b".repeat(40),
    dirty: false,
    distribution: "direct",
    artifacts: [artifact],
  };
  const expected = {
    revision: manifest.revision,
    identifier: artifact.identifier,
    teamId: artifact.teamId,
    publicKey: signed.publicKey,
  };
  return { directory, manifest, artifact, expected };
}

function sourceRepository(t) {
  const directory = temporary(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      env: {
        PATH: process.env.PATH,
        HOME: directory,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "release-source");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release@example.invalid");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(directory, ".git/test-hooks"));
  git("config", "core.hooksPath", join(directory, ".git/test-hooks"));
  writeFileSync(join(directory, "source.txt"), "reviewed source");
  git("add", "source.txt");
  git("commit", "-m", "Reviewed fixture");
  return { directory, git, revision: git("rev-parse", "HEAD") };
}

test("reviewed commit remains valid on another branch with staged, unstaged and untracked changes", (t) => {
  const { directory, git, revision } = sourceRepository(t);
  git("checkout", "-b", "publisher-tools");
  writeFileSync(join(directory, "source.txt"), "newer source");
  git("commit", "-am", "Newer fixture");
  const head = git("rev-parse", "HEAD");
  assert.notEqual(head, revision);
  writeFileSync(join(directory, "source.txt"), "staged edit");
  git("add", "source.txt");
  writeFileSync(join(directory, "source.txt"), "local edit");
  writeFileSync(join(directory, "untracked.txt"), "untracked fixture");
  const status = git("status", "--porcelain");
  assert.ok(status.length > 0);
  assert.doesNotThrow(() =>
    assertReviewedRevision(revision, { cwd: directory }),
  );
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("status", "--porcelain"), status);
  assert.equal(
    readFileSync(join(directory, "source.txt"), "utf8"),
    "local edit",
  );
});

test("publication rejects abbreviated, missing and non-commit reviewed revisions", (t) => {
  const { directory, git, revision } = sourceRepository(t);
  const blob = git("hash-object", "-w", "source.txt");
  for (const value of [
    undefined,
    "HEAD",
    revision.slice(0, 12),
    `${revision}\n`,
    "0".repeat(40),
    blob,
  ]) {
    assert.throws(
      () => assertReviewedRevision(value, { cwd: directory }),
      /full SHA of a commit available/,
    );
  }
  assert.doesNotThrow(() =>
    assertReviewedRevision(revision, { cwd: directory }),
  );
});

test("destination CLI returns only the host without release inputs or signing credentials", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./publish.mjs", import.meta.url)), "destination"],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        CI: "true",
        WEBSITE_DEPLOY_HOST: "release@cli-host",
        APPLE_API_PRIVATE_KEY: "synthetic-private-value",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { host: "release@cli-host" });
  assert.equal(result.stderr, "");
});

test("publisher accepts absent or legacy recovery evidence without allowing a duplicate attempt", (t) => {
  const directory = temporary(t);
  writeFileSync(join(directory, "publication-journal.json"), "{}");
  for (const legacyArguments of [
    [],
    ["--recovery-evidence", join(directory, "missing-legacy-evidence.json")],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./publish.mjs", import.meta.url)),
        "publish",
        "--release",
        directory,
        "--destination",
        "release@fixture.invalid",
        "--updater-public-key",
        "synthetic-public-key",
        ...legacyArguments,
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH, CI: "true" } },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Publication journal exists; inspect and reconcile instead of retrying/,
    );
    assert.equal(
      readFileSync(join(directory, "publication-journal.json"), "utf8"),
      "{}",
    );
  }
});

test("publication destination reads only the effective host from private dotenv data", (t) => {
  const directory = temporary(t);
  const clientRoot = join(directory, "client");
  mkdirSync(clientRoot);
  const marker = join(directory, "executed");
  writeFileSync(
    join(directory, ".env"),
    `WEBSITE_DEPLOY_HOST="release@dotenv-host"\nAPPLE_API_PRIVATE_KEY="synthetic-private-value"\nUNRELATED="$(touch ${marker})"\n`,
    { mode: 0o600 },
  );
  assert.deepEqual(publicationDestination({ clientRoot, environment: {} }), {
    host: "release@dotenv-host",
  });
  assert.ok(!existsSync(marker));
  assert.deepEqual(
    publicationDestination({
      clientRoot,
      environment: { WEBSITE_DEPLOY_HOST: "release@environment-host" },
    }),
    { host: "release@environment-host" },
  );
  assert.throws(
    () =>
      publicationDestination({
        clientRoot,
        environment: { WEBSITE_DEPLOY_HOST: "" },
      }),
    /Set WEBSITE_DEPLOY_HOST/,
  );
  assert.throws(
    () => publicationDestination({ clientRoot, environment: { CI: "true" } }),
    /Set WEBSITE_DEPLOY_HOST/,
  );
  assert.deepEqual(
    publicationDestination({
      clientRoot,
      environment: { CI: "true", WEBSITE_DEPLOY_HOST: "release@ci-host" },
    }),
    { host: "release@ci-host" },
  );
});

test("destination lookup rejects insecure dotenv files without exposing their contents", (t) => {
  const directory = temporary(t);
  const clientRoot = join(directory, "client");
  mkdirSync(clientRoot);
  writeFileSync(
    join(directory, ".env"),
    "WEBSITE_DEPLOY_HOST=release@dotenv-host\nUNRELATED=synthetic-private-value\n",
    { mode: 0o600 },
  );
  chmodSync(join(directory, ".env"), 0o644);
  if (typeof process.getuid === "function")
    assert.throws(
      () => publicationDestination({ clientRoot, environment: {} }),
      (error) =>
        /private regular file/.test(error.message) &&
        !error.message.includes("synthetic-private-value"),
    );
  assert.deepEqual(
    publicationDestination({
      clientRoot,
      environment: { WEBSITE_DEPLOY_HOST: "release@environment-host" },
    }),
    { host: "release@environment-host" },
  );
});

test("manifest validation authenticates byte identity, reviewed provenance, target and version", (t) => {
  const { directory, manifest, expected } = fixture(t);
  assert.equal(
    validateManifest(directory, manifest, expected),
    manifest.artifacts[0],
  );
  for (const change of [
    { status: "failed" },
    { dirty: true },
    { revision: "c".repeat(40) },
    { distribution: "external" },
    ...["../1.2.3", "01.2.3", "1.2.3-01", "1.2.3/evil", "1.2.3\n"].map(
      (version) => ({ version }),
    ),
  ])
    assert.throws(() =>
      validateManifest(directory, { ...manifest, ...change }, expected),
    );
  for (const change of [
    { distribution: "external" },
    { teamId: "OTHER12345" },
    { identifier: "foreign.app" },
    { architectures: ["arm64"] },
    { path: "../other.dmg" },
    { version: "1.2.4" },
    {
      buildConfiguration: {
        ...manifest.artifacts[0].buildConfiguration,
        sourceDirty: true,
      },
    },
    {
      buildConfiguration: {
        ...manifest.artifacts[0].buildConfiguration,
        sourceRevision: "c".repeat(40),
      },
    },
    {
      buildConfiguration: {
        ...manifest.artifacts[0].buildConfiguration,
        endpoint: "https://evil.example/feed",
      },
    },
  ])
    assert.throws(() =>
      validateManifest(
        directory,
        { ...manifest, artifacts: [{ ...manifest.artifacts[0], ...change }] },
        expected,
      ),
    );
  writeFileSync(join(directory, manifest.artifacts[0].path), "modified bytes");
  assert.throws(
    () => validateManifest(directory, manifest, expected),
    /bytes or size/,
  );
});

test("release-content metadata is additive for retained manifests and consistent across new provenance", (t) => {
  const { directory, manifest, artifact, expected } = fixture(t);
  assert.equal(validateManifest(directory, manifest, expected), artifact);
  const binding = {
    version: "1.2.3",
    sha256: "d".repeat(64),
    locales: ["de", "en"],
  };
  manifest.releaseContent = binding;
  artifact.releaseContent = binding;
  artifact.buildConfiguration.releaseContent = binding;
  assert.equal(validateManifest(directory, manifest, expected), artifact);
  assert.deepEqual(
    metadata(manifest, artifact)["descriptor.json"].artifact.releaseContent,
    binding,
  );
  for (const target of [manifest, artifact, artifact.buildConfiguration]) {
    target.releaseContent = null;
    assert.throws(
      () => validateManifest(directory, manifest, expected),
      /binding/,
    );
    delete target.releaseContent;
    assert.throws(
      () => validateManifest(directory, manifest, expected),
      /binding/,
    );
    target.releaseContent = binding;
    target.releaseContent = { ...binding, sha256: "e".repeat(64) };
    assert.throws(
      () => validateManifest(directory, manifest, expected),
      /bindings disagree/,
    );
    target.releaseContent = binding;
  }
  manifest.releaseContent = { ...binding, version: "1.2.4" };
  assert.throws(
    () => validateManifest(directory, manifest, expected),
    /binding/,
  );
});

test("one descriptor produces coherent HTTPS metadata for both supported macOS architectures", (t) => {
  const { manifest, artifact } = fixture(t);
  const result = metadata(manifest, artifact);
  assert.deepEqual(Object.keys(result["update.json"].platforms), [
    "darwin-aarch64",
    "darwin-x86_64",
  ]);
  assert.equal(result["update.json"].distribution, "direct");
  assert.equal(result["download.json"].version, result["update.json"].version);
  assert.equal(
    result["download.json"].url,
    "https://getsituate.com/releases/1.2.3/Situate-1.2.3-direct.dmg",
  );
  assert.equal(result["descriptor.json"].artifact, artifact);
});

test("staged bytes and metadata remain bound to the original approved manifest", (t) => {
  const { directory, manifest, artifact } = fixture(t);
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  writeFileSync(join(directory, "manifest.json"), manifestBytes);
  mkdirSync(join(directory, "metadata"));
  for (const [name, value] of Object.entries(metadata(manifest, artifact)))
    writeFileSync(
      join(directory, "metadata", name),
      `${JSON.stringify(value, null, 2)}\n`,
    );
  const approved = sha256(manifestBytes);
  verifyStagedRelease(directory, manifest, artifact, approved);
  writeFileSync(join(directory, artifact.path), "late payload mutation");
  assert.throws(
    () => verifyStagedRelease(directory, manifest, artifact, approved),
    /payload changed/,
  );
});

test("explicit history destination needs neither Actions nor ambient publication configuration", () => {
  let invocation;
  const result = readPublicationHistory("/synthetic/root", {
    destination: {
      host: "release@explicit.invalid",
      sshIdentity: "/synthetic/key",
    },
    environment: {
      PATH: "/synthetic/bin",
      WEBSITE_DEPLOY_HOST: "wrong.invalid",
      PRIVATE_KEY: "synthetic-private-value",
    },
    execute: (...args) => {
      invocation = args;
      return JSON.stringify({ schemaVersion: 1, releases: [] });
    },
  });
  assert.deepEqual(result, { schemaVersion: 1, releases: [] });
  assert.equal(invocation[0], "ssh");
  assert.ok(invocation[1].includes("release@explicit.invalid"));
  assert.ok(invocation[1].includes("/synthetic/key"));
  assert.equal(invocation[1].includes("wrong.invalid"), false);
  assert.deepEqual(invocation[2].env, { PATH: "/synthetic/bin" });
});

test("SSH has verified host keys, bounded connection attempts and no shell-injected destination", () => {
  const args = sshArguments({
    WEBSITE_DEPLOY_HOST: "release@release-host",
    WEBSITE_SSH_IDENTITY: "/private/key",
    WEBSITE_SSH_KNOWN_HOSTS: "/private/known_hosts",
  });
  assert.ok(args.includes("UserKnownHostsFile=/private/known_hosts"));
  for (const invalid of [
    "relative/known_hosts",
    "/private/known_hosts\ncommand",
  ])
    assert.throws(() =>
      sshArguments({
        WEBSITE_DEPLOY_HOST: "release@release-host",
        WEBSITE_SSH_KNOWN_HOSTS: invalid,
      }),
    );
  for (const setting of [
    "StrictHostKeyChecking=yes",
    "BatchMode=yes",
    "ConnectionAttempts=1",
    "IdentitiesOnly=yes",
  ])
    assert.ok(args.includes(setting));
  for (const host of [
    "-oProxyCommand=bad",
    "host;touch /tmp/evil",
    "user@host\ncommand",
    "ssh://host",
  ])
    assert.throws(() => sshArguments({ WEBSITE_DEPLOY_HOST: host }));
});

const remotePath = fileURLToPath(new URL("./remote.py", import.meta.url));
function remoteHarness(t) {
  const root = temporary(t);
  const stage = join(root, "stage");
  mkdirSync(stage);
  mkdirSync(join(stage, "metadata"));
  for (const [name, value] of Object.entries({
    "manifest.json": JSON.stringify({
      schemaVersion: 1,
      status: "complete",
      version: "1.2.3",
      revision: "b".repeat(40),
      dirty: false,
      distribution: "direct",
    }),
    "artifact.dmg": "payload",
    "metadata/update.json": "updater",
    "metadata/download.json": "website",
    "metadata/descriptor.json": "descriptor",
  }))
    writeFileSync(join(stage, name), value);
  const files = Object.fromEntries(
    [
      "manifest.json",
      "artifact.dmg",
      "metadata/update.json",
      "metadata/download.json",
      "metadata/descriptor.json",
    ].map((name) => {
      const bytes = readFileSync(join(stage, name));
      return [name, { size: bytes.length, sha256: sha256(bytes) }];
    }),
  );
  const tar = execFileSync(
    "tar",
    ["-cf", "-", "-C", stage, ...Object.keys(files)],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
  const host = join(root, "host");
  mkdirSync(join(host, "releases"), { recursive: true });
  const request = {
    version: "1.2.3",
    token: "11111111-2222-3333-4444-555555555555",
    migrationBaseline: [],
    files,
  };
  const invoke = (action, value = request, input = tar, extra = "") =>
    spawnSync(
      "python3",
      [
        "-c",
        `import importlib.util,sys\nsys.dont_write_bytecode=True\nspec=importlib.util.spec_from_file_location('release_remote',sys.argv[1])\nmodule=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)\nmodule.ROOT=module.Path(sys.argv[2])\nsys.argv=['remote',sys.argv[3],sys.argv[4]]\n${extra}\nmodule.main()`,
        remotePath,
        host,
        action,
        Buffer.from(JSON.stringify(value)).toString("base64"),
      ],
      { input, encoding: "utf8", timeout: 5000 },
    );
  return { root, host, stage, files, tar, request, invoke };
}

function storeRelease(host, version, changes = {}) {
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      status: "complete",
      version,
      revision: "a".repeat(40),
      dirty: false,
      distribution: "direct",
      ...changes,
    }),
  );
  const directory = join(host, "releases", version);
  mkdirSync(directory);
  writeFileSync(join(directory, "manifest.json"), manifest);
  return {
    version,
    revision: "a".repeat(40),
    manifestSha256: sha256(manifest),
  };
}

test("first publication bootstraps a provisioned root without a release directory", (t) => {
  const { host, invoke } = remoteHarness(t);
  rmSync(join(host, "releases"), { recursive: true });
  assert.deepEqual(JSON.parse(invoke("history", {}).stdout).releases, []);
  assert.equal(existsSync(join(host, "releases")), false);
  const result = invoke("publish");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(invoke("history", {}).stdout).releases.length, 1);
});

test("history accepts an empty request and reads sorted immutable manifests without the pointer", (t) => {
  const { host, invoke } = remoteHarness(t);
  assert.deepEqual(JSON.parse(invoke("history", {}).stdout), {
    schemaVersion: 1,
    releases: [],
    qualifications: [],
  });
  const later = storeRelease(host, "1.10.0");
  const earlier = storeRelease(host, "1.2.0");
  symlinkSync("releases/1.2.0/metadata", join(host, "current-release"));
  writeFileSync(join(host, "release-pending.json"), "{}");
  const result = invoke(
    "history",
    {},
    undefined,
    "original=module.history\ndef locked(**kwargs):\n with open(module.ROOT/'release.lock','w') as stream:\n  try: module.fcntl.flock(stream,module.fcntl.LOCK_EX|module.fcntl.LOCK_NB)\n  except BlockingIOError: pass\n  else: raise ValueError('history was not locked')\n return original(**kwargs)\nmodule.history=locked",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    releases: [later, earlier],
    qualifications: [],
  });
  assert.equal(readFileSync(join(host, "release-pending.json"), "utf8"), "{}");
  assert.equal(
    readlinkSync(join(host, "current-release")),
    "releases/1.2.0/metadata",
  );
});

test("history projects only reviewed qualification fields from the same hashed manifest bytes", (t) => {
  const { host, invoke } = remoteHarness(t);
  const predecessor = storeRelease(host, "1.0.0");
  const qualification = {
    schemaVersion: 1,
    source: "macos-direct-publication",
    releases: [{ ...predecessor, privateField: "not for RPC" }],
    migrations: 2,
    legacyEvidenceSha256: "retained in stored bytes",
    privateField: "not for RPC",
  };
  const checkpoint = storeRelease(host, "1.1.0", {
    migrationQualification: qualification,
    privateManifestField: "not for RPC",
  });
  storeRelease(host, "1.2.0", {
    migrationQualification: { ...qualification, schemaVersion: 2 },
  });
  storeRelease(host, "1.3.0", {
    migrationQualification: { ...qualification, source: "external" },
  });
  const before = readFileSync(join(host, "releases/1.1.0/manifest.json"));
  const result = invoke("history", {});
  assert.equal(result.status, 0, result.stderr);
  const history = JSON.parse(result.stdout);
  assert.deepEqual(history.qualifications, [
    {
      release: checkpoint,
      qualification: {
        schemaVersion: 1,
        source: "macos-direct-publication",
        releases: [predecessor],
        migrations: 2,
      },
    },
  ]);
  assert.equal(
    history.qualifications[0].release.manifestSha256,
    sha256(before),
  );
  for (const release of history.releases)
    assert.deepEqual(Object.keys(release).sort(), [
      "manifestSha256",
      "revision",
      "version",
    ]);
  assert.ok(!result.stdout.includes("private"));
  assert.ok(!result.stdout.includes("legacyEvidence"));
  assert.deepEqual(
    readFileSync(join(host, "releases/1.1.0/manifest.json")),
    before,
  );
  const normal = invoke(
    "history",
    {},
    undefined,
    "original=module.history\ndef checked(**kwargs):\n result=original(**kwargs)\n assert original()==result[0]\n return result\nmodule.history=checked",
  );
  assert.equal(normal.status, 0, normal.stderr);
});

test("history fails closed for missing, malformed, oversized and invalid manifests", (t) => {
  for (const change of [
    { schemaVersion: true },
    { schemaVersion: 2 },
    { status: "failed" },
    { dirty: true },
    { distribution: "external" },
    { version: "0.9.1" },
    { revision: "a".repeat(39) },
    { revision: "A".repeat(40) },
    { revision: null },
    "missing",
    "malformed",
    "oversized",
    "symlink",
    "hardlink",
    "fifo",
  ]) {
    const { root, host, invoke } = remoteHarness(t);
    storeRelease(host, "0.9.0", typeof change === "object" ? change : {});
    const path = join(host, "releases/0.9.0/manifest.json");
    if (["missing", "symlink", "hardlink", "fifo"].includes(change))
      rmSync(path);
    if (change === "malformed") writeFileSync(path, "{");
    if (change === "oversized")
      writeFileSync(path, " ".repeat(1024 * 1024 + 1));
    if (change === "symlink" || change === "hardlink") {
      const target = join(root, "manifest-target");
      writeFileSync(target, "{}");
      if (change === "symlink") symlinkSync(target, path);
      else linkSync(target, path);
    }
    if (change === "fifo") execFileSync("mkfifo", [path]);
    const result = invoke("history", {});
    assert.equal(result.status, 1, JSON.stringify(change));
    assert.equal(result.stdout, "");
    assert.equal(existsSync(join(host, "release-pending.json")), false);
  }
  const { host, invoke } = remoteHarness(t);
  rmSync(join(host, "releases"), { recursive: true });
  symlinkSync("releases/0.9.0/metadata", join(host, "current-release"));
  assert.equal(invoke("history", {}).status, 1);
});

test("publication requires the exact unchanged history and preserves prior manifest bytes", (t) => {
  const { host, request, invoke } = remoteHarness(t);
  const prior = storeRelease(host, "0.9.0");
  const path = join(host, "releases/0.9.0/manifest.json");
  const bytes = readFileSync(path);
  for (const migrationBaseline of [
    undefined,
    [],
    [{ ...prior, revision: "c".repeat(40) }],
  ]) {
    const result = invoke("publish", { ...request, migrationBaseline });
    assert.equal(result.status, 1);
    assert.equal(existsSync(join(host, "release-pending.json")), false);
    assert.equal(
      existsSync(join(host, `.release-incoming-${request.token}`)),
      false,
    );
  }
  const result = invoke("publish", { ...request, migrationBaseline: [prior] });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(path), bytes);
  assert.equal(JSON.parse(invoke("history", {}).stdout).releases.length, 2);
});

test("a release appended while waiting for the exclusive lock rejects the baseline before writing", (t) => {
  const { host, invoke } = remoteHarness(t);
  const result = invoke(
    "publish",
    undefined,
    undefined,
    "original=module.fcntl.flock\ndef raced(fd,operation):\n original(fd,operation)\n path=module.ROOT/'releases'/'0.9.0'\n path.mkdir()\n (path/'manifest.json').write_text(module.json.dumps({'schemaVersion':1,'status':'complete','version':'0.9.0','revision':'a'*40,'dirty':False,'distribution':'direct'}))\nmodule.fcntl.flock=raced",
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stale migration baseline/);
  assert.deepEqual(readdirSync(host).sort(), ["release.lock", "releases"]);
  assert.deepEqual(readdirSync(join(host, "releases")), ["0.9.0"]);
});

test("explicit reconciliation upgrades a legacy pending request only when every other field agrees", (t) => {
  for (const renamed of [false, true]) {
    const { host, request, tar, invoke } = remoteHarness(t);
    const failed = renamed
      ? invoke(
          "publish",
          undefined,
          undefined,
          "original=module.os.replace\ndef fail(source,target):\n if target == module.ROOT/'current-release': raise OSError('synthetic activation failure')\n return original(source,target)\nmodule.os.replace=fail",
        )
      : invoke("publish", request, tar.subarray(0, 530));
    assert.equal(failed.status, 1);
    const legacy = { ...request };
    delete legacy.migrationBaseline;
    const marker = join(host, "release-pending.json");
    writeFileSync(marker, JSON.stringify(legacy));
    for (const changed of [
      { ...request, token: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      {
        ...request,
        files: {
          ...request.files,
          "artifact.dmg": { size: 7, sha256: "c".repeat(64) },
        },
      },
    ]) {
      assert.equal(invoke("reconcile", changed).status, 1);
      assert.deepEqual(JSON.parse(readFileSync(marker)), legacy);
    }
    assert.equal(invoke("publish").status, 1);
    const result = invoke("reconcile");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
  }
});

test("all remote actions reject missing, aliased or non-directory release roots", (t) => {
  for (const kind of ["missing", "symlink", "file", "ancestor-symlink"]) {
    const { root, host, invoke } = remoteHarness(t);
    const original = join(root, "original-host");
    renameSync(host, original);
    if (kind === "symlink") symlinkSync(original, host);
    if (kind === "file") writeFileSync(host, "not a release directory");
    if (kind === "ancestor-symlink") symlinkSync(original, host);
    for (const action of ["inspect", "publish", "reconcile"]) {
      const extra =
        kind === "ancestor-symlink" ? "module.ROOT=module.ROOT/'nested'" : "";
      if (kind === "ancestor-symlink")
        mkdirSync(join(original, "nested"), { recursive: true });
      const result = invoke(action, undefined, undefined, extra);
      assert.equal(result.status, 1, `${kind}/${action}: ${result.stdout}`);
      assert.equal(result.stdout, "");
      assert.equal(existsSync(join(original, "release.lock")), false);
      assert.equal(existsSync(join(original, "nested/release.lock")), false);
    }
  }
});

test("publication lock rejects symlinks, hard links, directories and FIFOs without touching their targets", (t) => {
  for (const kind of ["symlink", "hardlink", "directory", "fifo"]) {
    const { root, host, invoke } = remoteHarness(t);
    const target = join(root, "private-target");
    writeFileSync(target, "private sentinel");
    const lock = join(host, "release.lock");
    if (kind === "symlink") symlinkSync(target, lock);
    if (kind === "hardlink") linkSync(target, lock);
    if (kind === "directory") mkdirSync(lock);
    if (kind === "fifo") execFileSync("mkfifo", [lock]);
    for (const action of ["inspect", "publish", "reconcile"]) {
      const result = invoke(action);
      assert.equal(result.status, 1, `${kind}/${action}: ${result.stdout}`);
      assert.match(result.stderr, /single-link regular release file/);
      assert.equal(readFileSync(target, "utf8"), "private sentinel");
      assert.deepEqual(readdirSync(join(host, "releases")), []);
      assert.equal(existsSync(join(host, "release-pending.json")), false);
    }
  }
});

test("a publication lock swapped to a symlink after validation is never followed", (t) => {
  for (const action of ["publish", "reconcile"]) {
    const { root, host, invoke } = remoteHarness(t);
    const target = join(root, "private-target");
    writeFileSync(target, "private sentinel");
    const result = invoke(
      action,
      undefined,
      undefined,
      `original=module.os.open\ndef swapped(path,flags,*args):\n if path == module.ROOT/'release.lock': path.symlink_to(${JSON.stringify(target)})\n return original(path,flags,*args)\nmodule.os.open=swapped`,
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Too many levels of symbolic links/);
    assert.equal(readFileSync(target, "utf8"), "private sentinel");
    assert.deepEqual(readdirSync(join(host, "releases")), []);
    assert.equal(existsSync(join(host, "release-pending.json")), false);
  }
});

test("pending markers and temporary markers reject aliases before reading or mutation", (t) => {
  for (const name of ["release-pending.json", "release-pending.tmp"])
    for (const kind of ["symlink", "hardlink", "directory"]) {
      const { root, host, invoke } = remoteHarness(t);
      const target = join(root, "private-marker");
      writeFileSync(target, '{"private":"sentinel"}');
      const path = join(host, name);
      if (kind === "symlink") symlinkSync(target, path);
      if (kind === "hardlink") linkSync(target, path);
      if (kind === "directory") mkdirSync(path);
      for (const action of ["inspect", "publish", "reconcile"]) {
        const result = invoke(action);
        assert.equal(
          result.status,
          1,
          `${name}/${kind}/${action}: ${result.stdout}`,
        );
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /single-link regular release file/);
        assert.equal(readFileSync(target, "utf8"), '{"private":"sentinel"}');
        assert.equal(existsSync(join(host, "release.lock")), false);
      }
    }
});

test("release storage and reconciliation reject aliased siblings, nested entries and incoming directories", (t) => {
  for (const kind of [
    "releases",
    "sibling",
    "nested",
    "file",
    "incoming",
    "dangling",
  ]) {
    const { root, host, request, invoke } = remoteHarness(t);
    const target = join(root, "outside-directory");
    mkdirSync(target);
    writeFileSync(join(target, "sentinel"), "unchanged");
    if (kind === "releases") {
      rmSync(join(host, "releases"), { recursive: true });
      symlinkSync(target, join(host, "releases"));
    } else if (kind === "incoming")
      symlinkSync(target, join(host, `.release-incoming-${request.token}`));
    else {
      mkdirSync(join(host, "releases"), { recursive: true });
      const sibling = join(host, "releases/0.9.0");
      if (kind === "sibling") symlinkSync(target, sibling);
      if (kind === "dangling") symlinkSync(join(root, "missing"), sibling);
      if (kind === "file") writeFileSync(sibling, "not a directory");
      if (kind === "nested") {
        mkdirSync(sibling);
        symlinkSync(target, join(sibling, "metadata"));
      }
    }
    for (const action of ["inspect", "publish", "reconcile"]) {
      const result = invoke(action);
      assert.equal(result.status, 1, `${kind}/${action}: ${result.stdout}`);
      assert.equal(result.stdout, "");
      assert.equal(readFileSync(join(target, "sentinel"), "utf8"), "unchanged");
      assert.equal(existsSync(join(host, "release.lock")), false);
      assert.equal(existsSync(join(host, "release-pending.json")), false);
    }
  }
});

test("remote storage publishes immutable bytes before one pointer and rejects downgrade or version reuse", (t) => {
  const { host, request, invoke } = remoteHarness(t);
  let result = invoke("publish");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readlinkSync(join(host, "current-release")),
    "releases/1.2.3/metadata",
  );
  assert.equal(existsSync(join(host, "release-pending.json")), false);
  for (const path of ["releases", "releases/1.2.3", "releases/1.2.3/metadata"])
    assert.equal(statSync(join(host, path)).mode & 0o777, 0o755);
  for (const path of [
    "releases/1.2.3/artifact.dmg",
    "releases/1.2.3/metadata/update.json",
  ])
    assert.equal(statSync(join(host, path)).mode & 0o777, 0o644);
  assert.equal(invoke("publish", { ...request, version: "1.2.2" }).status, 1);
  assert.equal(
    invoke("publish", { ...request, version: "1.2.3+replaced" }).status,
    1,
  );
  writeFileSync(join(host, "releases/1.2.3/artifact.dmg"), "tampered");
  result = invoke("publish");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release bytes differ/);
  assert.equal(
    readFileSync(join(host, "releases/1.2.3/artifact.dmg"), "utf8"),
    "tampered",
  );
});

test("interrupted upload retains evidence, blocks blind retry and permits exact explicit reconciliation", (t) => {
  const { host, request, tar, invoke } = remoteHarness(t);
  const failed = invoke("publish", request, tar.subarray(0, 530));
  assert.equal(failed.status, 1);
  assert.equal(existsSync(join(host, "current-release")), false);
  assert.equal(existsSync(join(host, "release-pending.json")), true);
  assert.equal(
    statSync(join(host, "release-pending.json")).mode & 0o777,
    0o600,
  );
  assert.equal(invoke("publish").status, 1);
  const inspection = invoke("inspect", request, undefined);
  assert.equal(inspection.status, 0, inspection.stderr);
  assert.deepEqual(JSON.parse(inspection.stdout).pending, request);
  assert.equal(
    invoke("reconcile", {
      ...request,
      token: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    }).status,
    1,
  );
  const recovered = invoke("reconcile");
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(
    readlinkSync(join(host, "current-release")),
    "releases/1.2.3/metadata",
  );
});

test("failure after immutable rename leaves no advertised release and exact bytes reconcile", (t) => {
  const { host, invoke } = remoteHarness(t);
  const failed = invoke(
    "publish",
    undefined,
    undefined,
    "original=module.os.replace\ndef fail(source,target):\n if target == module.ROOT/'current-release': raise OSError('synthetic activation failure')\n return original(source,target)\nmodule.os.replace=fail",
  );
  assert.equal(failed.status, 1);
  assert.ok(existsSync(join(host, "releases/1.2.3/artifact.dmg")));
  assert.equal(existsSync(join(host, "current-release")), false);
  const recovered = invoke("reconcile");
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(invoke("inspect").stdout).identical, true);
});

test("reconciliation excludes only its identical stored candidate from the original baseline", (t) => {
  const { host, request, invoke } = remoteHarness(t);
  const prior = storeRelease(host, "0.8.0");
  const publication = { ...request, migrationBaseline: [prior] };
  const failed = invoke(
    "publish",
    publication,
    undefined,
    "original=module.os.replace\ndef fail(source,target):\n if target == module.ROOT/'current-release': raise OSError('synthetic activation failure')\n return original(source,target)\nmodule.os.replace=fail",
  );
  assert.equal(failed.status, 1);
  const appended = storeRelease(host, "0.9.0");
  const marker = join(host, "release-pending.json");
  const pendingBytes = readFileSync(marker);
  let result = invoke("reconcile", publication);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stale migration baseline/);
  assert.deepEqual(readFileSync(marker), pendingBytes);
  assert.equal(existsSync(join(host, "current-release")), false);
  result = invoke("reconcile", {
    ...publication,
    migrationBaseline: [prior, appended],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact reconciliation/);
  assert.deepEqual(readFileSync(marker), pendingBytes);
  rmSync(join(host, "releases/0.9.0"), { recursive: true });
  result = invoke("reconcile", publication);
  assert.equal(result.status, 0, result.stderr);
});

test("a lost completion after pointer activation reconciles only the identical active version", (t) => {
  const { host, invoke } = remoteHarness(t);
  const failed = invoke(
    "publish",
    undefined,
    undefined,
    "original=module.sync_directory\ndef fail(path):\n if path == module.ROOT and (module.ROOT/'current-release').is_symlink(): raise OSError('synthetic lost completion')\n return original(path)\nmodule.sync_directory=fail",
  );
  assert.equal(failed.status, 1);
  assert.equal(
    readlinkSync(join(host, "current-release")),
    "releases/1.2.3/metadata",
  );
  assert.equal(existsSync(join(host, "release-pending.json")), true);
  const recovered = invoke("reconcile");
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(existsSync(join(host, "release-pending.json")), false);
});

test("public verification checkpoint blocks new publications until exact completion", (t) => {
  const { host, request, invoke } = remoteHarness(t);
  request.publicVerificationRequired = true;
  request.releaseIdentity = { releaseId: 123 };
  assert.equal(invoke("publish").status, 0);
  assert.deepEqual(
    JSON.parse(readFileSync(join(host, "release-pending.json"))),
    request,
  );
  assert.equal(invoke("publish").status, 1);
  assert.equal(
    invoke("complete", { ...request, releaseIdentity: { releaseId: 124 } })
      .status,
    1,
  );
  assert.equal(existsSync(join(host, "release-pending.json")), true);
  const inspection = invoke("inspect");
  assert.equal(JSON.parse(inspection.stdout).identical, true);
  const completed = invoke("complete");
  assert.equal(completed.status, 0, completed.stderr);
  assert.equal(JSON.parse(completed.stdout).publicVerified, true);
  assert.equal(existsSync(join(host, "release-pending.json")), false);
  assert.equal(invoke("complete").status, 1);
});

test("publication without operational recovery evidence still requires immutable GitHub Release inputs", (t) => {
  const { directory, manifest } = fixture(t);
  assert.throws(
    () => verifyPublicationInputs(directory, manifest, { action: "publish" }),
    /exact GitHub Release, immutable inputs and qualification/,
  );
  assert.deepEqual(
    verifyPublicationInputs(directory, manifest, { action: "reconcile" }),
    {},
  );
  manifest.releaseInputs = { sha256: "a".repeat(64) };
  for (const action of ["publish", "reconcile"])
    assert.throws(
      () => verifyPublicationInputs(directory, manifest, { action }),
      /exact GitHub Release, immutable inputs and qualification/,
    );
});

test("immutable input and download receipts bind public files without operational recovery evidence or copying private journals", (t) => {
  const { directory, manifest, artifact } = fixture(t);
  const inputs = Buffer.from(
    JSON.stringify({
      source: manifest.revision,
      version: manifest.version,
      tag: "v1.2.3",
    }),
  );
  const catalog = Buffer.from("synthetic public catalog");
  manifest.qualification = { path: "release-qualification.json" };
  manifest.releaseInputs = {
    path: "release-inputs.json",
    sha256: sha256(inputs),
    catalogPath: "situate-release-history.json",
    catalogSha256: sha256(catalog),
  };
  const files = {
    "manifest.json": Buffer.from(JSON.stringify(manifest)),
    "release-inputs.json": inputs,
    "situate-release-history.json": catalog,
    "release-qualification.json": Buffer.from("synthetic qualification"),
    "github-release.json": Buffer.from("synthetic public evidence"),
  };
  for (const [name, bytes] of Object.entries(files))
    writeFileSync(join(directory, name), bytes);
  const names = [
    ...Object.keys(files),
    artifact.path,
    artifact.updater.path,
    artifact.updater.signaturePath,
  ];
  const receipt = {
    schemaVersion: 1,
    kind: "github-release-download",
    identity: {
      repository: "getsituate/situate",
      tag: "v1.2.3",
      sourceRevision: manifest.revision,
      version: manifest.version,
      operationId: "synthetic-operation",
      inputSha256: sha256(inputs),
      releaseId: 42,
    },
    evidenceSha256: sha256(files["github-release.json"]),
    assets: names.map((name, index) => ({
      id: index + 1,
      name,
      size: statSync(join(directory, name)).size,
      sha256: sha256(readFileSync(join(directory, name))),
    })),
  };
  assert.deepEqual(verifyImmutableInputs(directory, manifest), {
    "release-inputs.json": sha256(inputs),
    "situate-release-history.json": sha256(catalog),
  });
  assert.equal(
    verifyDownloadReceipt(directory, manifest, receipt),
    receipt.identity,
  );
  const releaseReceipt = join(directory, "github-release-receipt.json");
  const receiptBytes = JSON.stringify(receipt);
  writeFileSync(releaseReceipt, receiptBytes);
  for (const action of ["publish", "reconcile"])
    assert.deepEqual(
      verifyPublicationInputs(directory, manifest, { action, releaseReceipt }),
      {
        releaseIdentity: receipt.identity,
        releaseReceiptSha256: sha256(receiptBytes),
      },
    );
  for (const patch of [
    { identity: { ...receipt.identity, sourceRevision: "c".repeat(40) } },
    { identity: { ...receipt.identity, version: "1.2.4" } },
    { identity: { ...receipt.identity, tag: "v1.2.4" } },
    { identity: { ...receipt.identity, repository: "example/situate" } },
    { identity: { ...receipt.identity, inputSha256: "0".repeat(64) } },
    { assets: receipt.assets.slice(1) },
    {
      assets: [
        ...receipt.assets,
        {
          id: 100,
          name: "private-journal.json",
          size: 1,
          sha256: "a".repeat(64),
        },
      ],
    },
    { assets: receipt.assets.map((item) => ({ ...item, id: 1 })) },
    { evidenceSha256: "c".repeat(64) },
  ])
    assert.throws(() =>
      verifyDownloadReceipt(directory, manifest, { ...receipt, ...patch }),
    );
  writeFileSync(
    join(directory, "situate-release-history.json"),
    "modified catalog",
  );
  assert.throws(
    () => verifyImmutableInputs(directory, manifest),
    /bytes or size/,
  );
  assert.throws(
    () => verifyDownloadReceipt(directory, manifest, receipt),
    /bytes or size/,
  );
  assert.throws(
    () =>
      verifyPublicationInputs(directory, manifest, {
        action: "publish",
        releaseReceipt,
      }),
    /bytes or size/,
  );
});

test("staged generated releases reject changed receipts and private extra files", (t) => {
  const { directory, manifest, artifact } = fixture(t);
  const inputs = Buffer.from("immutable generated inputs");
  const catalog = Buffer.from("immutable catalog");
  manifest.releaseInputs = {
    path: "release-inputs.json",
    sha256: sha256(inputs),
    catalogPath: "situate-release-history.json",
    catalogSha256: sha256(catalog),
  };
  manifest.qualification = { path: "release-qualification.json" };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const receipt = {
    sourceRevision: manifest.revision,
    version: manifest.version,
    manifestSha256: sha256(manifestBytes),
    releaseInputsSha256: sha256(inputs),
    checks: { installation: true },
  };
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  for (const [name, bytes] of Object.entries({
    "manifest.json": manifestBytes,
    "release-inputs.json": inputs,
    "situate-release-history.json": catalog,
    "release-qualification.json": receiptBytes,
  }))
    writeFileSync(join(directory, name), bytes);
  mkdirSync(join(directory, "metadata"));
  for (const [name, value] of Object.entries(metadata(manifest, artifact)))
    writeFileSync(
      join(directory, "metadata", name),
      `${JSON.stringify(value, null, 2)}\n`,
    );
  const verify = () =>
    verifyStagedRelease(
      directory,
      manifest,
      artifact,
      sha256(manifestBytes),
      sha256(receiptBytes),
    );
  assert.doesNotThrow(verify);
  writeFileSync(
    join(directory, "release-qualification.json"),
    JSON.stringify({ ...receipt, checks: { installation: false } }),
  );
  assert.throws(verify, /Qualification receipt differs/);
  writeFileSync(join(directory, "release-qualification.json"), receiptBytes);
  writeFileSync(join(directory, "private-journal.json"), "private state");
  assert.throws(verify, /inventory differs/);
});

test("public availability verifies both feeds and every package after activation", async (t) => {
  const { directory, manifest, artifact } = fixture(t);
  const feeds = metadata(manifest, artifact);
  const requests = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    requests.push(url);
    const name = url.split("/").at(-1);
    return new Response(
      Object.hasOwn(feeds, name)
        ? JSON.stringify(feeds[name])
        : readFileSync(join(directory, name)),
    );
  };
  assert.deepEqual(
    await verifyPublicAvailability(manifest, artifact, { fetchImpl }),
    { version: "1.2.3", verified: true },
  );
  assert.equal(requests.length, 7);
  for (const badResponse of [
    new Response("unavailable", { status: 503 }),
    new Response("{}"),
    new Response("wrong package"),
  ])
    await assert.rejects(
      verifyPublicAvailability(manifest, artifact, {
        fetchImpl: async () => badResponse.clone(),
      }),
    );
  await assert.rejects(
    verifyPublicAvailability(manifest, artifact, {
      fetchImpl: async (url, options) =>
        url.endsWith(artifact.path)
          ? new Response("tampered")
          : fetchImpl(url, options),
    }),
    /package/,
  );
  let count = 0;
  await assert.rejects(
    verifyPublicAvailability(manifest, artifact, {
      fetchImpl: async (url, options) =>
        ++count === 6
          ? new Response(
              JSON.stringify({ ...feeds["download.json"], version: "1.2.4" }),
            )
          : fetchImpl(url, options),
    }),
    /metadata differs/,
  );
});

test("archive inventory attacks cannot escape incoming storage or activate metadata", (t) => {
  const { root, host, stage, request, invoke } = remoteHarness(t);
  writeFileSync(join(root, "outside"), "unapproved");
  const malicious = execFileSync("tar", [
    "-cf",
    "-",
    "-C",
    stage,
    "../outside",
  ]);
  const result = invoke("publish", request, malicious);
  assert.equal(result.status, 1);
  assert.equal(existsSync(join(host, "current-release")), false);
});
