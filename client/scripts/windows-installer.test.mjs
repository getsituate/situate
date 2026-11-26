import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  installerConfig,
  prepareInstaller,
  qualificationBaseline,
  runtimeArchives,
} from "./windows-installer.mjs";

test("stable installer builds reject missing Gmail inputs on both architectures", () => {
  for (const [target, id, secret] of [
    ["x86_64-pc-windows-msvc", "", "synthetic-secret"],
    ["aarch64-pc-windows-msvc", "synthetic.apps.googleusercontent.com", " "],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./windows-installer.mjs", import.meta.url)),
        `--target=${target}`,
        "--release-version=2026.11.20",
      ],
      {
        env: {
          ...process.env,
          SITUATE_GMAIL_TEST_CLIENT_ID: id,
          SITUATE_GMAIL_TEST_CLIENT_SECRET: secret,
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Gmail sign-in configuration is required. In the windows-release environment/,
    );
    assert.doesNotMatch(result.stderr, /synthetic/);
  }
});

test("runtime downloads depend on the target, not the build machine", () => {
  const x64 = runtimeArchives("x86_64-pc-windows-msvc");
  const arm64 = runtimeArchives("aarch64-pc-windows-msvc");
  assert.match(x64.sherpa.url, /-win-x64-shared-MT-Release\.tar\.bz2$/u);
  assert.match(arm64.sherpa.url, /-win-arm64-shared-MT-Release\.tar\.bz2$/u);
  assert.match(arm64.onnx.url, /-win-arm64-MT-Release-1\.28\.2\.tar\.bz2$/u);
  assert.notEqual(x64.sherpa.sha256, arm64.sherpa.sha256);
  assert.notEqual(x64.onnx.sha256, arm64.onnx.sha256);
  assert.throws(
    () => runtimeArchives("i686-pc-windows-msvc"),
    /Unsupported Windows installer target/u,
  );
});

test("the per-user NSIS preview includes only the dictation runtime and its notices", () => {
  const config = installerConfig(join(tmpdir(), "windows-installer-fixture"));
  assert.notEqual(config.identifier, "com.getsituate.app");
  assert.notEqual(config.productName, "Situate");
  assert.deepEqual(config.bundle.targets, ["nsis"]);
  assert.equal(config.bundle.windows.nsis.installMode, "currentUser");
  assert.equal(
    config.bundle.windows.webviewInstallMode.type,
    "embedBootstrapper",
  );
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.deepEqual(Object.values(config.bundle.resources).sort(), [
    "dictation/Model-Attribution.txt",
    "dictation/sherpa-onnx-2.0.2/ONNXRuntime-LICENSE.txt",
    "dictation/sherpa-onnx-2.0.2/ONNXRuntime-ThirdPartyNotices.txt",
    "dictation/sherpa-onnx-2.0.2/SHERPA-ONNX-LICENSE.txt",
    "dictation/sherpa-onnx-2.0.2/onnxruntime.dll",
    "dictation/sherpa-onnx-2.0.2/onnxruntime_providers_shared.dll",
    "dictation/sherpa-onnx-2.0.2/sherpa-onnx-c-api.dll",
  ]);
});

test("the qualification baseline shares the release identity but uses only the isolated feed and public key", () => {
  const environment = {
    SITUATE_UPDATER_PUBLIC_KEY: "fixture public key",
    SITUATE_UPDATER_ENDPOINT:
      "https://getsituate.com/releases/windows/current/update.json",
    SITUATE_RELEASE_VERSION: "2026.11.20",
    SITUATE_RELEASE_HISTORY_FILE: "test-history.json",
    SITUATE_RELEASE_HISTORY_SHA256: "a".repeat(64),
    SITUATE_MIGRATION_MINIMUM_VERSIONS: '{"3":"2026.11.10"}',
  };
  assert.deepEqual(qualificationBaseline("0.1.6", environment), {
    overlay: {
      identifier: "com.getsituate.app",
      productName: "Situate",
      version: "0.1.6",
    },
    environment: {
      SITUATE_DISTRIBUTION: "direct",
      SITUATE_UPDATER_PUBLIC_KEY: "fixture public key",
      SITUATE_UPDATER_ENDPOINT: "https://example.invalid/update.json",
      SITUATE_GMAIL_TEST_CLIENT_ID: "",
      SITUATE_GMAIL_TEST_CLIENT_SECRET: "",
    },
  });
  assert.throws(
    () => qualificationBaseline("2026.11.20", {}),
    /public key only/,
  );
  assert.throws(
    () =>
      qualificationBaseline("2026.11.20", {
        ...environment,
        TAURI_SIGNING_PRIVATE_KEY: "synthetic",
      }),
    /public key only/,
  );
  assert.throws(
    () => qualificationBaseline("2026.11.20-preview", environment),
    /stable Windows version/,
  );
  assert.throws(
    () => qualificationBaseline("2026.11.20", environment),
    /checked-in version/,
  );
});

test("a corrupt archive is rejected before staging any resources", (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-installer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const corrupt = join(root, "altered.tar.bz2");
  writeFileSync(corrupt, "altered archive");
  const output = join(root, "output");
  for (const target of ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"]) {
    assert.throws(
      () => prepareInstaller(output, corrupt, corrupt, target),
      /Archive checksum mismatch/,
    );
  }
  assert.equal(existsSync(output), false);
});
