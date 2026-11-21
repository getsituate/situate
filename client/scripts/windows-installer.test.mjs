import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { installerConfig, prepareInstaller } from "./windows-installer.mjs";

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

test("a corrupt archive is rejected before staging any resources", (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-installer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const corrupt = join(root, "altered.tar.bz2");
  writeFileSync(corrupt, "altered archive");
  const output = join(root, "output");
  assert.throws(
    () => prepareInstaller(output, corrupt, corrupt),
    /Archive checksum mismatch/,
  );
  assert.equal(existsSync(output), false);
});
