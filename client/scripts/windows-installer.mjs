import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { windowsTarget } from "../../tools/test-windows.mjs";
import { prepareDependencies } from "../../tools/test.mjs";

const client = fileURLToPath(new URL("../", import.meta.url));
const app = join(client, "app");
const license = join(
  client,
  "crates/situate-host-windows/SHERPA-ONNX-LICENSE.txt",
);
const runtime = "dictation/sherpa-onnx-2.0.2";

const targets = {
  [windowsTarget]: {
    arch: "x64",
    sherpaHash:
      "55ada3f155344355c4b07445a10f4d96708a96bc483d69641fafc4966b6578ef",
    onnxHash:
      "cd7f757f7a38ce14238bc9198bee197a9430b42ec3ecadea3408dd2e832eb02e",
  },
  "aarch64-pc-windows-msvc": {
    arch: "arm64",
    sherpaHash:
      "6a902113e0ab0d9cff340fb9d6e20b4e2d7f0eff2a77dccdbd67e346a96057ba",
    onnxHash:
      "59877bc38b2c1eed1375597b9da2403b314b1103693d1dd0397c00cbcad1c1ab",
  },
};

export function runtimeArchives(target) {
  if (!Object.hasOwn(targets, target))
    throw new Error(`Unsupported Windows installer target: ${target}`);
  const { arch, sherpaHash, onnxHash } = targets[target];
  const sherpa = `sherpa-onnx-v2.0.2-win-${arch}-shared-MT-Release`;
  const onnx = `onnxruntime-win-${arch}-MT-Release-1.28.2`;
  return {
    sherpa: {
      root: sherpa,
      sha256: sherpaHash,
      url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.2/${sherpa}.tar.bz2`,
    },
    onnx: {
      root: onnx,
      sha256: onnxHash,
      url: `https://github.com/csukuangfj/onnxruntime-libs/releases/download/v1.28.2/${onnx}.tar.bz2`,
    },
  };
}

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

export function prepareInstaller(
  directory,
  sherpaArchive,
  onnxArchive,
  target = windowsTarget,
) {
  const { sherpa, onnx } = runtimeArchives(target);
  const extractSherpa = verifiedArchive(sherpaArchive, sherpa.sha256);
  const extractOnnx = verifiedArchive(onnxArchive, onnx.sha256);
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
      extractSherpa(`${sherpa.root}/lib/${name}`),
      { flag: "wx" },
    );
  }
  for (const [member, name] of [
    ["LICENSE", "ONNXRuntime-LICENSE.txt"],
    ["ThirdPartyNotices.txt", "ONNXRuntime-ThirdPartyNotices.txt"],
  ]) {
    writeFileSync(
      join(resources, name),
      extractOnnx(`${onnx.root}/${member}`),
      {
        flag: "wx",
      },
    );
  }
  const config = join(directory, "installer.json");
  writeFileSync(config, JSON.stringify(installerConfig(resources)), {
    flag: "wx",
  });
  return config;
}

async function main(args) {
  if (args.length === 2 && args[0] === "--runtime-archives") {
    console.log(JSON.stringify(runtimeArchives(args[1])));
    return;
  }
  const { values, positionals } = parseArgs({
    args,
    options: { target: { type: "string" }, "update-test": { type: "boolean" } },
    allowPositionals: true,
  });
  const target = values.target ?? windowsTarget;
  if (positionals.length !== 3) {
    throw new Error(
      "Usage: node client/scripts/windows-installer.mjs NEW_DIRECTORY SHERPA_ARCHIVE ONNX_ARCHIVE [--update-test] [--target=RUST_TARGET]",
    );
  }
  if (
    process.platform !== "win32" ||
    !["x64", "arm64"].includes(process.arch)
  ) {
    throw new Error("Build the installer on a Windows MSVC build host.");
  }
  if (
    process.env.TAURI_CONFIG !== undefined ||
    process.env.SITUATE_DISTRIBUTION !== undefined
  ) {
    throw new Error(
      "Unset TAURI_CONFIG and SITUATE_DISTRIBUTION before building the preview installer.",
    );
  }
  const [output, sherpaArchive, onnxArchive] = positionals;
  const directory = resolve(output);
  const config = prepareInstaller(
    directory,
    sherpaArchive,
    onnxArchive,
    target,
  );
  const dependencies = await prepareDependencies("client", { force: true });
  try {
    if (dependencies.failure) throw new Error(dependencies.failure.error);
    if (values["update-test"]) buildUpdatePair(directory, config, target);
    else buildInstaller(directory, config, target, process.env);
  } finally {
    dependencies.release();
  }
}

const tauriCli = join(client, "node_modules/@tauri-apps/cli/tauri.js");
function buildInstaller(directory, config, target, environment) {
  execFileSync(
    process.execPath,
    [
      tauriCli,
      "build",
      "--ci",
      "--target",
      target,
      "--config",
      config,
      "--no-sign",
      "--",
      "--locked",
    ],
    {
      cwd: app,
      env: { ...environment, CARGO_TARGET_DIR: join(directory, "target") },
      stdio: "inherit",
    },
  );
}

function buildUpdatePair(directory, config, target) {
  const signer = mkdtempSync(join(directory, "signer-"));
  const key = join(signer, "fixture.key");
  const artifact = join(directory, "pair");
  try {
    execFileSync(
      process.execPath,
      [
        tauriCli,
        "signer",
        "generate",
        "--ci",
        "--password",
        "",
        "--write-keys",
        key,
      ],
      { cwd: app, stdio: "pipe" },
    );
    const publicKey = readFileSync(`${key}.pub`, "utf8").trim();
    const environment = {
      ...process.env,
      SITUATE_DISTRIBUTION: "direct",
      SITUATE_UPDATER_PUBLIC_KEY: publicKey,
      SITUATE_UPDATER_ENDPOINT: "https://example.invalid/update.json",
    };
    mkdirSync(artifact);
    const overlay = JSON.parse(readFileSync(config, "utf8"));
    overlay.identifier = "com.getsituate.updater-preview";
    overlay.productName = "Situate Update Preview";
    const packages = [];
    for (const version of ["0.1.6", "0.1.7"]) {
      const bundle = join(
        directory,
        "target",
        target,
        "release",
        "bundle",
        "nsis",
      );
      rmSync(bundle, { recursive: true, force: true });
      writeFileSync(config, JSON.stringify({ ...overlay, version }));
      buildInstaller(directory, config, target, environment);
      const files = readdirSync(bundle).filter((file) => file.endsWith(".exe"));
      if (files.length !== 1) throw new Error("Expected one NSIS installer");
      const file = `${version}.exe`;
      const output = join(artifact, file);
      copyFileSync(join(bundle, files[0]), output);
      execFileSync(
        process.execPath,
        [
          tauriCli,
          "signer",
          "sign",
          "--private-key-path",
          key,
          "--password",
          "",
          "--app-version",
          version,
          output,
        ],
        { cwd: app, stdio: "pipe" },
      );
      packages.push({
        version,
        file,
        sha256: createHash("sha256").update(readFileSync(output)).digest("hex"),
      });
    }
    writeFileSync(
      join(artifact, "manifest.json"),
      `${JSON.stringify({ kind: "situate-windows-update-pair", target, source: process.env.GITHUB_SHA, packages }, null, 2)}\n`,
      { flag: "wx" },
    );
  } finally {
    rmSync(signer, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main(process.argv.slice(2));
}
