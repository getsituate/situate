import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createReleaseFixture,
  fixtureSnapshot,
  main,
  observeUpdate,
  releasePair,
} from "./qualify-direct-update.mjs";
import { createUpdaterSignerFixture } from "./updater-signing-fixture.mjs";
import { updaterEndpoint } from "./updater-signing.mjs";
import { bundleDigest } from "./direct-release-verification.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function temporary(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-update-observation-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function releases(t, versions = ["0.0.1", "0.0.2"]) {
  const root = temporary(t);
  const signer = createUpdaterSignerFixture();
  const options = {
    root,
    publicKey: signer.publicKey,
    teamId: "TEAM123456",
    app: join(root, "Situate.app"),
    workspace: join(root, "workspace"),
    receipt: join(root, "before.json"),
  };
  mkdirSync(options.app);
  createReleaseFixture(options.workspace);
  for (const [index, name] of ["from", "to"].entries()) {
    const directory = join(root, name);
    mkdirSync(directory);
    options[name] = directory;
    options[`${name}Revision`] = String(index + 1).repeat(40);
    const version = versions[index];
    const payload = Buffer.from(`Synthetic ${name}, not an Apple app`);
    const signature = signer.sign(payload, version);
    const files = {
      "Situate-direct.dmg": payload,
      "Situate-direct.app.tar.gz": payload,
      "Situate-direct.app.tar.gz.sig": Buffer.from(signature),
    };
    for (const [file, bytes] of Object.entries(files))
      writeFileSync(join(directory, file), bytes);
    const details = (path) => ({
      path,
      size: files[path].length,
      sha256: sha(files[path]),
    });
    const manifest = {
      schemaVersion: 1,
      status: "complete",
      distribution: "direct",
      dirty: false,
      version,
      revision: options[`${name}Revision`],
      artifacts: [
        {
          ...details("Situate-direct.dmg"),
          platform: "macos",
          distribution: "direct",
          version,
          identifier: "com.getsituate.app",
          teamId: options.teamId,
          architecture: "universal",
          architectures: ["arm64", "x86_64"],
          minimumSystemVersion: "13.0",
          notarized: true,
          bundleSha256: String(index + 3).repeat(64),
          buildConfiguration: {
            distribution: "direct",
            publicKey: signer.publicKey,
            endpoint: updaterEndpoint,
            sourceRevision: options[`${name}Revision`],
            sourceDirty: false,
          },
          updater: {
            ...details("Situate-direct.app.tar.gz"),
            signaturePath: "Situate-direct.app.tar.gz.sig",
            signature,
            signatureSize: files["Situate-direct.app.tar.gz.sig"].length,
            signatureSha256: sha(files["Situate-direct.app.tar.gz.sig"]),
          },
        },
      ],
    };
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  }
  return options;
}

const syntheticPair = (options) =>
  releasePair(options, { verify: async () => {} });

test("release pair reuses production validation and checks both payloads", async (t) => {
  const options = releases(t);
  const verified = [];
  const result = await releasePair(options, {
    verify: async (directory, artifact, { env }) => {
      verified.push(directory);
      assert.equal(artifact.buildConfiguration.endpoint, updaterEndpoint);
      assert.equal(env.TAURI_SIGNING_PRIVATE_KEY, undefined);
    },
  });
  assert.deepEqual(verified, [options.from, options.to]);
  assert.equal(result.from.version, "0.0.1");
  assert.equal(result.to.revision, options.toRevision);
  await assert.rejects(
    syntheticPair({ ...options, toRevision: "f".repeat(40) }),
    /reviewed/,
  );
  await assert.rejects(
    syntheticPair({ ...options, teamId: "OTHER12345" }),
    /identity/,
  );
  await assert.rejects(
    syntheticPair({
      ...options,
      publicKey: createUpdaterSignerFixture().publicKey,
    }),
    /configuration/,
  );
  writeFileSync(join(options.to, "Situate-direct.app.tar.gz"), "tampered");
  await assert.rejects(syntheticPair(options), /bytes or size/);
});

test("release pair rejects equal versions and downgrades using numeric ordering", async (t) => {
  for (const versions of [
    ["0.0.2", "0.0.2"],
    ["0.0.10", "0.0.9"],
    ["1.0.0", "0.9.9"],
  ])
    await assert.rejects(
      syntheticPair(releases(t, versions)),
      /strictly higher/,
    );
  assert.equal(
    (await syntheticPair(releases(t, ["0.0.9", "0.0.10"]))).to.version,
    "0.0.10",
  );
});

test("native verification failures cannot produce a before receipt", async (t) => {
  const options = releases(t);
  await assert.rejects(
    observeUpdate("begin", options, {
      pair: (inputs) =>
        releasePair(inputs, {
          verify: async () => {
            throw new Error("Apple assessment failed");
          },
        }),
    }),
    /Apple assessment failed/,
  );
  assert.throws(() => statSync(options.receipt), /ENOENT/);
});

test("observations bind exact A and B, original receipt, and unchanged owned fixtures", async (t) => {
  const options = releases(t);
  let installed = "3".repeat(64);
  const dependencies = { pair: syntheticPair, bundle: () => installed };
  assert.equal(
    await observeUpdate("begin", options, dependencies),
    options.receipt,
  );
  const before = readFileSync(options.receipt);
  assert.equal(statSync(options.receipt).mode & 0o777, 0o600);
  await assert.rejects(observeUpdate("begin", options, dependencies), /EEXIST/);
  await assert.rejects(
    observeUpdate("finish", options, dependencies),
    /exact expected/,
  );
  installed = "4".repeat(64);
  const after = await observeUpdate(
    "finish",
    {
      root: options.root,
      receipt: options.receipt,
      publicKey: options.publicKey,
    },
    dependencies,
  );
  const result = JSON.parse(readFileSync(after));
  assert.equal(result.observation, "after");
  assert.equal(result.beforeReceiptSha256, sha(before));
  assert.deepEqual(readFileSync(options.receipt), before);
  await assert.rejects(
    observeUpdate("finish", options, dependencies),
    /EEXIST/,
  );
});

test("filesystem observations reject an altered installed bundle", async (t) => {
  const options = releases(t);
  const installedFile = join(options.app, "synthetic-binary");
  for (const name of ["from", "to"]) {
    writeFileSync(installedFile, name);
    const path = join(options[name], "manifest.json");
    const manifest = JSON.parse(readFileSync(path));
    manifest.artifacts[0].bundleSha256 = bundleDigest(options.app);
    writeFileSync(path, JSON.stringify(manifest));
  }
  const dependencies = { pair: syntheticPair };
  writeFileSync(installedFile, "from");
  await observeUpdate("begin", options, dependencies);
  writeFileSync(installedFile, "partial replacement");
  await assert.rejects(
    observeUpdate("finish", options, dependencies),
    /exact expected/,
  );
  writeFileSync(installedFile, "to");
  await observeUpdate("finish", options, dependencies);
});

test("mutated manifests or fixture ownership block finish even with expected B", async (t) => {
  for (const target of ["manifest", "owner", "content"]) {
    const options = releases(t);
    let installed = "3".repeat(64);
    const dependencies = { pair: syntheticPair, bundle: () => installed };
    await observeUpdate("begin", options, dependencies);
    if (target === "manifest") {
      const path = join(options.to, "manifest.json");
      writeFileSync(path, `${readFileSync(path)}\n`);
    } else if (target === "owner") {
      writeFileSync(
        join(options.workspace, ".situate-release-fixture"),
        "12345678-1234-1234-1234-123456789abc",
      );
    } else
      writeFileSync(
        join(options.workspace, "release-attachment.bin"),
        "changed",
      );
    installed = "4".repeat(64);
    await assert.rejects(
      observeUpdate("finish", options, dependencies),
      /changed/,
    );
  }
});

test("receipts cannot modify observed inputs or change during observation", async (t) => {
  const options = releases(t);
  const dependencies = { pair: syntheticPair, bundle: () => "3".repeat(64) };
  for (const directory of [
    options.from,
    options.to,
    options.app,
    options.workspace,
  ])
    await assert.rejects(
      observeUpdate(
        "begin",
        { ...options, receipt: join(directory, "receipt.json") },
        dependencies,
      ),
      /outside/,
    );
  await observeUpdate("begin", options, dependencies);
  await assert.rejects(
    observeUpdate("finish", options, {
      pair: syntheticPair,
      bundle: () => {
        writeFileSync(options.receipt, "changed during verification");
        return "4".repeat(64);
      },
    }),
    /receipt changed/,
  );
});

test("observations require receipts and all selected inputs inside their qualification directory", async (t) => {
  const options = releases(t);
  const outside = temporary(t);
  const dependencies = {
    pair: () => assert.fail("Unscoped inputs reached release verification"),
  };
  for (const name of ["from", "to", "app", "workspace", "receipt"])
    await assert.rejects(
      observeUpdate("begin", { ...options, [name]: outside }, dependencies),
      /must stay inside/,
    );
  await assert.rejects(
    observeUpdate(
      "finish",
      { ...options, receipt: join(outside, "before.json") },
      dependencies,
    ),
    /must stay inside/,
  );
  const alias = join(options.root, "alias");
  symlinkSync(outside, alias);
  await assert.rejects(
    observeUpdate(
      "begin",
      { ...options, receipt: join(alias, "before.json") },
      dependencies,
    ),
    /must not use a symbolic link/,
  );
  await observeUpdate("begin", options, {
    pair: syntheticPair,
    bundle: () => "3".repeat(64),
  });
  const receipt = JSON.parse(readFileSync(options.receipt));
  receipt.inputs.workspace = outside;
  writeFileSync(options.receipt, JSON.stringify(receipt));
  await assert.rejects(
    observeUpdate("finish", options, dependencies),
    /must stay inside/,
  );
  assert.throws(() => statSync(`${options.receipt}.after.json`), {
    code: "ENOENT",
  });
});

test("observations resolve nested app and workspace directories before verification", async (t) => {
  const options = releases(t);
  const nested = join(options.root, "run with spaces");
  mkdirSync(nested);
  const app = join(nested, "Situate.app");
  const workspace = join(nested, "workspace");
  renameSync(options.app, app);
  renameSync(options.workspace, workspace);
  const dependencies = { pair: syntheticPair, bundle: () => "3".repeat(64) };
  await observeUpdate("begin", { ...options, app, workspace }, dependencies);
  const receipt = JSON.parse(readFileSync(options.receipt));
  assert.equal(receipt.inputs.app, app);
  assert.equal(receipt.inputs.workspace, workspace);

  renameSync(nested, join(options.root, "moved"));
  symlinkSync(join(options.root, "moved"), nested);
  await assert.rejects(
    observeUpdate("finish", options, {
      pair: () => assert.fail("A symlink reached release verification"),
    }),
    /symbolic link/,
  );
});

test("fixtures have a readable legacy workspace marker and allow production initialization", (t) => {
  const root = temporary(t);
  const workspace = join(root, "workspace");
  createReleaseFixture(workspace);
  const directory = join(workspace, ".situate");
  assert.ok(statSync(directory).isDirectory());
  assert.deepEqual(readdirSync(directory), []);
  const before = fixtureSnapshot(workspace);
  writeFileSync(
    join(directory, "workspace.json"),
    JSON.stringify({ version: 1, id: "12345678-1234-4234-8234-123456789abc" }),
  );
  assert.deepEqual(fixtureSnapshot(workspace), before);
  rmSync(directory, { recursive: true });
  assert.throws(() => fixtureSnapshot(workspace), /ENOENT/);
  writeFileSync(directory, "not a directory");
  assert.throws(() => fixtureSnapshot(workspace), /canonical/);
  rmSync(directory);
  const other = join(root, "other");
  mkdirSync(other);
  symlinkSync(other, directory);
  assert.throws(() => fixtureSnapshot(workspace), /canonical/);
});

test("fixture creation never adopts existing directories and snapshots reject links", (t) => {
  const root = temporary(t);
  const workspace = join(root, "workspace");
  createReleaseFixture(workspace);
  assert.throws(() => createReleaseFixture(workspace), /EEXIST/);
  const other = join(root, "other");
  mkdirSync(other);
  assert.throws(() => fixtureSnapshot(other), /Cannot open release file/);
  const alias = join(root, "alias");
  symlinkSync(workspace, alias);
  assert.throws(() => fixtureSnapshot(alias), /canonical/);
  const file = join(workspace, "release-sentinel.md");
  linkSync(file, join(root, "hardlink"));
  assert.throws(() => fixtureSnapshot(workspace), /regular/);
});

test("the fixture command refuses to create a workspace outside the qualification directory", async (t) => {
  const workspace = join(temporary(t), "workspace");
  await assert.rejects(
    main(["fixture", "--workspace", workspace]),
    /must stay inside/,
  );
  assert.throws(() => statSync(workspace), { code: "ENOENT" });
});

test("help needs no credentials and makes no Apple calls", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./qualify-direct-update.mjs", import.meta.url)),
      "--help",
    ],
    {
      env: { PATH: "/usr/bin:/bin" },
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Does not launch/);
});
