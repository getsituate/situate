import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, catalogDigest } from "./release-catalog.mjs";
import { digest, sealPlan } from "./pipeline-state.mjs";
import {
  createCheckpoint,
  checkpointIdentity,
  createRestoreDirectory,
  writeRestoredFile,
} from "./release-checkpoint.mjs";

export function checkpointFixture(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-checkpoint-test-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = "a".repeat(40);
  const base = "b".repeat(40);
  const write = (directory, name, bytes) =>
    writeFileSync(join(directory, name), bytes, { mode: 0o600 });
  const makePackage = (directory, version) => {
    mkdirSync(directory, { mode: 0o700 });
    const catalog = {
      schemaVersion: 1,
      installedVersion: version,
      releases: [
        { version, locales: { en: { title: "Changes", entries: [] } } },
      ],
    };
    const catalogBytes = `${canonical(catalog)}\n`;
    const inputs = {
      schemaVersion: 1,
      kind: "situate-release-inputs",
      source,
      baseline: base,
      version,
      build: "2026.11.1",
      tag: `v${version}`,
      fragments: [],
      fragmentDigest: digest([]),
      history: {
        file: "situate-release-history.json",
        sha256: digest(catalogBytes),
        contentSha256: catalogDigest(catalog),
      },
      previous: null,
    };
    const inputBytes = `${canonical(inputs)}\n`;
    const manifest = {
      status: "complete",
      distribution: "direct",
      dirty: false,
      revision: source,
      version,
      buildNumber: "2026.11.1",
      artifacts: [
        {
          platform: "macos",
          architecture: "universal",
          identifier: "com.getsituate.app",
          buildConfiguration: {
            endpoint: "https://getsituate.com/releases/current/update.json",
            publicKey: "synthetic-public-key",
          },
          notarized: true,
          path: "Situate.dmg",
          sha256: digest("dmg"),
          updater: {
            path: "Situate.app.tar.gz",
            signature: "synthetic-signature",
            sha256: digest("archive"),
            signaturePath: "Situate.app.tar.gz.sig",
            signatureSha256: digest("signature"),
          },
        },
      ],
      releaseInputs: {
        path: "release-inputs.json",
        sha256: digest(inputBytes),
        catalogPath: "situate-release-history.json",
        catalogSha256: digest(catalogBytes),
      },
    };
    for (const [name, bytes] of Object.entries({
      "manifest.json": JSON.stringify(manifest),
      "Situate.dmg": "dmg",
      "Situate.app.tar.gz": "archive",
      "Situate.app.tar.gz.sig": "signature",
      "release-inputs.json": inputBytes,
      "situate-release-history.json": catalogBytes,
    }))
      write(directory, name, bytes);
    return manifest;
  };
  const directory = join(root, "candidate");
  const predecessorDirectory = join(root, "predecessor");
  const manifest = makePackage(directory, "2026.11.2");
  const predecessor = makePackage(predecessorDirectory, "2026.11.1");
  const facts = {
    operationId: "operation-1",
    operationNonce: "operation-1",
    status: "prepared",
    identityPath: "/releases/.qualification/old/identity.json",
    identitySha256: "c".repeat(64),
    privateAddress: "127.0.0.2",
    interface: "lo0",
    imageId: "sha256:image",
    certificateVolume: "certificates",
    containerName: "old-listener",
  };
  const configuration = {
    schemaVersion: 1,
    updaterPublicKey: "synthetic-public-key",
    qualification: {
      profile: "macos-direct-v1",
      account: {
        mode: "ephemeral-host",
        uid: 501,
        name: "runner",
        home: "/Users/runner",
      },
      runnerImage: "macos:synthetic",
      predecessor: { directory: predecessorDirectory, manifest: predecessor },
      routing: {
        endpoint:
          "https://updates.example.invalid/releases/current/update.json",
        privateAddress: facts.privateAddress,
        publicAddress: "192.0.2.1",
        interface: "lo0",
        identityPath: facts.identityPath,
        identitySha256: facts.identitySha256,
        publicFeedSha256: "d".repeat(64),
        operationId: "operation-1",
      },
    },
    qualificationResources: {
      operation: "operation-1",
      destination: "synthetic@host.invalid",
      tls: { hostname: "updates.example.invalid" },
      facts,
      publicFeedSha256: "d".repeat(64),
    },
  };
  const configurationBytes = JSON.stringify(configuration);
  const plan = sealPlan({
    schemaVersion: 1,
    workflow: "create",
    repository: "getsituate/situate",
    operation: "operation-1",
    source,
    base,
    baseline: { source: base, legacy: true },
    configurationDigest: digest(configurationBytes),
    lanes: [],
    destination: "synthetic@host.invalid",
  });
  const operation = {
    schemaVersion: 1,
    operationId: plan.operation,
    plan,
    status: "running",
    reservation: {
      schemaVersion: 1,
      kind: "situate-release-reservation",
      operationId: plan.operation,
      sourceRevision: plan.source,
      fragmentDigest: digest([]),
      tag: `v${manifest.version}`,
      buildSequence: 20261101,
      version: manifest.version,
      buildNumber: manifest.buildNumber,
      generatedInputDigest: manifest.releaseInputs.sha256,
    },
    stages: [{ name: "build", status: "running" }],
  };
  return {
    root,
    directory,
    manifest,
    configuration,
    configurationBytes,
    plan,
    operation,
    write,
  };
}

export function runtimeFixture(t) {
  const f = checkpointFixture(t);
  const runtime = structuredClone({
    qualification: f.configuration.qualification,
    qualificationResources: f.configuration.qualificationResources,
  });
  runtime.qualification.predecessor.directory = join(
    f.root,
    "fresh-predecessor",
  );
  const routing = runtime.qualification.routing;
  const routeNonce = "qualification-2";
  routing.identityPath = "/releases/.qualification/new/identity.json";
  routing.identitySha256 = "e".repeat(64);
  runtime.qualificationResources.operation = routeNonce;
  Object.assign(runtime.qualificationResources.facts, {
    operationId: f.plan.operation,
    operationNonce: routeNonce,
    identityPath: routing.identityPath,
    identitySha256: routing.identitySha256,
    containerName: "new-listener",
  });
  const descriptor = createCheckpoint({ kind: "build", ...f }).descriptor;
  const observation = {
    operationId: f.plan.operation,
    planDigest: f.plan.authorizationDigest,
    remote: {
      checkpoints: {
        inspectionDigest: "f".repeat(64),
        terminalNotary: true,
        publication: null,
        unresolvedPublication: false,
        coordination: { active: checkpointIdentity(f.plan) },
        checkpoints: [descriptor],
      },
    },
  };
  const inspection = {
    ...observation,
    reconciliationDigest: digest(observation),
  };
  const manifestBytes = readFileSync(join(f.directory, "manifest.json"));
  const recoveryAuthorization = {
    operationId: f.plan.operation,
    planDigest: f.plan.authorizationDigest,
    checkpointId: descriptor.checkpointId,
    descriptor,
    manifestSha256: digest(manifestBytes),
    inspectionDigest: inspection.reconciliationDigest,
  };
  return { ...f, runtime, inspection, manifestBytes, recoveryAuthorization };
}

export function restoredRuntimeFixture(t) {
  const f = runtimeFixture(t);
  const checkpoint = createCheckpoint({ kind: "build", ...f });
  const directory = join(f.root, "restored");
  createRestoreDirectory(directory);
  for (let index = 0; index < checkpoint.files.length; index++) {
    const file = checkpoint.files[index];
    writeRestoredFile(
      directory,
      f.recoveryAuthorization.descriptor.files[index],
      file.bytes ?? readFileSync(file.file),
    );
  }
  f.recoveryAuthorization.directory = directory;
  return {
    ...f,
    directory,
    record: {
      bytes: f.configurationBytes,
      file: join(directory, "configuration.json"),
      sha256: f.plan.configurationDigest,
      configuration: f.configuration,
    },
  };
}
