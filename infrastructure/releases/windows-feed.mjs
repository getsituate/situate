import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readWindowsInstaller,
  windowsArchitectures,
  windowsReleaseTag,
  windowsStableEndpoint,
} from "../../client/scripts/windows-release.mjs";

export function windowsFeedForRelease(directory, identity, publicKey) {
  const release = JSON.parse(
    readFileSync(join(directory, "windows-release.json"), "utf8"),
  );
  const { version, sourceRevision, tag, repository } = identity;
  assert.equal(repository, "getsituate/situate");
  assert.equal(tag, windowsReleaseTag(version));
  assert.equal(release.source, sourceRevision);
  assert.equal(release.version, version);
  const platforms = {};
  const artifacts = [];
  for (const [target, { updater }] of Object.entries(windowsArchitectures)) {
    const { file, sha256, size, signature } = readWindowsInstaller(
      directory,
      version,
      target,
      publicKey,
    );
    artifacts.push({ target, file, size, sha256 });
    platforms[updater] = {
      url: `https://github.com/${repository}/releases/download/${tag}/${file}`,
      signature,
    };
  }
  assert.deepEqual(
    release.artifacts,
    artifacts,
    "Windows installers differ from the sealed release manifest",
  );
  return { version, distribution: "direct", platforms };
}

export async function verifyPublicWindowsFeed(
  expected,
  { fetchImpl = fetch } = {},
) {
  const response = await fetchImpl(windowsStableEndpoint, {
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, "The public Windows update feed is unavailable.");
  assert(
    response.headers
      .get("cache-control")
      ?.split(",")
      .some((item) => item.trim().toLowerCase() === "no-store"),
    "The public Windows update feed must not be cached.",
  );
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    assert(
      bytes <= 1024 * 1024,
      "The public Windows update feed exceeds 1 MiB.",
    );
    chunks.push(chunk);
  }
  assert.deepEqual(
    JSON.parse(Buffer.concat(chunks)),
    expected,
    "The public Windows update feed differs from the activated release.",
  );
}
