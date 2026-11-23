import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUpdaterSignerFixture } from "../../client/scripts/updater-signing-fixture.mjs";
import { publishWindows } from "./publish-windows.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const version = "2026.11.20";
const source = "5".repeat(40);
const tag = "windows-v2026.11.20";

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
    architectures: artifacts.map(({ target, sha256 }) => ({
      target,
      sha256,
      install: "passed",
      update: "passed",
      uninstall: "passed",
    })),
  };

  let release;
  let revision = source;
  const remote = new Map();
  const calls = [];
  const github = {
    getTag(repo, requested) {
      assert.equal(repo, "getsituate/situate");
      assert.equal(requested, tag);
      return { sourceRevision: revision };
    },
    listReleases(repo) {
      assert.equal(repo, "getsituate/situate");
      return release ? [structuredClone(release)] : [];
    },
    createDraft(repo, draft) {
      assert.equal(repo, "getsituate/situate");
      assert.equal(draft.prerelease, false);
      assert.equal(draft.make_latest, "false");
      assert.match(draft.body, /Windows may warn or block installation/);
      assert(
        draft.body.includes(
          readFileSync(join(folder, "SHA256SUMS.txt"), "utf8"),
        ),
      );
      assert.equal(draft.draft, true);
      calls.push("create");
      release = { ...draft, id: 12, assets: [] };
      return structuredClone(release);
    },
    uploadAsset(repo, id, name, bytes) {
      assert.equal(repo, "getsituate/situate");
      assert.equal(id, 12);
      assert.equal(release.draft, true);
      assert(Buffer.from(bytes).equals(readFileSync(join(folder, name))));
      calls.push(name);
      const asset = {
        name,
        id: remote.size + 1,
        state: "uploaded",
        size: bytes.length,
      };
      release.assets.push(asset);
      remote.set(asset.id, Buffer.from(bytes));
    },
    getRelease(repo, id) {
      assert.equal(repo, "getsituate/situate");
      assert.equal(id, 12);
      return structuredClone(release);
    },
    downloadAsset(repo, releaseId, id) {
      assert.equal(repo, "getsituate/situate");
      assert.equal(releaseId, 12);
      return remote.get(id);
    },
    finalize(repo, id) {
      assert.equal(repo, "getsituate/situate");
      assert.equal(id, 12);
      calls.push("finalize");
      release.draft = false;
    },
  };
  return {
    folder,
    qualification,
    signer,
    github,
    calls,
    remote,
    setRevision: (value) => {
      revision = value;
    },
  };
}

test("publishes exactly the qualified installers and signatures as a stable Windows release", async (t) => {
  const f = setup(t);
  const publish = () =>
    publishWindows(f.folder, f.qualification, f.signer.publicKey, f.github);
  assert.deepEqual(await publish(), { id: 12, version, source });
  assert.deepEqual(f.calls, [
    "create",
    "Situate-2026.11.20-windows-x64-setup.exe",
    "Situate-2026.11.20-windows-x64-setup.exe.sig",
    "Situate-2026.11.20-windows-arm64-setup.exe",
    "Situate-2026.11.20-windows-arm64-setup.exe.sig",
    "SHA256SUMS.txt",
    "finalize",
  ]);
  const previous = [...f.calls];
  await publish();
  assert.deepEqual(f.calls, previous);
  f.remote.set(2, Buffer.alloc(f.remote.get(2).length));
  await assert.rejects(publish(), /Published bytes differ/);
  assert.deepEqual(f.calls, previous);
});

test("does not write to GitHub without both exact qualification records and the reviewed tag", async (t) => {
  const f = setup(t);
  await assert.rejects(
    publishWindows(
      f.folder,
      {
        ...f.qualification,
        architectures: f.qualification.architectures.slice(0, 1),
      },
      f.signer.publicKey,
      f.github,
    ),
  );
  f.setRevision("0".repeat(40));
  await assert.rejects(
    publishWindows(f.folder, f.qualification, f.signer.publicKey, f.github),
    /tag must point/,
  );
  assert.deepEqual(f.calls, []);
});
