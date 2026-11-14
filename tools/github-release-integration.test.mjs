import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createEvidenceFromDirectory,
  PUBLIC_METADATA_ASSETS,
} from "./github-release.mjs";
import { qualificationFixture } from "./release-qualification-fixture.mjs";
import { verifyQualificationReceipt } from "./release-qualification.mjs";

test("GitHub evidence consumes the canonical sealed qualification package without aliases", (t) => {
  const f = qualificationFixture(t);
  verifyQualificationReceipt(f.directory, f.manifest, f.receipt);
  writeFileSync(
    join(f.directory, "release-qualification.json"),
    `${JSON.stringify(f.receipt)}\n`,
  );
  const identity = {
    repository: "getsituate/situate",
    tag: `v${f.manifest.version}`,
    sourceRevision: f.manifest.revision,
    version: f.manifest.version,
    operationId: "synthetic-canonical-package",
    inputSha256: f.manifest.releaseInputs.sha256,
  };
  const result = createEvidenceFromDirectory({
    identity,
    directory: f.directory,
    notes: "",
  });
  assert.deepEqual(PUBLIC_METADATA_ASSETS, [
    "manifest.json",
    "release-inputs.json",
    "situate-release-history.json",
    "release-qualification.json",
  ]);
  assert.equal(result.evidence.assets.length, 7);
  assert.equal(
    result.evidence.assets.find((asset) => asset.name === "release-inputs.json")
      .sha256,
    f.manifest.releaseInputs.sha256,
  );
  assert.equal(
    result.evidence.assets.find(
      (asset) => asset.name === "situate-release-history.json",
    ).sha256,
    f.manifest.releaseInputs.catalogSha256,
  );
  assert.deepEqual(
    JSON.parse(result.files["release-qualification.json"]),
    f.receipt,
  );
});
