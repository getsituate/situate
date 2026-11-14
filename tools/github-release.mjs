import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { verifyReleaseInputs } from "./release-inputs.mjs";
import { ordinaryEnvironment } from "./pipeline-environment.mjs";
import {
  verifyQualificationReceipt,
  verifySourceEvidence,
} from "./release-qualification.mjs";
import {
  assertReleaseRepository,
  githubAdapter,
  readOnlyGitHubAdapter,
} from "../infrastructure/releases/github.mjs";

export const EVIDENCE_ASSET = "github-release.json";
export const PUBLIC_METADATA_ASSETS = Object.freeze([
  "manifest.json",
  "release-inputs.json",
  "situate-release-history.json",
  "release-qualification.json",
]);
const sha = /^[a-f0-9]{64}$/;
const revision = /^[a-f0-9]{40}$/;
export const releaseHash = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const encoded = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const id = (value) =>
  assert(
    Number.isSafeInteger(value) && value > 0,
    "Expected exact positive GitHub ID",
  );

function validateIdentity(identity) {
  assertReleaseRepository(identity?.repository);
  assert(revision.test(identity.sourceRevision), "Invalid source revision");
  assert(
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(
      identity.version,
    ),
    "Invalid version",
  );
  assert.equal(identity.tag, `v${identity.version}`, "Tag/version mismatch");
  assert(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(identity.operationId),
    "Invalid operation identity",
  );
  assert(sha.test(identity.inputSha256), "Missing immutable input digest");
  if (identity.releaseId !== undefined) id(identity.releaseId);
}

function sameIdentity(actual, expected) {
  for (const key of [
    "repository",
    "tag",
    "sourceRevision",
    "version",
    "operationId",
    "inputSha256",
  ])
    assert.equal(actual?.[key], expected[key], `Release ${key} differs`);
}

function publicAsset(name) {
  return (
    PUBLIC_METADATA_ASSETS.includes(name) ||
    /^[A-Za-z0-9][A-Za-z0-9._-]*-direct\.(?:dmg|app\.tar\.gz(?:\.sig)?)$/.test(
      name,
    )
  );
}

export function validateReleaseEvidence(evidence, identity) {
  validateIdentity(identity);
  assert.equal(
    evidence?.schemaVersion,
    1,
    "Unsupported GitHub release evidence",
  );
  sameIdentity(evidence.identity, identity);
  assert.equal(evidence.platform, "macos");
  assert.equal(evidence.distribution, "direct");
  assert(Array.isArray(evidence.assets), "Missing public asset inventory");
  const names = new Set();
  for (const asset of evidence.assets) {
    assert(
      publicAsset(asset.name) && !names.has(asset.name),
      "Unexpected or duplicate public asset",
    );
    names.add(asset.name);
    assert(
      sha.test(asset.sha256) &&
        Number.isSafeInteger(asset.size) &&
        asset.size > 0,
      "Invalid public asset digest/size",
    );
  }
  for (const name of PUBLIC_METADATA_ASSETS)
    assert(names.has(name), `Missing public asset ${name}`);
  const packages = [...names].filter(
    (name) => !PUBLIC_METADATA_ASSETS.includes(name),
  );
  assert.equal(packages.length, 3, "Expected DMG, updater and signature");
  const dmg = packages.find((name) => name.endsWith(".dmg"));
  const archive = packages.find((name) => name.endsWith(".app.tar.gz"));
  assert(
    dmg && archive && names.has(`${archive}.sig`),
    "Incomplete direct package set",
  );
  assert(
    sha.test(evidence.notesSha256),
    "Missing reviewed release-note digest",
  );
  if (evidence.producer !== undefined) {
    for (const key of ["runId", "runAttempt", "workflowId"])
      id(evidence.producer[key]);
  }
  return evidence;
}

function verifyBytes(bytes, asset) {
  assert.equal(bytes.length, asset.size, `Asset size differs: ${asset.name}`);
  assert.equal(
    releaseHash(bytes),
    asset.sha256,
    `Asset hash differs: ${asset.name}`,
  );
}

function verifyContents(files, evidence, { metadataOnly = false } = {}) {
  const parse = (name) => JSON.parse(files[name]);
  const manifest = parse("manifest.json");
  assert.equal(
    manifest.revision,
    evidence.identity.sourceRevision,
    "Package source differs",
  );
  assert.equal(
    manifest.version,
    evidence.identity.version,
    "Package version differs",
  );
  assert.equal(manifest.status, "complete", "Package manifest incomplete");
  assert.equal(
    releaseHash(files["release-inputs.json"]),
    evidence.identity.inputSha256,
    "Generated inputs differ from reservation",
  );
  assert.deepEqual(
    manifest.releaseInputs,
    {
      path: "release-inputs.json",
      sha256: evidence.identity.inputSha256,
      catalogPath: "situate-release-history.json",
      catalogSha256: releaseHash(files["situate-release-history.json"]),
    },
    "Manifest generated input bindings differ",
  );
  const generated = parse("release-inputs.json");
  verifyReleaseInputs(
    generated,
    files["situate-release-history.json"].toString("utf8"),
  );
  assert(
    generated.source === manifest.revision &&
      generated.version === manifest.version &&
      generated.tag === evidence.identity.tag &&
      generated.build === manifest.buildNumber,
    "Generated release identity differs from the package",
  );
  assert.equal(manifest.qualification?.path, "release-qualification.json");
  assert.equal(manifest.distribution, "direct");
  assert.equal(manifest.dirty, false);
  const artifacts = manifest.artifacts?.filter(
    (item) => item.platform === "macos",
  );
  assert.equal(artifacts?.length, 1, "Expected one macOS package");
  const artifact = artifacts[0];
  assert.equal(artifact.version, evidence.identity.version);
  assert.equal(artifact.architecture, "universal");
  assert.equal(artifact.distribution, "direct");
  assert.equal(artifact.notarized, true);
  verifySourceEvidence(manifest, artifact);
  assert(sha.test(artifact.bundleSha256), "Missing bundle digest");
  const packageNames = [
    artifact.path,
    artifact.updater?.path,
    artifact.updater?.signaturePath,
  ];
  assert.deepEqual(
    [...packageNames].sort(),
    evidence.assets
      .filter((asset) => !PUBLIC_METADATA_ASSETS.includes(asset.name))
      .map((asset) => asset.name)
      .sort(),
    "Manifest package inventory differs",
  );
  for (const [name, digest] of [
    [artifact.path, artifact.sha256],
    [artifact.updater.path, artifact.updater.sha256],
    [artifact.updater.signaturePath, artifact.updater.signatureSha256],
  ]) {
    assert.equal(
      evidence.assets.find((asset) => asset.name === name)?.sha256,
      digest,
      "Manifest package inventory hash differs",
    );
    if (!metadataOnly)
      assert.equal(
        releaseHash(files[name]),
        digest,
        "Manifest package hash differs",
      );
  }
  const receipt = parse("release-qualification.json");
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.kind, "macos-direct-exact-artifact");
  assert.equal(receipt.sourceRevision, evidence.identity.sourceRevision);
  assert.equal(receipt.version, evidence.identity.version);
  assert.equal(receipt.releaseInputsSha256, evidence.identity.inputSha256);
  assert.equal(
    receipt.manifestSha256,
    releaseHash(files["manifest.json"]),
    "Receipt manifest binding differs",
  );
  assert.deepEqual(
    receipt.artifact,
    {
      path: artifact.path,
      sha256: artifact.sha256,
      bundleSha256: artifact.bundleSha256,
      updater: {
        path: artifact.updater.path,
        sha256: artifact.updater.sha256,
        signatureSha256: artifact.updater.signatureSha256,
      },
    },
    "Qualification package bindings differ",
  );
  for (const check of [
    "payloadEquality",
    "installation",
    "update",
    "syntheticJourneys",
    "normalTls",
    "productionEndpoint",
  ])
    assert.equal(
      receipt.checks?.[check],
      true,
      `Missing final-artifact check: ${check}`,
    );
  assert.equal(receipt.host?.os, "darwin", "Qualification must run on macOS");
  assert(
    ["arm64", "x64"].includes(receipt.host.architecture),
    "Unsupported qualification host architecture",
  );
  assert(
    typeof receipt.host.runnerImage === "string" &&
      receipt.host.runnerImage.trim(),
    "Missing qualification host identity",
  );
  assert(
    typeof receipt.predecessor?.version === "string" &&
      sha.test(receipt.predecessor?.manifestSha256),
    "Missing installed predecessor identity",
  );
  assert(
    Array.isArray(receipt.limitations) &&
      receipt.limitations.includes(
        "Native Intel and minimum-OS qualification are not established.",
      ),
    "Missing qualification coverage limits",
  );
  return manifest;
}

export function createEvidenceFromDirectory({
  identity,
  directory,
  notes,
  producer,
}) {
  validateIdentity(identity);
  const manifestPath = join(directory, "manifest.json");
  assert(
    lstatSync(manifestPath).isFile() &&
      !lstatSync(manifestPath).isSymbolicLink(),
    "Manifest must be a regular file",
  );
  const manifest = JSON.parse(readFileSync(manifestPath));
  verifyQualificationReceipt(
    directory,
    manifest,
    JSON.parse(readFileSync(join(directory, "release-qualification.json"))),
  );
  const artifact = manifest.artifacts?.find(
    (item) => item.platform === "macos",
  );
  const names = [
    ...PUBLIC_METADATA_ASSETS,
    artifact?.path,
    artifact?.updater?.path,
    artifact?.updater?.signaturePath,
  ];
  const files = {};
  const assets = names.map((name) => {
    assert(
      typeof name === "string" && publicAsset(name),
      "Unexpected public asset path",
    );
    const path = join(directory, name);
    assert(
      lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
      "Public asset must be a regular file",
    );
    files[name] = readFileSync(path);
    return { name, size: files[name].length, sha256: releaseHash(files[name]) };
  });
  const evidence = {
    schemaVersion: 1,
    identity,
    platform: "macos",
    distribution: "direct",
    notesSha256: releaseHash(Buffer.from(notes)),
    assets,
    ...(producer ? { producer } : {}),
  };
  validateReleaseEvidence(evidence, identity);
  verifyContents(files, evidence);
  return { evidence, files };
}

function marker(evidence, digest) {
  return `<!-- situate-release:${Buffer.from(JSON.stringify({ identity: evidence.identity, evidenceSha256: digest, producer: evidence.producer })).toString("base64")} -->`;
}
function readMarker(release) {
  const matches = [
    ...(release.body ?? "").matchAll(
      /<!-- situate-release:([A-Za-z0-9+/=]+) -->/g,
    ),
  ];
  assert.equal(
    matches.length,
    1,
    "Missing or duplicate release identity marker",
  );
  return JSON.parse(Buffer.from(matches[0][1], "base64").toString("utf8"));
}

async function verifyTag(identity, github) {
  const tag = await github.getTag(identity.repository, identity.tag);
  assert.equal(tag.tag, identity.tag);
  assert(revision.test(tag.tagObject), "Missing annotated reservation object");
  assert.equal(
    tag.sourceRevision,
    identity.sourceRevision,
    "Reserved tag source differs",
  );
  const reservation = JSON.parse(tag.message);
  assert.equal(reservation.schemaVersion, 1);
  assert.equal(reservation.kind, "situate-release-reservation");
  assert.equal(reservation.operationId, identity.operationId);
  assert.equal(reservation.sourceRevision, identity.sourceRevision);
  assert.equal(reservation.version, identity.version);
  assert.equal(
    reservation.generatedInputDigest,
    identity.inputSha256,
    "Reserved inputs differ",
  );
  return tag;
}

function verifyRelease(release, identity, evidenceDigest, complete) {
  id(release.id);
  if (identity.releaseId !== undefined)
    assert.equal(release.id, identity.releaseId, "Wrong release ID");
  assert.equal(
    release.html_url,
    `https://github.com/${identity.repository}/releases/tag/${identity.tag}`,
    "Release repository differs",
  );
  assert.equal(release.tag_name, identity.tag, "Release tag differs");
  assert.equal(release.prerelease, false, "Prerelease cannot be promoted");
  if (complete)
    assert(
      release.draft === false && release.published_at,
      "Release is not complete",
    );
  const metadata = readMarker(release);
  sameIdentity(metadata.identity, identity);
  assert.equal(
    metadata.evidenceSha256,
    evidenceDigest,
    "Release evidence binding differs",
  );
}

export async function inspectGitHubOperation(
  { identity, evidence, evidenceSha256 },
  { github = readOnlyGitHubAdapter() } = {},
) {
  validateIdentity(identity);
  const tag = await verifyTag(identity, github);
  const digest = evidence ? releaseHash(encoded(evidence)) : evidenceSha256;
  assert(sha.test(digest), "Supply exact evidence or its SHA-256");
  if (evidence) validateReleaseEvidence(evidence, identity);
  const matches = (await github.listReleases(identity.repository)).filter(
    (release) => release.tag_name === identity.tag,
  );
  assert(matches.length <= 1, "Duplicate releases for reserved tag");
  if (matches.length === 0) {
    assert(identity.releaseId === undefined, "Recorded release disappeared");
    return {
      state: "absent",
      identity,
      evidenceSha256: digest,
      tagObject: tag.tagObject,
      present: [],
      missing: evidence
        ? [...evidence.assets.map((asset) => asset.name), EVIDENCE_ASSET]
        : [EVIDENCE_ASSET],
    };
  }
  const release = await github.getRelease(identity.repository, matches[0].id);
  verifyRelease(release, identity, digest, false);
  assert(Array.isArray(release.assets), "Missing release asset listing");
  const evidenceAssets = release.assets.filter(
    (asset) => asset.name === EVIDENCE_ASSET,
  );
  assert(evidenceAssets.length <= 1, "Duplicate evidence asset");
  let sealed = evidence;
  let evidenceBytes;
  if (evidenceAssets.length) {
    evidenceBytes = Buffer.from(
      await github.downloadAsset(
        identity.repository,
        release.id,
        evidenceAssets[0].id,
      ),
    );
    assert.equal(releaseHash(evidenceBytes), digest, "Evidence bytes differ");
    const remote = validateReleaseEvidence(JSON.parse(evidenceBytes), identity);
    if (sealed)
      assert(isDeepStrictEqual(sealed, remote), "Evidence content differs");
    sealed = remote;
  }
  assert(
    sealed,
    "Supply sealed local evidence to inspect a draft without its evidence asset",
  );
  const expected = [
    ...sealed.assets,
    {
      name: EVIDENCE_ASSET,
      sha256: digest,
      ...(evidenceBytes
        ? { size: evidenceBytes.length }
        : { size: encoded(sealed).length }),
    },
  ];
  assert(
    release.assets.every((asset) =>
      expected.some((item) => item.name === asset.name),
    ),
    "Unexpected draft assets",
  );
  const present = [],
    missing = [];
  for (const item of expected) {
    const found = release.assets.filter((asset) => asset.name === item.name);
    assert(found.length <= 1, "Duplicate draft asset");
    if (found.length === 0) {
      missing.push(item.name);
      continue;
    }
    const asset = found[0];
    id(asset.id);
    assert.equal(asset.state, "uploaded", "Incomplete asset upload");
    assert.equal(asset.size, item.size, "Remote asset size differs");
    const bytes =
      item.name === EVIDENCE_ASSET
        ? evidenceBytes
        : Buffer.from(
            await github.downloadAsset(
              identity.repository,
              release.id,
              asset.id,
            ),
          );
    verifyBytes(bytes, item);
    present.push({ id: asset.id, ...item });
  }
  if (!release.draft) {
    verifyRelease(release, identity, digest, true);
    assert.equal(missing.length, 0, "Completed release is missing assets");
  }
  const notes = release.body.slice(
    0,
    release.body.lastIndexOf("\n\n<!-- situate-release:"),
  );
  assert.equal(
    releaseHash(Buffer.from(notes)),
    sealed.notesSha256,
    "Reviewed notes differ",
  );
  assert.equal(
    (await verifyTag(identity, github)).tagObject,
    tag.tagObject,
    "Reservation tag changed during inspection",
  );
  return {
    state: release.draft ? "draft" : "complete",
    identity: { ...identity, releaseId: release.id },
    releaseId: release.id,
    evidenceSha256: digest,
    tagObject: tag.tagObject,
    present,
    missing,
  };
}

export async function inspectGitHubRelease(
  request,
  { github = readOnlyGitHubAdapter() } = {},
) {
  return inspectReleaseData(request, { github });
}

async function inspectReleaseData(
  { identity, evidence, evidenceSha256 },
  { github = readOnlyGitHubAdapter(), metadataOnly = false } = {},
) {
  validateIdentity(identity);
  id(identity.releaseId);
  const tag = await verifyTag(identity, github);
  const release = await github.getRelease(
    identity.repository,
    identity.releaseId,
  );
  const markers = readMarker(release);
  const digest = evidence ? releaseHash(encoded(evidence)) : evidenceSha256;
  assert(sha.test(digest), "Supply exact evidence or its SHA-256");
  verifyRelease(release, identity, digest, true);
  assert.equal(markers.evidenceSha256, digest);
  const inventory = release.assets;
  assert(Array.isArray(inventory), "Missing release assets");
  const evidenceAssets = inventory.filter(
    (asset) => asset.name === EVIDENCE_ASSET,
  );
  assert.equal(evidenceAssets.length, 1, "Missing or duplicate evidence asset");
  const bytes = Buffer.from(
    await github.downloadAsset(
      identity.repository,
      release.id,
      evidenceAssets[0].id,
    ),
  );
  assert.equal(releaseHash(bytes), digest, "Evidence bytes differ");
  const sealed = validateReleaseEvidence(JSON.parse(bytes), identity);
  if (evidence)
    assert(isDeepStrictEqual(sealed, evidence), "Evidence content differs");
  assert.equal(
    inventory.length,
    sealed.assets.length + 1,
    "Unexpected release assets",
  );
  const files = {};
  for (const expected of sealed.assets) {
    const found = inventory.filter((asset) => asset.name === expected.name);
    assert.equal(
      found.length,
      1,
      `Missing or duplicate asset: ${expected.name}`,
    );
    const asset = found[0];
    id(asset.id);
    assert.equal(asset.state, "uploaded", "Incomplete asset upload");
    assert.equal(asset.size, expected.size, "Remote asset size differs");
    if (asset.digest !== undefined && asset.digest !== null)
      assert.equal(
        asset.digest,
        `sha256:${expected.sha256}`,
        "Remote asset digest differs",
      );
    if (metadataOnly && !PUBLIC_METADATA_ASSETS.includes(expected.name))
      continue;
    const data = Buffer.from(
      await github.downloadAsset(identity.repository, release.id, asset.id),
    );
    verifyBytes(data, expected);
    files[expected.name] = data;
  }
  const manifest = verifyContents(files, sealed, { metadataOnly });
  const publicNotes = release.body.slice(
    0,
    release.body.lastIndexOf("\n\n<!-- situate-release:"),
  );
  assert.equal(
    releaseHash(Buffer.from(publicNotes)),
    sealed.notesSha256,
    "Reviewed notes differ",
  );
  const receipt = {
    schemaVersion: 1,
    kind: "github-release-download",
    identity: { ...identity, releaseId: release.id },
    evidenceSha256: digest,
    assets: [
      ...sealed.assets,
      { name: EVIDENCE_ASSET, size: bytes.length, sha256: digest },
    ].map((asset) => ({
      id: inventory.find((item) => item.name === asset.name).id,
      ...asset,
    })),
  };
  assert.equal(
    (await verifyTag(identity, github)).tagObject,
    tag.tagObject,
    "Reservation tag changed during inspection",
  );
  return {
    identity: receipt.identity,
    evidence: sealed,
    evidenceBytes: bytes,
    evidenceSha256: digest,
    release,
    files,
    manifest,
    receipt,
  };
}

export async function downloadGitHubRelease(
  { destination, ...request },
  options,
) {
  const verified = await inspectGitHubRelease(request, options);
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  for (const [name, bytes] of Object.entries(verified.files))
    writeFileSync(join(destination, name), bytes, { flag: "wx", mode: 0o600 });
  writeFileSync(join(destination, EVIDENCE_ASSET), verified.evidenceBytes, {
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(
    join(destination, "github-release-receipt.json"),
    encoded(verified.receipt),
    { flag: "wx", mode: 0o600 },
  );
  return { ...verified, directory: destination };
}

function saveJournal(path, journal) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, encoded(journal));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  const parent = openSync(dirname(path), "r");
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}

export async function createGitHubRelease(
  { identity, files, evidence, notes, journalPath },
  { github = githubAdapter(), authorize, reconcile = false } = {},
) {
  validateReleaseEvidence(evidence, identity);
  assert.equal(
    identity.releaseId,
    undefined,
    "Creator resolves its reserved tag, not an unrelated release ID",
  );
  assert.equal(
    releaseHash(Buffer.from(notes)),
    evidence.notesSha256,
    "Reviewed notes digest differs",
  );
  assert.deepEqual(
    Object.keys(files).sort(),
    evidence.assets.map((asset) => asset.name).sort(),
    "Only allowlisted public assets may be uploaded",
  );
  const bytes = Object.fromEntries(
    evidence.assets.map((asset) => {
      const value = files[asset.name];
      const data = Buffer.isBuffer(value)
        ? value
        : (() => {
            assert(
              lstatSync(value).isFile() && !lstatSync(value).isSymbolicLink(),
              "Asset must be a regular file",
            );
            return readFileSync(value);
          })();
      verifyBytes(data, asset);
      return [asset.name, data];
    }),
  );
  verifyContents(bytes, evidence);
  const evidenceBytes = encoded(evidence);
  const digest = releaseHash(evidenceBytes);
  const body = `${notes}\n\n${marker(evidence, digest)}`;
  const tag = await verifyTag(identity, github);
  assert.equal(
    typeof authorize,
    "function",
    "Exact release authorization is required",
  );
  await authorize({
    identity,
    evidenceSha256: digest,
    tagObject: tag.tagObject,
  });
  let journal = {
    schemaVersion: 1,
    identity,
    evidenceSha256: digest,
    tagObject: tag.tagObject,
    state: "prepared",
  };
  if (existsSync(journalPath)) {
    assert(
      (lstatSync(journalPath).mode & 0o077) === 0 &&
        !lstatSync(journalPath).isSymbolicLink(),
      "Recovery journal must be private",
    );
    journal = JSON.parse(readFileSync(journalPath));
    assert(
      isDeepStrictEqual(journal.identity, identity) &&
        journal.evidenceSha256 === digest &&
        journal.tagObject === tag.tagObject,
      "Recovery operation differs",
    );
    assert(
      reconcile || journal.state === "complete",
      "Inspect existing operation before explicit reconciliation",
    );
  } else saveJournal(journalPath, journal);
  const effect = async (state, operation) => {
    journal.state = state;
    saveJournal(journalPath, journal);
    return operation();
  };
  const releases = (await github.listReleases(identity.repository)).filter(
    (release) => release.tag_name === identity.tag,
  );
  assert(releases.length <= 1, "Duplicate releases for reserved tag");
  let release = releases[0];
  if (!release) {
    assert(!journal.releaseId, "Recorded release disappeared");
    release = await effect("creating", () =>
      github.createDraft(identity.repository, {
        tag_name: identity.tag,
        target_commitish: identity.sourceRevision,
        name: identity.version,
        body,
        draft: true,
        prerelease: false,
      }),
    );
  }
  if (journal.releaseId !== undefined)
    assert.equal(release.id, journal.releaseId, "Recovery release ID differs");
  journal.releaseId = release.id;
  saveJournal(journalPath, journal);
  verifyRelease(release, identity, digest, false);
  if (!release.draft) {
    const result = await inspectGitHubRelease(
      { identity: { ...identity, releaseId: release.id }, evidence },
      { github },
    );
    journal.state = "complete";
    saveJournal(journalPath, journal);
    return result;
  }
  assert.equal(release.body, body, "Draft notes or identity changed");
  const expected = [
    ...evidence.assets,
    { name: EVIDENCE_ASSET, size: evidenceBytes.length, sha256: digest },
  ];
  bytes[EVIDENCE_ASSET] = evidenceBytes;
  assert(
    release.assets.every((asset) =>
      expected.some((item) => item.name === asset.name),
    ),
    "Unexpected draft assets",
  );
  for (const asset of expected) {
    release = await github.getRelease(identity.repository, release.id);
    const present = release.assets.filter((item) => item.name === asset.name);
    assert(present.length <= 1, "Duplicate draft asset");
    if (present.length)
      verifyBytes(
        Buffer.from(
          await github.downloadAsset(
            identity.repository,
            release.id,
            present[0].id,
          ),
        ),
        asset,
      );
    else
      await effect(`uploading:${asset.name}`, () =>
        github.uploadAsset(
          identity.repository,
          release.id,
          asset.name,
          bytes[asset.name],
        ),
      );
  }
  // Re-read every byte before making the draft public.
  release = await github.getRelease(identity.repository, release.id);
  assert.equal(
    release.assets.length,
    expected.length,
    "Draft inventory changed",
  );
  for (const asset of expected) {
    const found = release.assets.filter((item) => item.name === asset.name);
    assert.equal(found.length, 1, "Draft inventory changed");
    verifyBytes(
      Buffer.from(
        await github.downloadAsset(
          identity.repository,
          release.id,
          found[0].id,
        ),
      ),
      asset,
    );
  }
  assert.equal(release.body, body, "Draft notes or identity changed");
  verifyRelease(release, identity, digest, false);
  assert.equal(
    (await verifyTag(identity, github)).tagObject,
    tag.tagObject,
    "Reservation tag changed during creation",
  );
  await effect("finalizing", () =>
    github.finalize(identity.repository, release.id),
  );
  const result = await inspectGitHubRelease(
    { identity: { ...identity, releaseId: release.id }, evidence },
    { github },
  );
  journal.state = "complete";
  saveJournal(journalPath, journal);
  return result;
}

export async function resolveWorkflowRunRelease(
  { repository, runId, workflowId, workflowPath, protectedBranch = "main" },
  { github = readOnlyGitHubAdapter() } = {},
) {
  assertReleaseRepository(repository);
  id(runId);
  id(workflowId);
  assert.equal(
    protectedBranch,
    "main",
    "Release workflow must use protected main",
  );
  const run = await github.getRun(repository, runId);
  const workflow = await github.getWorkflow(repository, workflowId);
  assert.equal(run.id, runId);
  assert.equal(
    run.repository?.full_name,
    repository,
    "Wrong producer repository",
  );
  assert.equal(
    run.head_repository?.full_name,
    repository,
    "Fork producer rejected",
  );
  assert.equal(run.workflow_id, workflowId, "Wrong producer workflow");
  assert.equal(workflow.id, workflowId);
  assert.equal(workflow.path, workflowPath, "Wrong producer workflow path");
  assert.equal(workflow.state, "active");
  assert.equal(run.head_branch, protectedBranch);
  assert.equal(run.event, "push");
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert(revision.test(run.head_sha), "Missing producer source");
  const matches = [];
  for (const release of await github.listReleases(repository)) {
    if (
      release.draft ||
      release.prerelease ||
      !release.body?.includes("<!-- situate-release:")
    )
      continue;
    const metadata = readMarker(release);
    if (
      metadata.producer?.runId !== runId ||
      metadata.producer?.runAttempt !== run.run_attempt
    )
      continue;
    assert.equal(metadata.producer.workflowId, workflowId);
    assert.equal(metadata.identity.sourceRevision, run.head_sha);
    const result = await inspectGitHubRelease(
      {
        identity: { ...metadata.identity, releaseId: release.id },
        evidenceSha256: metadata.evidenceSha256,
      },
      { github },
    );
    assert(
      isDeepStrictEqual(result.evidence.producer, metadata.producer),
      "Producer evidence differs",
    );
    matches.push({
      identity: result.identity,
      evidenceSha256: result.evidenceSha256,
    });
  }
  assert.equal(
    matches.length,
    1,
    "Expected exactly one completed release for producer run",
  );
  return matches[0];
}

export async function readCompletedReleaseBaseline(
  root,
  {
    environment = process.env,
    github = readOnlyGitHubAdapter({ environment }),
    repository = "getsituate/situate",
    revision: candidate = "HEAD",
    execute = execFileSync,
  } = {},
) {
  assertReleaseRepository(repository);
  const git = (...args) =>
    execute("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...ordinaryEnvironment(environment),
        GIT_NO_LAZY_FETCH: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
      },
    }).trim();
  const source = git("rev-parse", "--verify", `${candidate}^{commit}`);
  assert(revision.test(source), "Missing candidate source history");
  const completed = [];
  for (const release of await github.listReleases(repository)) {
    if (release.draft || release.prerelease) continue;
    const metadata = readMarker(release);
    const verified = await inspectReleaseData(
      {
        identity: { ...metadata.identity, releaseId: release.id },
        evidenceSha256: metadata.evidenceSha256,
      },
      { github, metadataOnly: true },
    );
    git(
      "merge-base",
      "--is-ancestor",
      verified.identity.sourceRevision,
      source,
    );
    completed.push(verified);
  }
  completed.sort((left, right) => {
    const a = left.identity.version.split(".").map(BigInt),
      b = right.identity.version.split(".").map(BigInt);
    const index = a.findIndex((part, offset) => part !== b[offset]);
    assert(
      index !== -1 || left.release.id === right.release.id,
      "Duplicate completed version",
    );
    return index === -1 ? 0 : a[index] < b[index] ? -1 : 1;
  });
  for (let index = 1; index < completed.length; index++)
    git(
      "merge-base",
      "--is-ancestor",
      completed[index - 1].identity.sourceRevision,
      completed[index].identity.sourceRevision,
    );
  const last = completed.at(-1);
  return last
    ? {
        identity: last.identity,
        evidence: last.evidence,
        catalogBytes: last.files["situate-release-history.json"],
        catalogSha256: releaseHash(last.files["situate-release-history.json"]),
        source: last.identity.sourceRevision,
      }
    : null;
}

export async function readGitHubMigrationHistory(
  root,
  {
    environment = process.env,
    github = readOnlyGitHubAdapter({ environment }),
    repository = "getsituate/situate",
    includeBuilds = false,
  } = {},
) {
  assertReleaseRepository(repository);
  const releases = [];
  const builds = [];
  for (const release of await github.listReleases(repository)) {
    if (release.draft || release.prerelease) continue;
    const metadata = readMarker(release);
    const verified = await inspectReleaseData(
      {
        identity: { ...metadata.identity, releaseId: release.id },
        evidenceSha256: metadata.evidenceSha256,
      },
      { github, metadataOnly: true },
    );
    if (includeBuilds) {
      const manifest = JSON.parse(verified.files["manifest.json"]);
      const build = manifest.artifacts[0].buildNumber ?? manifest.buildNumber;
      assert(
        typeof build === "string" &&
          /^[1-9][0-9]{0,3}\.(?:0|[1-9][0-9]?)\.(?:0|[1-9][0-9]?)$/.test(build),
        "Completed release has no valid verified Apple build number",
      );
      builds.push(build);
    }
    releases.push({
      version: verified.identity.version,
      revision: verified.identity.sourceRevision,
      manifestSha256: releaseHash(verified.files["manifest.json"]),
    });
  }
  return { schemaVersion: 1, releases, ...(includeBuilds ? { builds } : {}) };
}
