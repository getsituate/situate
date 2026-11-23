import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUpdaterSignerFixture } from "../../client/scripts/updater-signing-fixture.mjs";
import {
  verifyPublicWindowsFeed,
  windowsFeedForRelease,
} from "./windows-feed.mjs";

const version = "2026.11.20";
const source = "7".repeat(40);
const identity = {
  version,
  sourceRevision: source,
  tag: `v${version}`,
  repository: "getsituate/situate",
};

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "windows-feed-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const signer = createUpdaterSignerFixture();
  const feed = { version, distribution: "direct", platforms: {} };
  const artifacts = [];
  for (const [arch, rust, update] of [
    ["x64", "x86_64", "windows-x86_64"],
    ["arm64", "aarch64", "windows-aarch64"],
  ]) {
    const file = `Situate-${version}-windows-${arch}-setup.exe`;
    const bytes = Buffer.from(`MZ${arch}`.padEnd(80, "-"));
    const signature = signer.sign(bytes, version, file);
    writeFileSync(join(directory, file), bytes);
    writeFileSync(join(directory, `${file}.sig`), signature);
    feed.platforms[update] = {
      url: `https://github.com/getsituate/situate/releases/download/v${version}/${file}`,
      signature,
    };
    artifacts.push({
      target: `${rust}-pc-windows-msvc`,
      file,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  writeFileSync(
    join(directory, "windows-release.json"),
    JSON.stringify({ source, version, artifacts }),
  );
  return { directory, feed, signer, artifacts };
}

test("the feed routes both architectures to the exact signed files in the common release", (t) => {
  const { directory, feed, signer, artifacts } = fixture(t);
  const create = (release = identity) =>
    windowsFeedForRelease(directory, release, signer.publicKey);
  assert.deepEqual(create(), feed);
  assert.throws(() => create({ ...identity, tag: "v2026.11.19" }));
  assert.throws(() => create({ ...identity, sourceRevision: "8".repeat(40) }));
  writeFileSync(
    join(directory, `${artifacts[0].file}.sig`),
    signer.sign(Buffer.alloc(80), version, artifacts[0].file),
  );
  assert.throws(() => create());
});

test("the public feed must match both architecture entries and prohibit caching", async (t) => {
  const { feed } = fixture(t);
  const check = (body, headers, status = 200) =>
    verifyPublicWindowsFeed(feed, {
      fetchImpl: async (url, options) => {
        assert.equal(
          url,
          "https://getsituate.com/releases/windows/current/update.json",
        );
        assert.equal(options.redirect, "error");
        return Response.json(body, { headers, status });
      },
    });
  const headers = { "Cache-Control": "no-store, max-age=0" };
  await check(feed, headers);
  await assert.rejects(check(feed, headers, 404), /unavailable/);
  await assert.rejects(check(feed, {}), /must not be cached/);
  await assert.rejects(
    check(
      {
        ...feed,
        platforms: {
          "windows-x86_64": feed.platforms["windows-x86_64"],
          "windows-aarch64": feed.platforms["windows-x86_64"],
        },
      },
      headers,
    ),
    /differs from the activated release/,
  );
});
