import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, catalogDigest, digest } from "./release-catalog.mjs";
import { createUpdaterSignerFixture } from "../client/scripts/updater-signing-fixture.mjs";

export function qualificationFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "situate-final-package-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const version = "2026.11.1";
  const source = "a".repeat(40);
  const catalog = {
    schemaVersion: 1,
    installedVersion: version,
    releases: [
      {
        version,
        locales: {
          en: { title: "Changes", entries: [] },
          de: { title: "Changes", entries: [] },
        },
      },
    ],
  };
  const catalogBytes = `${canonical(catalog)}\n`;
  const generated = {
    schemaVersion: 1,
    kind: "situate-release-inputs",
    source,
    baseline: "b".repeat(40),
    version,
    build: "2026.11.1",
    tag: `v${version}`,
    fragments: [],
    fragmentDigest: digest(canonical([])),
    history: {
      file: "situate-release-history.json",
      sha256: digest(catalogBytes),
      contentSha256: catalogDigest(catalog),
    },
    previous: null,
  };
  const inputsBytes = `${canonical(generated)}\n`;
  const releaseInputs = {
    path: "release-inputs.json",
    sha256: digest(inputsBytes),
    catalogPath: "situate-release-history.json",
    catalogSha256: digest(catalogBytes),
  };
  const migrationQualification = {
    schemaVersion: 1,
    source: "macos-direct-publication",
    releases: [
      {
        version: "0.1.5",
        revision: "b".repeat(40),
        manifestSha256: "d".repeat(64),
      },
    ],
    migrations: 2,
  };
  const publicCompatibility = {
    schemaVersion: 1,
    source,
    qualification: {
      ...migrationQualification,
      releases: [
        ...migrationQualification.releases,
        {
          version: "2026.10.1",
          revision: "e".repeat(40),
          manifestSha256: "f".repeat(64),
        },
      ],
    },
  };
  const sourceVerification = {
    schemaVersion: 1,
    status: "passed",
    source,
    planDigest: "9".repeat(64),
    lanes: ["client-core"],
    results: [{ id: "client-core", status: "passed", exitCode: 0 }],
    releaseInputsSha256: releaseInputs.sha256,
  };
  const archive = Buffer.from("synthetic updater archive");
  const signer = createUpdaterSignerFixture();
  const signature = signer.sign(archive, version);
  const artifact = {
    platform: "macos",
    distribution: "direct",
    architecture: "universal",
    architectures: ["arm64", "x86_64"],
    notarized: true,
    version,
    buildNumber: generated.build,
    identifier: "com.example.situate",
    teamId: "TEAM123456",
    minimumSystemVersion: "14.0",
    path: "Situate-direct.dmg",
    sha256: digest("synthetic DMG"),
    size: 13,
    bundleSha256: "c".repeat(64),
    buildConfiguration: {
      distribution: "direct",
      sourceRevision: source,
      sourceDirty: false,
      releaseInputs,
      migrationQualification,
      publicCompatibility,
      sourceVerification,
      endpoint: "https://example.com/releases/current/update.json",
      publicKey: signer.publicKey,
    },
    updater: {
      path: "Situate-direct.app.tar.gz",
      sha256: digest(archive),
      size: archive.length,
      signature,
      signaturePath: "Situate-direct.app.tar.gz.sig",
      signatureSha256: digest(signature),
      signatureSize: Buffer.byteLength(signature),
    },
  };
  const manifest = {
    schemaVersion: 1,
    status: "complete",
    distribution: "direct",
    revision: source,
    dirty: false,
    version,
    buildNumber: generated.build,
    releaseInputs,
    migrationQualification,
    publicCompatibility,
    sourceVerification,
    qualification: { path: "release-qualification.json" },
    artifacts: [artifact],
  };
  for (const [name, bytes] of [
    [releaseInputs.path, inputsBytes],
    [releaseInputs.catalogPath, catalogBytes],
    [artifact.path, "synthetic DMG"],
    [artifact.updater.path, archive],
    [artifact.updater.signaturePath, signature],
    ["manifest.json", `${JSON.stringify(manifest)}\n`],
  ])
    writeFileSync(join(directory, name), bytes);
  const receipt = {
    schemaVersion: 1,
    kind: "macos-direct-exact-artifact",
    sourceRevision: source,
    version,
    releaseInputsSha256: releaseInputs.sha256,
    manifestSha256: digest(`${JSON.stringify(manifest)}\n`),
    artifact: {
      path: artifact.path,
      sha256: artifact.sha256,
      bundleSha256: artifact.bundleSha256,
      updater: {
        path: artifact.updater.path,
        sha256: artifact.updater.sha256,
        signatureSha256: artifact.updater.signatureSha256,
      },
    },
    checks: {
      payloadEquality: true,
      installation: true,
      update: true,
      syntheticJourneys: true,
      normalTls: true,
      productionEndpoint: true,
    },
    host: {
      os: "darwin",
      architecture: "arm64",
      runnerImage: "synthetic-test-image",
    },
    predecessor: { version: "0.1.5", manifestSha256: "d".repeat(64) },
    limitations: [
      "Native Intel and minimum-OS qualification are not established.",
    ],
  };
  return {
    directory,
    manifest,
    artifact,
    receipt,
    releaseInputs: { manifest: generated, catalog, catalogBytes },
  };
}
