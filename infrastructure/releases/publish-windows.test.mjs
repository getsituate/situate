import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUpdaterSignerFixture } from "../../client/scripts/updater-signing-fixture.mjs";
import { qualifiedWindowsAssets } from "./publish-windows.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const version = "2026.11.20";
const source = "5".repeat(40);
const tag = "v2026.11.20";

function setup(t) {
  const folder = mkdtempSync(join(tmpdir(), "situate-publish-windows-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const signer = createUpdaterSignerFixture();
  const artifacts = [];
  const feed = { version, distribution: "direct", platforms: {} };
  for (const [arch, rust] of [
    ["x64", "x86_64"],
    ["arm64", "aarch64"],
  ]) {
    const file = `Situate-${version}-windows-${arch}-setup.exe`;
    const bytes = Buffer.from(`MZ${arch}`.padEnd(80, "-"));
    const signature = signer.sign(bytes, version, file);
    writeFileSync(join(folder, file), bytes);
    writeFileSync(join(folder, `${file}.sig`), signature);
    artifacts.push({
      target: `${rust}-pc-windows-msvc`,
      file,
      size: bytes.length,
      sha256: hash(bytes),
    });
    feed.platforms[`windows-${rust}`] = {
      url: `https://github.com/getsituate/situate/releases/download/${tag}/${file}`,
      signature,
    };
  }
  const manifest = JSON.stringify({ version, source, artifacts });
  writeFileSync(join(folder, "manifest.json"), manifest);
  writeFileSync(join(folder, "update.json"), JSON.stringify(feed));
  writeFileSync(
    join(folder, "SHA256SUMS.txt"),
    `${artifacts.map(({ file, sha256 }) => `${sha256}  ${file}`).join("\n")}\n`,
  );
  const qualification = {
    kind: "windows-exact-artifact-qualification",
    manifestSha256: hash(manifest),
    webview2Bootstrap: {
      target: artifacts[0].target,
      sha256: artifacts[0].sha256,
      result: "passed",
    },
    architectures: artifacts.map(({ target, sha256 }) => ({
      target,
      sha256,
      systems: {
        "windows-10-22h2": {
          install: "passed",
          update: "passed",
          uninstall: "passed",
        },
        "windows-11": {
          install: "passed",
          update: "passed",
          uninstall: "passed",
        },
      },
    })),
  };

  return { folder, qualification, signer, artifacts };
}

const identity = { version, tag, sourceRevision: source };

test("validates and stages both signed Windows installers for the common release", (t) => {
  const { folder, qualification, signer, artifacts } = setup(t);
  const result = qualifiedWindowsAssets(
    folder,
    qualification,
    signer.publicKey,
    identity,
  );
  assert.deepEqual(Object.keys(result.files), [
    ...artifacts.flatMap(({ file }) => [file, `${file}.sig`]),
    "SHA256SUMS.txt",
    "windows-release.json",
  ]);
  assert.match(result.notes, /Windows may warn or block installation/);
  assert.equal(result.deferred, false);
  const deferred = qualifiedWindowsAssets(
    folder,
    {
      ...qualification,
      webview2Bootstrap: {
        result: "deferred",
        debt: "debt-windows-webview2-first-install",
      },
    },
    signer.publicKey,
    identity,
  );
  assert.equal(deferred.deferred, true);
  assert.doesNotMatch(deferred.notes, /WebView2/u);
});

test("rejects a wrong source, incomplete qualification, or altered installer", (t) => {
  const { folder, qualification, signer, artifacts } = setup(t);
  const stage = (receipt, release = identity) =>
    qualifiedWindowsAssets(folder, receipt, signer.publicKey, release);
  assert.throws(() =>
    stage(qualification, { ...identity, sourceRevision: "4".repeat(40) }),
  );
  const incomplete = structuredClone(qualification);
  delete incomplete.architectures[1].systems["windows-10-22h2"];
  assert.throws(() => stage(incomplete));
  assert.throws(
    () => stage({ ...qualification, webview2Bootstrap: undefined }),
    /WebView2 bootstrap qualification/,
  );
  writeFileSync(join(folder, artifacts[0].file), "altered");
  assert.throws(() => stage(qualification));
});
