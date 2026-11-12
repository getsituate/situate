import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readPublicationHistory } from "../infrastructure/releases/transport.mjs";
import {
  verifyMigrationHistory,
  migrationInventory,
  migrationRevision,
} from "./migration-history.mjs";

function validateRelease(release) {
  assert(
    release &&
      Object.keys(release).sort().join() ===
        "manifestSha256,revision,version" &&
      typeof release.version === "string" &&
      typeof release.revision === "string" &&
      typeof release.manifestSha256 === "string" &&
      /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(
        release.version ?? "",
      ) &&
      /^[a-f0-9]{40}$/.test(release.revision ?? "") &&
      /^[a-f0-9]{64}$/.test(release.manifestSha256 ?? ""),
    "Invalid published macOS release",
  );
}

function sameRelease(left, right) {
  return (
    left.version === right.version &&
    left.revision === right.revision &&
    left.manifestSha256 === right.manifestSha256
  );
}

function committedCheckpoint(root) {
  const path = "releases/migration-checkpoint.json";
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_NO_LAZY_FETCH: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
      },
    });
  // The publication tool may qualify an artifact older than this provenance pin.
  const toolRevision = migrationRevision(root, "HEAD");
  const entry = git("ls-tree", toolRevision, "--", path).trim();
  if (!entry) return undefined;
  assert(
    /^100644 blob /u.test(entry),
    "Invalid committed migration checkpoint file",
  );
  const checkpoint = JSON.parse(git("show", `${toolRevision}:${path}`));
  assert(
    checkpoint?.schemaVersion === 1 &&
      Object.keys(checkpoint).sort().join() === "release,schemaVersion",
    "Invalid migration checkpoint",
  );
  validateRelease(checkpoint.release);
  return checkpoint.release;
}

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
  for (const release of published.releases) {
    validateRelease(release);
    assert(
      !versions.has(release.version),
      "Invalid or duplicate published macOS release",
    );
    versions.add(release.version);
  }
  const checkpoint = committedCheckpoint(root);
  const covered = new Set();
  if (checkpoint) {
    assert(
      published.releases.some((release) => sameRelease(release, checkpoint)),
      "Publication history is missing the pinned migration checkpoint",
    );
    assert(
      Array.isArray(published.qualifications),
      "Missing publication qualification proof",
    );
    const proofs = published.qualifications.filter(
      (proof) => proof?.release && sameRelease(proof.release, checkpoint),
    );
    assert(
      proofs.length === 1,
      "Missing or duplicate checkpoint qualification proof",
    );
    validateRelease(proofs[0].release);
    const qualification = proofs[0].qualification;
    assert(
      qualification?.schemaVersion === 1 &&
        qualification.source === "macos-direct-publication" &&
        Array.isArray(qualification.releases) &&
        Number.isSafeInteger(qualification.migrations) &&
        qualification.migrations >= 0,
      "Invalid checkpoint qualification",
    );
    assert.equal(
      qualification.migrations,
      migrationInventory(root, checkpoint.revision).entries.length,
      "Checkpoint migration count differs from published source",
    );
    const versionParts = (version) => version.split(".").map(BigInt);
    for (const predecessor of qualification.releases) {
      validateRelease(predecessor);
      assert(
        !covered.has(predecessor.version),
        "Duplicate checkpoint predecessor",
      );
      const a = versionParts(predecessor.version),
        b = versionParts(checkpoint.version);
      const differing = a.findIndex((part, index) => part !== b[index]);
      assert(
        differing !== -1 && a[differing] < b[differing],
        "Forward or cyclic checkpoint coverage",
      );
      assert(
        published.releases.some((release) => sameRelease(release, predecessor)),
        "Publication history is missing an unchanged checkpoint predecessor",
      );
      covered.add(predecessor.version);
    }
  }
  for (const release of published.releases) {
    if (covered.has(release.version)) continue;
    verifyMigrationHistory(root, {
      publishedRevision: release.revision,
      revision: candidate,
    });
  }
  const current = migrationInventory(root, candidate);
  return {
    schemaVersion: 1,
    source: "macos-direct-publication",
    ...(checkpoint ? { checkpoint } : {}),
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
