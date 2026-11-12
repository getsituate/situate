import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const legacyEvidencePath = "releases/legacy-migration-evidence.json";

// These signed sources predate the migration package; other sources need a separate audit.
const sources = new Map([
  ["0.0.1", "1d0878ed718712f5f10e7258da8a9f9fcdbb2c55"],
  ["0.1.0", "61955ff3900e3f4b08c94a4b6a161157bcbc6dbf"],
  ["0.1.1", "8b7faa6a0020c337dc9cf7dcf99f8cd760172398"],
  ["0.1.2", "d5fde67967d9f4393a7f3f99faa059b1ddd7919b"],
  ["0.1.3", "cb2829ac7f35f909d10b9c51a9acad23f698250d"],
  ["0.1.5", "6c310a75ecd7d38ff9b4dcf94ba042580f2b68fa"],
]);

export function isLegacyMigrationSource(revision) {
  return [...sources.values()].includes(revision);
}

export function parseLegacyMigrationEvidence(bytes) {
  const evidence = JSON.parse(bytes);
  assert.deepEqual(Object.keys(evidence).sort(), ["releases", "schemaVersion"]);
  assert(
    evidence.schemaVersion === 1 &&
      Array.isArray(evidence.releases) &&
      evidence.releases.length > 0,
    "Invalid legacy migration evidence",
  );
  const versions = new Set();
  for (const record of evidence.releases) {
    assert(
      record && typeof record === "object",
      "Invalid legacy release evidence",
    );
    assert.deepEqual(Object.keys(record).sort(), [
      "manifestSha256",
      "migrations",
      "revision",
      "version",
    ]);
    assert(
      sources.has(record.version) &&
        sources.get(record.version) === record.revision &&
        /^[a-f0-9]{64}$/u.test(record.manifestSha256 ?? "") &&
        !versions.has(record.version),
      "Unknown or duplicate legacy migration source",
    );
    versions.add(record.version);
    assert.deepEqual(
      record.migrations,
      { implementations: [], entries: [], modules: [] },
      "Audited legacy sources have no migration package",
    );
  }
  return evidence;
}

export function verifyLegacyMigrationEvidence(bytes, release) {
  const evidence = parseLegacyMigrationEvidence(bytes);
  assert(
    evidence.releases.some(
      (record) =>
        record.version === release.version &&
        record.revision === release.revision &&
        record.manifestSha256 === release.manifestSha256,
    ),
    "Missing exact legacy publication evidence (version, revision, manifest SHA-256)",
  );
  return {
    version: release.version,
    manifestSha256: release.manifestSha256,
    evidenceSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
