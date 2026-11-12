import assert from "node:assert/strict";
import { readPublicationHistory } from "../infrastructure/releases/transport.mjs";
import {
  verifyMigrationHistory,
  migrationInventory,
  migrationRevision,
  committedLegacyMigrationEvidence,
} from "./migration-history.mjs";
import { parseLegacyMigrationEvidence } from "./legacy-migration-evidence.mjs";

export function qualifyPublishedMigrations(
  root,
  {
    revision = "HEAD",
    history,
    environment = process.env,
    readHistory = readPublicationHistory,
  } = {},
) {
  const candidate = migrationRevision(root, revision);
  const published = history ?? readHistory(root, { environment });
  assert(
    published?.schemaVersion === 1 && Array.isArray(published.releases),
    "Invalid published macOS migration history",
  );
  const versions = new Set();
  let legacyEvidenceSha256;
  for (const release of published.releases) {
    assert(
      release &&
        typeof release.version === "string" &&
        typeof release.revision === "string" &&
        typeof release.manifestSha256 === "string" &&
        /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(
          release.version ?? "",
        ) &&
        /^[a-f0-9]{40}$/.test(release.revision ?? "") &&
        /^[a-f0-9]{64}$/.test(release.manifestSha256 ?? "") &&
        !versions.has(release.version),
      "Invalid or duplicate published macOS release",
    );
    versions.add(release.version);
    const qualification = verifyMigrationHistory(root, {
      publishedRevision: release.revision,
      publishedVersion: release.version,
      publishedManifestSha256: release.manifestSha256,
      revision: candidate,
    });
    if (qualification.legacyEvidence)
      legacyEvidenceSha256 = qualification.legacyEvidence.evidenceSha256;
  }
  const legacyBytes = committedLegacyMigrationEvidence(root, candidate);
  if (legacyBytes) {
    const evidence = parseLegacyMigrationEvidence(legacyBytes);
    for (const record of evidence.releases)
      assert(
        published.releases.some(
          (release) =>
            release.version === record.version &&
            release.revision === record.revision &&
            release.manifestSha256 === record.manifestSha256,
        ),
        "Publication history is missing an audited legacy release",
      );
  }
  // Validate the candidate even when the server has no previous releases.
  const current = migrationInventory(root, candidate);
  return {
    schemaVersion: 1,
    source: "macos-direct-publication",
    ...(legacyEvidenceSha256 ? { legacyEvidenceSha256 } : {}),
    releases: published.releases
      .map(({ version, revision, manifestSha256 }) => ({
        version,
        revision,
        manifestSha256,
      }))
      .sort((a, b) =>
        a.version < b.version ? -1 : a.version > b.version ? 1 : 0,
      ),
    migrations: current.entries.length,
  };
}
