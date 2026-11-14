import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { verifyReleaseInputs } from "./release-inputs.mjs";
import { verifyUpdaterSignature } from "../client/scripts/updater-signing.mjs";
import { verifyDirectPayloads } from "../client/scripts/direct-release-verification.mjs";

export const qualificationAsset = "release-qualification.json";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha = /^[a-f0-9]{64}$/;

function file(directory, name, expected) {
  assert(
    typeof name === "string" && name === basename(name),
    "Invalid release asset path",
  );
  const path = join(directory, name);
  const stat = lstatSync(path);
  assert(
    stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
    "Release asset must be a regular file without links",
  );
  const bytes = readFileSync(path);
  assert(
    sha.test(expected) && digest(bytes) === expected,
    "Release asset hash mismatch",
  );
  return bytes;
}

function artifactIdentity(artifact) {
  return {
    path: artifact.path,
    sha256: artifact.sha256,
    bundleSha256: artifact.bundleSha256,
    updater: {
      path: artifact.updater.path,
      sha256: artifact.updater.sha256,
      signatureSha256: artifact.updater.signatureSha256,
    },
  };
}

function verifyPackages(directory, manifest) {
  assert(
    manifest.status === "complete" &&
      manifest.distribution === "direct" &&
      manifest.dirty === false,
    "Release package is not complete clean direct output",
  );
  assert(
    /^[a-f0-9]{40}$/.test(manifest.revision),
    "Invalid release source revision",
  );
  assert(
    manifest.artifacts?.length === 1,
    "Expected one universal macOS package",
  );
  const artifact = manifest.artifacts[0];
  assert(
    artifact.platform === "macos" &&
      artifact.architecture === "universal" &&
      artifact.version === manifest.version &&
      artifact.notarized === true &&
      artifact.buildConfiguration?.sourceRevision === manifest.revision &&
      artifact.buildConfiguration?.sourceDirty === false,
    "Invalid universal package identity",
  );
  assert(
    isDeepStrictEqual([...artifact.architectures].sort(), ["arm64", "x86_64"]),
    "Invalid universal architectures",
  );
  assert(sha.test(artifact.bundleSha256), "Missing final app digest");
  file(directory, artifact.path, artifact.sha256);
  file(directory, artifact.updater.path, artifact.updater.sha256);
  const signature = file(
    directory,
    artifact.updater.signaturePath,
    artifact.updater.signatureSha256,
  )
    .toString("utf8")
    .trim();
  assert(
    signature === artifact.updater.signature,
    "Updater signature asset differs",
  );
  verifyUpdaterSignature(
    join(directory, artifact.updater.path),
    signature,
    artifact.buildConfiguration.publicKey,
    manifest.version,
  );
  const inputs = manifest.releaseInputs;
  assert(
    inputs?.path === "release-inputs.json" &&
      inputs.catalogPath === "situate-release-history.json",
    "Missing generated release inputs",
  );
  const generated = JSON.parse(file(directory, inputs.path, inputs.sha256));
  const catalogBytes = file(
    directory,
    inputs.catalogPath,
    inputs.catalogSha256,
  ).toString("utf8");
  verifyReleaseInputs(generated, catalogBytes);
  assert(
    generated.source === manifest.revision &&
      generated.version === manifest.version &&
      generated.build === manifest.buildNumber &&
      generated.history.sha256 === inputs.catalogSha256 &&
      isDeepStrictEqual(artifact.buildConfiguration.releaseInputs, inputs),
    "Generated inputs differ from signed package identity",
  );
  assert(
    manifest.qualification?.path === qualificationAsset,
    "Missing qualification receipt pointer",
  );
  verifySourceEvidence(manifest, artifact);
  return artifact;
}

export function verifySourceEvidence(
  manifest,
  artifact = manifest.artifacts?.[0],
) {
  const verification = manifest.sourceVerification;
  assert(
    verification?.schemaVersion === 1 &&
      verification.status === "passed" &&
      verification.source === manifest.revision &&
      verification.releaseInputsSha256 === manifest.releaseInputs?.sha256 &&
      sha.test(verification.planDigest),
    "Missing source verification bound to the release inputs",
  );
  assert(
    Array.isArray(verification.lanes) &&
      verification.lanes.length > 0 &&
      new Set(verification.lanes).size === verification.lanes.length &&
      Array.isArray(verification.results) &&
      verification.results.length > 0 &&
      new Set(verification.results.map((result) => result.id)).size ===
        verification.results.length &&
      verification.results.every(
        (result) =>
          typeof result.id === "string" &&
          result.status === "passed" &&
          result.exitCode === 0,
      ),
    "Source verification contains missing or unsuccessful gates",
  );
  const compatibility = manifest.publicCompatibility;
  assert(
    compatibility?.schemaVersion === 1 &&
      compatibility.source === manifest.revision &&
      compatibility.qualification?.schemaVersion === 1 &&
      compatibility.qualification.source === "macos-direct-publication" &&
      Array.isArray(compatibility.qualification.releases) &&
      Number.isSafeInteger(compatibility.qualification.migrations) &&
      compatibility.qualification.migrations >= 0,
    "Missing public release compatibility evidence",
  );
  assert(
    isDeepStrictEqual(
      verification,
      artifact.buildConfiguration.sourceVerification,
    ) &&
      isDeepStrictEqual(
        compatibility,
        artifact.buildConfiguration.publicCompatibility,
      ),
    "Source verification or compatibility evidence differs from the signed configuration",
  );
  return verification;
}

export function verifyQualificationReceipt(directory, manifest, receipt) {
  const manifestBytes = readFileSync(join(directory, "manifest.json"));
  assert(
    isDeepStrictEqual(JSON.parse(manifestBytes), manifest),
    "Manifest object differs from final bytes",
  );
  const artifact = verifyPackages(directory, manifest);
  assert(
    receipt?.schemaVersion === 1 &&
      receipt.kind === "macos-direct-exact-artifact" &&
      receipt.manifestSha256 === digest(manifestBytes) &&
      receipt.sourceRevision === manifest.revision &&
      receipt.version === manifest.version &&
      receipt.releaseInputsSha256 === manifest.releaseInputs.sha256 &&
      isDeepStrictEqual(receipt.artifact, artifactIdentity(artifact)),
    "Qualification receipt does not bind final package inputs",
  );
  for (const name of [
    "payloadEquality",
    "installation",
    "update",
    "syntheticJourneys",
    "normalTls",
    "productionEndpoint",
  ])
    assert(
      receipt.checks?.[name] === true,
      `Missing qualification check: ${name}`,
    );
  assert(
    receipt.host?.os === "darwin" &&
      ["arm64", "x64"].includes(receipt.host.architecture) &&
      typeof receipt.host.runnerImage === "string" &&
      receipt.host.runnerImage.length > 0,
    "Missing native host identity",
  );
  assert(
    typeof receipt.predecessor?.version === "string" &&
      sha.test(receipt.predecessor.manifestSha256),
    "Missing host-channel predecessor evidence",
  );
  assert(
    Array.isArray(receipt.limitations) &&
      receipt.limitations.includes(
        "Native Intel and minimum-OS qualification are not established.",
      ),
    "Missing native qualification limits",
  );
  return receipt;
}

export async function qualifyRelease({
  directory,
  manifest = JSON.parse(readFileSync(join(directory, "manifest.json"))),
  qualificationHost,
  execute,
  env,
  signal,
}) {
  const artifact = verifyPackages(directory, manifest);
  // A source-built smoke harness cannot install or exercise these signed bytes.
  assert(
    qualificationHost &&
      ["prepare", "install", "journeys", "update", "inspect", "cleanup"].every(
        (name) => typeof qualificationHost[name] === "function",
      ),
    "Blocked: provisioned isolated production-HTTPS routing and an exact-artifact native install/update journey driver are required",
  );
  await verifyDirectPayloads(directory, artifact, { execute, env, signal });
  let session;
  try {
    session = await qualificationHost.prepare({ directory, manifest, signal });
    assert(
      session?.productionEndpoint === artifact.buildConfiguration.endpoint &&
        new URL(session.productionEndpoint).protocol === "https:" &&
        session.normalTls === true &&
        session.isolatedRouting === true &&
        session.publicPointerUnchanged === true &&
        session.signingCredentialsAbsent === true &&
        session.syntheticFixtures === true,
      "Blocked: isolated production HTTPS/TLS prerequisites are not verified",
    );
    const predecessor = session.predecessor;
    assert(
      predecessor?.version && sha.test(predecessor.manifestSha256),
      "Blocked: verified host-channel predecessor is required",
    );
    const installed = await qualificationHost.install({
      session,
      directory,
      artifact,
      signal,
    });
    assert(
      installed?.packageSha256 === artifact.sha256 &&
        installed.bundleSha256 === artifact.bundleSha256 &&
        installed.version === manifest.version &&
        installed.launched === true,
      "Exact DMG installation was not verified",
    );
    const journeys = await qualificationHost.journeys({
      session,
      artifact,
      signal,
    });
    assert(
      journeys?.bundleSha256 === artifact.bundleSha256 &&
        journeys.restartVerified === true &&
        ["workspace", "onboarding", "plugins"].every(
          (name) => journeys[name] === "passed",
        ),
      "Exact installed app synthetic journeys did not pass",
    );
    const updated = await qualificationHost.update({
      session,
      directory,
      artifact,
      predecessor,
      signal,
    });
    assert(
      updated?.predecessorManifestSha256 === predecessor.manifestSha256 &&
        updated.archiveSha256 === artifact.updater.sha256 &&
        updated.bundleSha256 === artifact.bundleSha256 &&
        updated.version === manifest.version &&
        updated.usedProductionUpdater === true &&
        updated.retainedSyntheticData === true &&
        updated.relaunched === true,
      "Exact archive production updater journey did not pass",
    );
    const final = await qualificationHost.inspect({ session, signal });
    assert(
      final?.publicPointerUnchanged === true &&
        final.normalTls === true &&
        final.isolatedRouting === true,
      "Qualification routing or public isolation changed",
    );
    const receipt = {
      schemaVersion: 1,
      kind: "macos-direct-exact-artifact",
      sourceRevision: manifest.revision,
      version: manifest.version,
      releaseInputsSha256: manifest.releaseInputs.sha256,
      manifestSha256: digest(readFileSync(join(directory, "manifest.json"))),
      artifact: artifactIdentity(artifact),
      checks: {
        payloadEquality: true,
        installation: true,
        update: true,
        syntheticJourneys: true,
        normalTls: true,
        productionEndpoint: true,
      },
      host: session.host,
      predecessor,
      limitations: [
        "Native Intel and minimum-OS qualification are not established.",
      ],
    };
    verifyQualificationReceipt(directory, manifest, receipt);
    return receipt;
  } finally {
    await qualificationHost.cleanup({ session, signal: undefined });
  }
}

export async function writeQualificationReceipt(options) {
  const receipt = await qualifyRelease(options);
  const path = join(options.directory, qualificationAsset);
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  return { path, receipt };
}
