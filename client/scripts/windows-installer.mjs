import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { windowsTarget } from "../../tools/test-windows.mjs";
import { prepareDependencies } from "../../tools/test.mjs";

const client = fileURLToPath(new URL("../", import.meta.url));
const app = join(client, "app");
const license = join(
  client,
  "crates/situate-host-windows/SHERPA-ONNX-LICENSE.txt",
);
const sherpa = "sherpa-onnx-v2.0.2-win-x64-shared-MT-Release";
const onnx = "onnxruntime-win-x64-MT-Release-1.28.2";
const runtime = "dictation/sherpa-onnx-2.0.2";
const sherpaHash =
  "55ada3f155344355c4b07445a10f4d96708a96bc483d69641fafc4966b6578ef";
const onnxHash =
  "cd7f757f7a38ce14238bc9198bee197a9430b42ec3ecadea3408dd2e832eb02e";

function verifiedArchive(path, expected) {
  const archive = readFileSync(path);
  if (createHash("sha256").update(archive).digest("hex") !== expected) {
    throw new Error(`Archive checksum mismatch: ${path}`);
  }
  // Feed tar the verified bytes rather than asking it to reopen the archive.
  return (member) =>
    execFileSync("tar", ["-xOf", "-", member], {
      input: archive,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
}

export function installerConfig(directory) {
  return {
    identifier: "com.getsituate.installer-preview",
    productName: "Situate Preview",
    bundle: {
      targets: ["nsis"],
      createUpdaterArtifacts: false,
      windows: {
        nsis: { installMode: "currentUser" },
        webviewInstallMode: { type: "embedBootstrapper" },
      },
      resources: Object.fromEntries([
        ...[
          "sherpa-onnx-c-api.dll",
          "onnxruntime.dll",
          "onnxruntime_providers_shared.dll",
          "ONNXRuntime-LICENSE.txt",
          "ONNXRuntime-ThirdPartyNotices.txt",
        ].map((name) => [join(directory, name), `${runtime}/${name}`]),
        [license, `${runtime}/SHERPA-ONNX-LICENSE.txt`],
        [
          join(client, "app/src-tauri/dictation/windows-model-notice.txt"),
          "dictation/Model-Attribution.txt",
        ],
      ]),
    },
  };
}

export function prepareInstaller(directory, sherpaArchive, onnxArchive) {
  const extractSherpa = verifiedArchive(sherpaArchive, sherpaHash);
  const extractOnnx = verifiedArchive(onnxArchive, onnxHash);
  mkdirSync(directory);
  const resources = join(directory, "resources");
  mkdirSync(resources);
  for (const name of [
    "sherpa-onnx-c-api.dll",
    "onnxruntime.dll",
    "onnxruntime_providers_shared.dll",
  ]) {
    writeFileSync(
      join(resources, name),
      extractSherpa(`${sherpa}/lib/${name}`),
      { flag: "wx" },
    );
  }
  for (const [member, name] of [
    ["LICENSE", "ONNXRuntime-LICENSE.txt"],
    ["ThirdPartyNotices.txt", "ONNXRuntime-ThirdPartyNotices.txt"],
  ]) {
    writeFileSync(join(resources, name), extractOnnx(`${onnx}/${member}`), {
      flag: "wx",
    });
  }
  const config = join(directory, "installer.json");
  writeFileSync(config, JSON.stringify(installerConfig(resources)), {
    flag: "wx",
  });
  return config;
}

async function main([output, sherpaArchive, onnxArchive, ...extra]) {
  if (!output || !sherpaArchive || !onnxArchive || extra.length) {
    throw new Error(
      "Usage: node client/scripts/windows-installer.mjs NEW_DIRECTORY SHERPA_ARCHIVE ONNX_ARCHIVE",
    );
  }
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(
      "Build the installer with x64 Node.js on a Windows MSVC build host.",
    );
  }
  if (
    process.env.TAURI_CONFIG !== undefined ||
    process.env.SITUATE_DISTRIBUTION !== undefined
  ) {
    throw new Error(
      "Unset TAURI_CONFIG and SITUATE_DISTRIBUTION before building the preview installer.",
    );
  }
  const directory = resolve(output);
  const config = prepareInstaller(directory, sherpaArchive, onnxArchive);
  const dependencies = await prepareDependencies("client", { force: true });
  try {
    if (dependencies.failure) throw new Error(dependencies.failure.error);
    execFileSync(
      process.execPath,
      [
        join(client, "node_modules/@tauri-apps/cli/tauri.js"),
        "build",
        "--ci",
        "--target",
        windowsTarget,
        "--config",
        config,
        "--no-sign",
        "--",
        "--locked",
      ],
      {
        cwd: app,
        env: { ...process.env, CARGO_TARGET_DIR: join(directory, "target") },
        stdio: "inherit",
      },
    );
  } finally {
    dependencies.release();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main(process.argv.slice(2));
}
