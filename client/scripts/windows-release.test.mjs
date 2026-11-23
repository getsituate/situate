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
import {
  assembleWindowsRelease,
  stableWindowsVersion,
  verifyApplicationMachine,
} from "./windows-release.mjs";
import { createUpdaterSignerFixture } from "./updater-signing-fixture.mjs";

const source = "d".repeat(40);
const version = "2026.11.20";
const x64 = "x86_64-pc-windows-msvc";
const arm64 = "aarch64-pc-windows-msvc";
const filenames = {
  [x64]: "Situate-2026.11.20-windows-x64-setup.exe",
  [arm64]: "Situate-2026.11.20-windows-arm64-setup.exe",
};

function executable(machine) {
  const bytes = Buffer.alloc(96);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 0x3c);
  bytes.write("PE\0\0", 64);
  bytes.writeUInt16LE(machine, 68);
  return bytes;
}

function packages(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-windows-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const signer = createUpdaterSignerFixture();
  const directories = {
    [x64]: join(root, "x64"),
    [arm64]: join(root, "arm64"),
  };
  const payloads = { [x64]: executable(0x8664), [arm64]: executable(0xaa64) };
  for (const [target, directory] of Object.entries(directories)) {
    mkdirSync(directory);
    const file = filenames[target];
    const bytes = payloads[target];
    writeFileSync(join(directory, file), bytes);
    writeFileSync(
      join(directory, `${file}.sig`),
      signer.sign(bytes, version, file),
    );
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({
        kind: "situate-windows-release",
        source,
        version,
        target,
        file,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        authenticode: false,
      }),
    );
  }
  return { root, signer, directories, payloads };
}

test("Windows publication metadata routes both exact installers through the stable feed", (t) => {
  const { root, signer, directories, payloads } = packages(t);
  const output = join(root, "release");
  assembleWindowsRelease(
    output,
    directories,
    version,
    source,
    signer.publicKey,
  );
  const feed = JSON.parse(readFileSync(join(output, "update.json"), "utf8"));
  assert.equal(feed.version, version);
  assert.equal(feed.distribution, "direct");
  assert.deepEqual(
    feed.platforms,
    Object.fromEntries(
      [
        [x64, "windows-x86_64"],
        [arm64, "windows-aarch64"],
      ].map(([target, key]) => [
        key,
        {
          url: `https://github.com/getsituate/situate/releases/download/v2026.11.20/${filenames[target]}`,
          signature: signer.sign(payloads[target], version, filenames[target]),
        },
      ]),
    ),
  );
  for (const [target, file] of Object.entries(filenames)) {
    assert.deepEqual(readFileSync(join(output, file)), payloads[target]);
  }
});

test("a missing architecture or mismatched checkout cannot assemble a release", (t) => {
  const { root, signer, directories } = packages(t);
  assert.throws(() =>
    assembleWindowsRelease(
      join(root, "noarm"),
      { [x64]: directories[x64] },
      version,
      source,
      signer.publicKey,
    ),
  );
  assert.throws(
    () =>
      assembleWindowsRelease(
        join(root, "other"),
        directories,
        version,
        "e".repeat(40),
        signer.publicKey,
      ),
    /manifest does not match/,
  );
});

test("a Tauri signature for a different release file cannot enter the platform feed", (t) => {
  const { root, signer, directories, payloads } = packages(t);
  writeFileSync(
    join(directories[arm64], `${filenames[arm64]}.sig`),
    signer.sign(payloads[arm64], version, filenames[x64]),
  );
  assert.throws(
    () =>
      assembleWindowsRelease(
        join(root, "mixed"),
        directories,
        version,
        source,
        signer.publicKey,
      ),
    /not bound/,
  );
});

test("the release executable matches the selected machine and has a stable version", () => {
  verifyApplicationMachine(executable(0x8664), x64);
  verifyApplicationMachine(executable(0xaa64), arm64);
  assert.throws(
    () => verifyApplicationMachine(executable(0x8664), arm64),
    /does not match/,
  );
  assert.throws(
    () => verifyApplicationMachine(Buffer.from("MZ"), arm64),
    /does not match/,
  );
  assert.equal(stableWindowsVersion(version), version);
  for (const bad of ["2026.11.20-preview", "0.00.1", "1.2.65536", "v1.2.3"]) {
    assert.throws(
      () => stableWindowsVersion(bad),
      /Expected a stable Windows version/,
    );
  }
});
