import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  readWindowsInstaller,
  stableWindowsVersion,
  windowsReleaseTag,
} from "../../client/scripts/windows-release.mjs";
import { githubAdapter, RELEASE_REPOSITORY } from "./github.mjs";

const targets = new Map([
  ["x86_64-pc-windows-msvc", "windows-x86_64"],
  ["aarch64-pc-windows-msvc", "windows-aarch64"],
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function publishWindows(
  candidate,
  qualification,
  publicKey,
  github,
) {
  const manifestBytes = readFileSync(join(candidate, "manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const version = stableWindowsVersion(manifest.version);
  const tag = windowsReleaseTag(version);
  assert.match(manifest.source, /^[0-9a-f]{40}$/u);
  assert.equal(qualification.kind, "windows-exact-artifact-qualification");
  assert.equal(qualification.manifestSha256, hash(manifestBytes));
  const packages = [];
  const platforms = {};
  const local = new Map();
  const checks = [];
  for (const [target, updateKey] of targets) {
    const { file, size, sha256, signature } = readWindowsInstaller(
      candidate,
      version,
      target,
      publicKey,
    );
    packages.push({ target, file, size, sha256 });
    checks.push({
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
    });
    const sidecar = readFileSync(join(candidate, `${file}.sig`));
    assert.equal(sidecar.toString("utf8").trim(), signature);
    const bytes = readFileSync(join(candidate, file));
    assert.equal(bytes.length, size);
    assert.equal(hash(bytes), sha256);
    local.set(file, bytes);
    local.set(`${file}.sig`, sidecar);
    platforms[updateKey] = {
      url: `https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/${file}`,
      signature,
    };
  }
  assert.deepEqual(qualification.architectures, checks);
  const bootstrap = qualification.webview2Bootstrap;
  const deferred = bootstrap?.result === "deferred";
  if (deferred) {
    assert.deepEqual(bootstrap, {
      result: "deferred",
      debt: "debt-windows-webview2-first-install",
    });
  } else {
    assert(
      bootstrap?.result === "passed" &&
        packages.some(
          ({ target, sha256 }) =>
            target === bootstrap.target && sha256 === bootstrap.sha256,
        ),
      "WebView2 bootstrap qualification must identify an exact Windows installer.",
    );
  }
  assert.deepEqual(manifest.artifacts, packages);
  assert.deepEqual(
    JSON.parse(readFileSync(join(candidate, "update.json"), "utf8")),
    { version, distribution: "direct", platforms },
  );
  const sums = `${packages.map(({ file, sha256 }) => `${sha256}  ${file}`).join("\n")}\n`;
  assert.equal(readFileSync(join(candidate, "SHA256SUMS.txt"), "utf8"), sums);
  local.set("SHA256SUMS.txt", Buffer.from(sums));
  const releases = await github.listReleases(RELEASE_REPOSITORY);
  if (deferred) {
    assert(
      releases.every(
        ({ tag_name }) => tag_name === tag || !tag_name.startsWith("windows-v"),
      ),
      "Only the first Windows release may defer the WebView2 bootstrap check.",
    );
  }
  const existing = releases.filter((record) => record.tag_name === tag);
  assert(existing.length <= 1, "Duplicate Windows release tag.");
  assertTag(await github.getTag(RELEASE_REPOSITORY, tag), manifest.source);
  let release = existing[0];
  if (!release) {
    const body = [
      "Requires Windows 10 version 22H2 or Windows 11. Choose the installer for your architecture: x64 or ARM64.",
      "These installers do not have an Authenticode (Windows publisher) signature. Windows may warn or block installation.",
      `SHA-256 checksums:\n\n\`\`\`text\n${sums}\`\`\``,
    ].join("\n\n");
    release = await github.createDraft(RELEASE_REPOSITORY, {
      tag_name: tag,
      name: `Situate ${version} for Windows`,
      body,
      draft: true,
      prerelease: false,
      make_latest: "false",
    });
  }
  async function verify(inventory, allowMissing) {
    assert.equal(inventory.tag_name, tag);
    assert.equal(inventory.prerelease, false);
    assert(Array.isArray(inventory.assets));
    assert.equal(
      new Set(inventory.assets.map(({ name }) => name)).size,
      inventory.assets.length,
    );
    for (const asset of inventory.assets) {
      const expected = local.get(asset.name);
      assert(expected, `Unexpected Windows release asset: ${asset.name}`);
      assert.equal(asset.state, "uploaded");
      assert.equal(asset.size, expected.length);
      const actual = await github.downloadAsset(
        RELEASE_REPOSITORY,
        inventory.id,
        asset.id,
      );
      assert(
        Buffer.from(actual).equals(expected),
        `Published bytes differ: ${asset.name}`,
      );
    }
    if (!allowMissing) assert.equal(inventory.assets.length, local.size);
  }
  await verify(release, release.draft === true);
  if (release.draft === true) {
    for (const [file, bytes] of local) {
      if (!release.assets.some(({ name }) => name === file)) {
        await github.uploadAsset(RELEASE_REPOSITORY, release.id, file, bytes);
      }
    }
    const complete = await github.getRelease(RELEASE_REPOSITORY, release.id);
    assert.equal(complete.draft, true);
    await verify(complete, false);
    assertTag(await github.getTag(RELEASE_REPOSITORY, tag), manifest.source);
    await github.finalize(RELEASE_REPOSITORY, release.id);
  }
  const published = await github.getRelease(RELEASE_REPOSITORY, release.id);
  assert.equal(published.draft, false);
  await verify(published, false);
  return { id: published.id, version, source: manifest.source };
}

function assertTag(tag, source) {
  assert.equal(
    tag.sourceRevision,
    source,
    "The annotated Windows release tag must point to the qualified source.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [candidate, qualification, ...extra] = process.argv.slice(2);
  assert(
    candidate && qualification && !extra.length,
    "Usage: node infrastructure/releases/publish-windows.mjs CANDIDATE QUALIFICATION_JSON",
  );
  const receipt = JSON.parse(readFileSync(qualification, "utf8"));
  console.log(
    JSON.stringify(
      await publishWindows(
        candidate,
        receipt,
        process.env.SITUATE_UPDATER_PUBLIC_KEY,
        githubAdapter(),
      ),
    ),
  );
}
