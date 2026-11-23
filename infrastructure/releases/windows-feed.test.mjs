import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUpdaterSignerFixture } from "../../client/scripts/updater-signing-fixture.mjs";
import { activateWindowsFeed, verifiedWindowsFeed } from "./windows-feed.mjs";

const version = "2026.11.20";
const source = "7".repeat(40);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "windows-feed-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidate = join(root, "candidate");
  mkdirSync(candidate);
  const dist = join(root, "distribution");
  mkdirSync(dist);
  mkdirSync(join(dist, "current-release"));
  writeFileSync(
    join(dist, "current-release", "update.json"),
    "macOS feed fixture",
  );
  const signer = createUpdaterSignerFixture();
  const release = {
    id: 42,
    draft: false,
    prerelease: false,
    tag_name: `windows-v${version}`,
    assets: [],
  };
  const feed = { version, distribution: "direct", platforms: {} };
  const artifactData = new Map();
  const artifacts = [];
  for (const [arch, rust, update] of [
    ["x64", "x86_64", "windows-x86_64"],
    ["arm64", "aarch64", "windows-aarch64"],
  ]) {
    const file = `Situate-${version}-windows-${arch}-setup.exe`;
    const bytes = Buffer.from(`MZ${arch}`.padEnd(80, "-"));
    const sig = signer.sign(bytes, version, file);
    for (const [name, data] of [
      [file, bytes],
      [`${file}.sig`, Buffer.from(sig)],
    ]) {
      const id = artifactData.size + 1;
      writeFileSync(join(candidate, name), data);
      artifactData.set(id, data);
      release.assets.push({ id, name, size: data.length, state: "uploaded" });
    }
    feed.platforms[update] = {
      url: `https://github.com/getsituate/situate/releases/download/windows-v${version}/${file}`,
      signature: sig,
    };
    artifacts.push({
      target: `${rust}-pc-windows-msvc`,
      file,
      sha256: sha(bytes),
      size: bytes.length,
    });
  }
  writeFileSync(
    join(candidate, "manifest.json"),
    JSON.stringify({ version, source, artifacts }),
  );
  writeFileSync(join(candidate, "update.json"), JSON.stringify(feed));
  const github = {
    getRelease(repo, id) {
      assert.equal(repo, "getsituate/situate");
      assert.equal(id, 42);
      return release;
    },
    getTag(repo, tag) {
      assert.equal(repo, "getsituate/situate");
      assert.equal(tag, `windows-v${version}`);
      return { sourceRevision: source };
    },
    downloadAsset(repo, id, asset) {
      assert.equal(repo, "getsituate/situate");
      assert.equal(id, 42);
      return artifactData.get(asset);
    },
  };
  return { candidate, dist, signer, release, github, feed, artifactData };
}

test("activation verifies published bytes and leaves the macOS feed untouched", async (t) => {
  const f = fixture(t);
  const feed = await verifiedWindowsFeed(
    f.candidate,
    f.signer.publicKey,
    42,
    f.github,
  );
  assert.deepEqual(feed, f.feed);
  assert.equal(activateWindowsFeed(f.dist, feed), true);
  assert.equal(activateWindowsFeed(f.dist, feed), false);
  assert.deepEqual(
    JSON.parse(
      readFileSync(join(f.dist, "windows-release", "update.json"), "utf8"),
    ),
    f.feed,
  );
  assert.equal(
    readFileSync(join(f.dist, "current-release", "update.json"), "utf8"),
    "macOS feed fixture",
  );
  assert.throws(
    () => activateWindowsFeed(f.dist, { ...feed, version: "2026.11.19" }),
    /older Windows version/,
  );
  assert.throws(
    () => activateWindowsFeed(f.dist, { ...feed, platforms: {} }),
    /replace a published Windows version/,
  );
});

test("a draft or different GitHub asset cannot activate the Windows feed", async (t) => {
  const f = fixture(t);
  f.release.draft = true;
  await assert.rejects(
    verifiedWindowsFeed(f.candidate, f.signer.publicKey, 42, f.github),
  );
  f.release.draft = false;
  f.artifactData.set(3, Buffer.alloc(f.artifactData.get(3).length));
  await assert.rejects(
    verifiedWindowsFeed(f.candidate, f.signer.publicKey, 42, f.github),
    /Published bytes differ/,
  );
});
