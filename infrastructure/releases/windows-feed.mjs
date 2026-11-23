import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  readWindowsInstaller,
  stableWindowsVersion,
} from "../../client/scripts/windows-release.mjs";
import { githubAdapter, RELEASE_REPOSITORY } from "./github.mjs";

const targets = new Map([
  ["x86_64-pc-windows-msvc", "windows-x86_64"],
  ["aarch64-pc-windows-msvc", "windows-aarch64"],
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function verifiedWindowsFeed(candidate, publicKey, id, github) {
  const manifest = JSON.parse(
    readFileSync(join(candidate, "manifest.json"), "utf8"),
  );
  const version = stableWindowsVersion(manifest.version);
  assert.match(manifest.source, /^[0-9a-f]{40}$/u);
  const tag = `v${version}`;
  const release = await github.getRelease(RELEASE_REPOSITORY, id);
  assert.equal(release.id, id);
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  assert.equal(
    (await github.getTag(RELEASE_REPOSITORY, tag)).sourceRevision,
    manifest.source,
  );

  const platforms = {};
  const artifacts = [];
  for (const [target, key] of targets) {
    const { file, sha256, size, signature } = readWindowsInstaller(
      candidate,
      version,
      target,
      publicKey,
    );
    artifacts.push({ target, file, size, sha256 });
    const url = `https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/${file}`;
    const sidecar = readFileSync(join(candidate, `${file}.sig`));
    assert.equal(sidecar.toString("utf8").trim(), signature);
    for (const [name, expected, length] of [
      [file, sha256, size],
      [`${file}.sig`, hash(sidecar), sidecar.length],
    ]) {
      const matching = release.assets.filter((asset) => asset.name === name);
      assert.equal(matching.length, 1, `Expected one published asset: ${name}`);
      const [asset] = matching;
      assert.equal(asset.state, "uploaded");
      assert.equal(asset.size, length);
      const bytes = await github.downloadAsset(
        RELEASE_REPOSITORY,
        id,
        asset.id,
      );
      assert.equal(bytes.length, length);
      assert.equal(hash(bytes), expected, `Published bytes differ: ${name}`);
    }
    platforms[key] = { url, signature };
  }
  assert.deepEqual(manifest.artifacts, artifacts);
  const feed = { version, distribution: "direct", platforms };
  assert.deepEqual(
    JSON.parse(readFileSync(join(candidate, "update.json"), "utf8")),
    feed,
  );
  return feed;
}

export function activateWindowsFeed(distribution, feed) {
  assert(
    lstatSync(distribution).isDirectory(),
    "Expected the distribution directory.",
  );
  const directory = join(distribution, "windows-release");
  try {
    mkdirSync(directory, { mode: 0o755 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  assert(
    lstatSync(directory).isDirectory(),
    "Expected a Windows release directory.",
  );
  const lock = join(directory, ".activate");
  mkdirSync(lock);
  try {
    const path = join(directory, "update.json");
    const proposed = stableWindowsVersion(feed.version);
    let current;
    try {
      assert(
        lstatSync(path).isFile(),
        "Expected a regular Windows update feed.",
      );
      current = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current) {
      const installed = stableWindowsVersion(current.version);
      if (installed === proposed) {
        assert.deepEqual(
          feed,
          current,
          "Cannot replace a published Windows version.",
        );
        return false;
      }
      const old = installed.split(".").map(Number);
      const newer = proposed.split(".").map(Number);
      const different = newer.findIndex((part, index) => part !== old[index]);
      assert(
        newer[different] > old[different],
        "Cannot activate an older Windows version.",
      );
    }
    const stage = join(lock, "update.json");
    const fd = openSync(stage, "wx", 0o644);
    try {
      writeFileSync(fd, `${JSON.stringify(feed, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(stage, path);
    const parent = openSync(directory, "r");
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
    return true;
  } finally {
    rmSync(lock, { recursive: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [candidate, id, distribution, ...extra] = process.argv.slice(2);
  const releaseId = Number(id);
  assert(
    candidate &&
      distribution &&
      Number.isSafeInteger(releaseId) &&
      releaseId > 0 &&
      !extra.length,
    "Usage: node infrastructure/releases/windows-feed.mjs CANDIDATE GITHUB_RELEASE_ID DISTRIBUTION_DIRECTORY",
  );
  const feed = await verifiedWindowsFeed(
    candidate,
    process.env.SITUATE_UPDATER_PUBLIC_KEY,
    releaseId,
    githubAdapter(),
  );
  console.log(
    JSON.stringify({
      version: feed.version,
      activated: activateWindowsFeed(distribution, feed),
    }),
  );
}
