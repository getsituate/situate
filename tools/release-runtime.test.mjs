import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  watch,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  automaticQualification,
  downloadPredecessorAsset,
  prepareReleaseRuntime,
  qualificationEnvironment,
  runPreparedQualification,
} from "./release-runtime.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-runtime-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function fixture(t) {
  const root = temporary(t);
  const assets = {
    "candidate.dmg": Buffer.from("synthetic dmg"),
    "candidate.app.tar.gz": Buffer.from("synthetic archive"),
    "candidate.app.tar.gz.sig": Buffer.from("synthetic signature"),
  };
  const artifact = {
    version: "0.1.6",
    path: "candidate.dmg",
    size: assets["candidate.dmg"].length,
    sha256: hash(assets["candidate.dmg"]),
    buildConfiguration: {
      endpoint: "https://getsituate.com/releases/current/update.json",
      publicKey: "synthetic-public-key",
    },
    updater: {
      path: "candidate.app.tar.gz",
      size: assets["candidate.app.tar.gz"].length,
      sha256: hash(assets["candidate.app.tar.gz"]),
      signature: "synthetic signature",
      signaturePath: "candidate.app.tar.gz.sig",
      signatureSha256: hash(assets["candidate.app.tar.gz.sig"]),
    },
  };
  const manifest = {
    status: "complete",
    version: "0.1.6",
    artifacts: [artifact],
  };
  const bytes = JSON.stringify(manifest);
  const feed = JSON.stringify({
    version: "0.1.6",
    platforms: {
      "darwin-aarch64": { signature: artifact.updater.signature },
      "darwin-x86_64": { signature: artifact.updater.signature },
    },
  });
  const configuration = {
    schemaVersion: 1,
    updaterPublicKey: "synthetic-public-key",
    extra: { preserved: true },
    qualification: {
      profile: "macos-direct-v1",
      tls: { caddyContainer: "synthetic-caddy" },
    },
  };
  const record = { configuration, sha256: hash(JSON.stringify(configuration)) };
  const calls = [];
  const facts = {
    operationId: "actions-42-1",
    status: "prepared",
    identityPath: "/releases/.qualification/synthetic/identity.json",
    identitySha256: "a".repeat(64),
    imageId: "sha256:" + "b".repeat(64),
    certificateVolume: "synthetic-certs",
    privateAddress: "127.0.0.2",
    interface: "lo0",
  };
  const options = {
    destination: "operator@synthetic.invalid",
    operation: "actions-42-1",
    platform: "darwin",
    account: { uid: 501, username: "runner", homedir: "/Users/runner" },
    environment: {
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "getsituate/situate",
      ImageOS: "macos26",
      ImageVersion: "20261114",
      WEBSITE_SSH_IDENTITY: "/private/synthetic-key",
      WEBSITE_SSH_KNOWN_HOSTS: "/private/synthetic-hosts",
    },
    desktopProbe: async () => calls.push("desktop"),
    resolveAddress: async () => ({ address: "203.0.113.10" }),
    request: async (url) => {
      calls.push(String(url));
      return new Response(
        String(url).endsWith("current/update.json")
          ? feed
          : assets[new URL(url).pathname.split("/").at(-1)],
      );
    },
    readHistory: () => ({
      releases: [{ version: "0.1.6", manifestSha256: hash(bytes) }],
    }),
    readManifest: () => ({ manifest, bytes, sha256: hash(bytes) }),
    createHost: (host) => {
      calls.push({ host });
      return {
        prepare: (request) => {
          calls.push(request);
          return facts;
        },
      };
    },
    createProfile: (fields) => ({ profile: "macos-direct-v1", ...fields }),
  };
  return {
    root,
    assets,
    artifact,
    manifest,
    bytes,
    feed,
    record,
    options,
    calls,
    facts,
  };
}

test("runtime preparation seals observed account, predecessor, public baseline and private listener facts", async (t) => {
  const f = fixture(t);
  const result = await prepareReleaseRuntime(f.root, f.record, f.options);
  assert.equal(f.calls[0], "desktop");
  assert.equal(result.sha256, hash(readFileSync(result.file)));
  assert.equal(
    result.configuration.configurationTemplateSha256,
    f.record.sha256,
  );
  assert.deepEqual(result.configuration.extra, { preserved: true });
  assert.deepEqual(result.configuration.qualification.account, {
    mode: "ephemeral-host",
    uid: 501,
    name: "runner",
    home: "/Users/runner",
  });
  assert.equal(
    result.configuration.qualification.runnerImage,
    "macos26:20261114",
  );
  assert.equal(
    result.configuration.qualification.routing.publicFeedSha256,
    hash(f.feed),
  );
  assert.equal(
    result.configuration.qualification.routing.publicAddress,
    "203.0.113.10",
  );
  assert.equal(
    result.configuration.qualification.routing.identitySha256,
    f.facts.identitySha256,
  );
  assert.equal(
    result.configuration.qualificationResources.destination,
    f.options.destination,
  );
  assert.equal(automaticQualification(result.configuration), false);
  assert.equal(
    JSON.stringify(result.configuration).includes("synthetic-key"),
    false,
  );
  for (const [name, content] of Object.entries(f.assets))
    assert.deepEqual(
      readFileSync(
        join(result.configuration.qualification.predecessor.directory, name),
      ),
      content,
    );
  const calls = f.calls.length;
  await assert.rejects(
    prepareReleaseRuntime(f.root, f.record, f.options),
    /original sealed plan/,
  );
  result.configuration.updaterPublicKey = "modified-after-preparation";
  writeFileSync(result.file, JSON.stringify(result.configuration));
  await assert.rejects(
    prepareReleaseRuntime(f.root, f.record, f.options),
    /original sealed plan/,
  );
  assert.equal(f.calls.length, calls);
});

test("runtime preparation refuses personal hosts, failed desktop and changed publication history before private setup", async (t) => {
  for (const mode of [
    "personal",
    "desktop",
    "history",
    "trust-key",
    "public-loopback",
  ]) {
    const f = fixture(t);
    if (mode === "personal") f.options.environment.GITHUB_ACTIONS = "false";
    if (mode === "desktop")
      f.options.desktopProbe = async () => {
        throw Error("desktop denied");
      };
    if (mode === "history") f.options.readHistory = () => ({ releases: [] });
    if (mode === "trust-key")
      f.record.configuration.updaterPublicKey = "different-key";
    if (mode === "public-loopback")
      f.options.resolveAddress = async () => ({ address: "127.0.0.2" });
    await assert.rejects(prepareReleaseRuntime(f.root, f.record, f.options));
    assert.equal(
      f.calls.some((call) => call?.operationNonce),
      false,
    );
  }
});

test("local automatic preparation requires an explicit disposable account and observes its OS build", async (t) => {
  const f = fixture(t);
  f.options.environment.GITHUB_ACTIONS = "false";
  f.record.configuration.qualification.account = {
    mode: "ephemeral-host",
    uid: 501,
    name: "runner",
    home: "/Users/runner",
  };
  f.options.execute = (command, args) => {
    assert.equal(command, "/usr/bin/sw_vers");
    assert.deepEqual(args, ["-buildVersion"]);
    return "25B78\n";
  };
  const result = await prepareReleaseRuntime(f.root, f.record, f.options);
  assert.equal(result.configuration.qualification.runnerImage, "macos:25B78");
});

test("predecessor downloads require exact bytes and never replace an unexpected retained asset", async (t) => {
  const root = temporary(t),
    file = join(root, "archive");
  const bytes = Buffer.from("expected synthetic package");
  await assert.rejects(
    downloadPredecessorAsset(
      "https://synthetic.invalid/archive",
      file,
      { size: bytes.length, sha256: hash(bytes) },
      { request: async () => new Response("wrong") },
    ),
    /differs/,
  );
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(file + ".partial"), false);
  await downloadPredecessorAsset(
    "https://synthetic.invalid/archive",
    file,
    { size: bytes.length, sha256: hash(bytes) },
    { request: async () => new Response(bytes) },
  );
  writeFileSync(file, "retained unexpected bytes");
  await assert.rejects(
    downloadPredecessorAsset(
      "https://synthetic.invalid/archive",
      file,
      { size: bytes.length, sha256: hash(bytes) },
      { request: () => assert.fail("No download may replace retained bytes") },
    ),
    /preserve and inspect/,
  );
  assert.equal(readFileSync(file, "utf8"), "retained unexpected bytes");
});

test("qualification setup owns private resources while the native worker receives no credentials", async (t) => {
  const f = fixture(t);
  const prepared = await prepareReleaseRuntime(f.root, f.record, f.options);
  const directory = temporary(t);
  writeFileSync(join(directory, "manifest.json"), f.bytes);
  for (const [name, bytes] of Object.entries(f.assets))
    writeFileSync(join(directory, name), bytes);
  const calls = [];
  const host = {
    inspect: () => f.facts,
    stage: (request) => {
      calls.push("stage");
      assert.equal(request.files.length, 4);
    },
    serve: () => calls.push("serve"),
    cleanup: (request) => {
      calls.push("cleanup");
      assert.equal(request.retainArtifacts, true);
    },
  };
  const result = await runPreparedQualification(f.root, {
    plan: {
      operation: f.options.operation,
      destination: f.options.destination,
    },
    record: prepared,
    configuration: prepared.configuration,
    directory,
    environment: {
      PATH: "/synthetic/bin",
      HOME: "/Users/runner",
      APPLE_API_PRIVATE_KEY: "must-not-forward",
      SITUATE_RELEASE_SSH_PRIVATE_KEY: "must-not-forward",
      GH_TOKEN: "must-not-forward",
      WEBSITE_SSH_IDENTITY: "/private/synthetic-key",
      WEBSITE_SSH_KNOWN_HOSTS: "/private/hosts",
    },
    createHost: (config) => {
      assert.equal(config.sshIdentity, "/private/synthetic-key");
      return host;
    },
    withRoute: async (config, callback) => {
      calls.push("route");
      assert.equal(config.host, host);
      return callback();
    },
    executeWorker: async (_command, args, options) => {
      calls.push("worker");
      assert.deepEqual(options.env, {
        PATH: "/synthetic/bin",
        HOME: "/Users/runner",
      });
      assert.equal(options.terminationGraceMs, 75_000);
      assert.equal(
        args[args.indexOf("--configuration-sha256") + 1],
        prepared.sha256,
      );
      return JSON.stringify({ status: "passed", receipt: "synthetic-receipt" });
    },
  });
  assert.deepEqual(result, { status: "passed", receipt: "synthetic-receipt" });
  assert.deepEqual(calls, ["stage", "serve", "route", "worker", "cleanup"]);
});

test("worker failure and cleanup uncertainty both remain inspectable", async (t) => {
  const f = fixture(t);
  const prepared = await prepareReleaseRuntime(f.root, f.record, f.options);
  const directory = temporary(t);
  writeFileSync(join(directory, "manifest.json"), f.bytes);
  for (const [name, bytes] of Object.entries(f.assets))
    writeFileSync(join(directory, name), bytes);
  const failed = new Error("Synthetic native failure"),
    cleanup = new Error("Synthetic cleanup failure");
  await assert.rejects(
    runPreparedQualification(f.root, {
      plan: {
        operation: f.options.operation,
        destination: f.options.destination,
      },
      record: prepared,
      configuration: prepared.configuration,
      directory,
      environment: {},
      createHost: () => ({
        inspect: () => f.facts,
        stage: () => {},
        serve: () => {},
        cleanup: () => {
          throw cleanup;
        },
      }),
      withRoute: (_route, callback) => callback(),
      executeWorker: async () => {
        throw failed;
      },
    }),
    (error) => {
      assert.equal(error.uncertain, true);
      assert.deepEqual(error.errors, [failed, cleanup]);
      return true;
    },
  );
});

test("qualification cancellation permits cleanup beyond the ordinary process grace", async (t) => {
  const root = temporary(t);
  const ready = join(root, "ready");
  const complete = join(root, "complete");
  const abort = new AbortController();
  const reason = new Error("Synthetic cancellation");
  let observer;
  let rejectReady;
  const started = new Promise((resolve, reject) => {
    rejectReady = reject;
    observer = watch(root, () => {
      if (existsSync(ready)) resolve();
    });
  });
  const startup = setTimeout(() => {
    rejectReady(new Error("Synthetic worker startup timed out"));
    abort.abort(reason);
  }, 10000);
  const { run } = await import("../client/scripts/ios-xcode.mjs");
  const program = `const fs=require('node:fs');const [ready,complete]=process.argv.slice(1);process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(complete,'cleaned');process.exit(0)},3000));fs.writeFileSync(ready,'ready');setInterval(()=>{},1000)`;
  const pending = run(process.execPath, ["-e", program, ready, complete], {
    env: {},
    capture: true,
    signal: abort.signal,
    terminationGraceMs: 75000,
  });
  const rejected = assert.rejects(pending, (error) => error === reason);
  try {
    await started;
    clearTimeout(startup);
    abort.abort(reason);
    await rejected;
    assert.equal(readFileSync(complete, "utf8"), "cleaned");
  } finally {
    clearTimeout(startup);
    observer.close();
    abort.abort(reason);
    await rejected;
  }
});

test("worker environment retains only desktop inputs", () => {
  assert.deepEqual(
    qualificationEnvironment({
      PATH: "/bin",
      USER: "runner",
      GITHUB_TOKEN: "secret",
      APPLE_TEAM_ID: "private",
      WEBSITE_DEPLOY_HOST: "private",
    }),
    { PATH: "/bin", USER: "runner" },
  );
});
