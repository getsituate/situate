import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readWindowsInstaller,
  stableWindowsVersion,
  windowsReleaseTag,
} from "../../client/scripts/windows-release.mjs";
import { RELEASE_REPOSITORY } from "./github.mjs";

const targets = new Map([
  ["x86_64-pc-windows-msvc", "windows-x86_64"],
  ["aarch64-pc-windows-msvc", "windows-aarch64"],
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function qualifiedWindowsAssets(
  candidate,
  qualification,
  publicKey,
  identity,
) {
  const manifestBytes = readFileSync(join(candidate, "manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const version = stableWindowsVersion(manifest.version);
  const tag = windowsReleaseTag(version);
  assert.equal(manifest.source, identity.sourceRevision);
  assert.equal(version, identity.version);
  assert.equal(tag, identity.tag);
  assert.equal(qualification.kind, "windows-arm64-exact-installer");
  assert.equal(qualification.source, manifest.source);
  assert.equal(qualification.version, version);
  assert.match(qualification.osBuild, /^[0-9]{5}$/u);
  assert(
    Number(qualification.osBuild) >= 22000,
    "Expected a Windows 11 qualification build",
  );
  for (const check of ["install", "launch", "installerUpgrade", "uninstall"])
    assert.equal(
      qualification[check],
      "passed",
      `Missing ARM64 installer check: ${check}`,
    );
  const packages = [];
  const platforms = {};
  const local = new Map();
  for (const [target, updateKey] of targets) {
    const { file, size, sha256, signature } = readWindowsInstaller(
      candidate,
      version,
      target,
      publicKey,
    );
    packages.push({ target, file, size, sha256 });
    if (target === "aarch64-pc-windows-msvc")
      assert.equal(
        qualification.sha256,
        sha256,
        "ARM64 qualification belongs to a different installer",
      );
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
  assert.deepEqual(manifest.artifacts, packages);
  assert.deepEqual(
    JSON.parse(readFileSync(join(candidate, "update.json"), "utf8")),
    { version, distribution: "direct", platforms },
  );
  const sums = `${packages.map(({ file, sha256 }) => `${sha256}  ${file}`).join("\n")}\n`;
  assert.equal(readFileSync(join(candidate, "SHA256SUMS.txt"), "utf8"), sums);
  local.set("SHA256SUMS.txt", Buffer.from(sums));
  local.set("windows-release.json", manifestBytes);
  return {
    files: Object.fromEntries(local),
    notes: [
      "## Windows",
      "Requires Windows 10 version 22H2 or Windows 11. Choose the installer for your architecture: x64 or ARM64.",
      "These installers do not have an Authenticode (Windows publisher) signature. Windows may warn or block installation.",
      `SHA-256 checksums:\n\n\`\`\`text\n${sums}\`\`\``,
    ].join("\n\n"),
  };
}
