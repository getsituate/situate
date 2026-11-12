import assert from "node:assert/strict";
import test from "node:test";
import { verifyLegacyMigrationEvidence } from "./legacy-migration-evidence.mjs";

const signedSources = [
  ["0.0.1", "1d0878ed718712f5f10e7258da8a9f9fcdbb2c55"],
  ["0.1.0", "61955ff3900e3f4b08c94a4b6a161157bcbc6dbf"],
  ["0.1.1", "8b7faa6a0020c337dc9cf7dcf99f8cd760172398"],
  ["0.1.2", "d5fde67967d9f4393a7f3f99faa059b1ddd7919b"],
  ["0.1.3", "cb2829ac7f35f909d10b9c51a9acad23f698250d"],
  ["0.1.5", "6c310a75ecd7d38ff9b4dcf94ba042580f2b68fa"],
];

test("each audited signed source requires its own exact publication manifest", () => {
  const releases = signedSources.map(([version, revision], index) => ({
    version,
    revision,
    manifestSha256: String(index + 1).repeat(64),
    migrations: { implementations: [], entries: [], modules: [] },
  }));
  const bytes = JSON.stringify({ schemaVersion: 1, releases });
  for (const release of releases) {
    assert.equal(
      verifyLegacyMigrationEvidence(bytes, release).version,
      release.version,
    );
    for (const other of releases.filter((record) => record !== release))
      assert.throws(
        () =>
          verifyLegacyMigrationEvidence(bytes, {
            ...release,
            manifestSha256: other.manifestSha256,
          }),
        /Missing exact legacy publication evidence/u,
      );
  }
  assert.throws(() => verifyLegacyMigrationEvidence("not JSON", releases[0]));
  assert.throws(() =>
    verifyLegacyMigrationEvidence(bytes, {
      ...releases[5],
      revision: "a8ed3f0a5edf15affb0c1759f7b6a88a62f1c7c6",
    }),
  );
});
