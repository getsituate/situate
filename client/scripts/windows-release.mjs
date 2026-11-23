import {
  copyFileSync,
  constants,
  mkdirSync,
  readFileSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  hashReleaseFileDescriptor,
  verifyUpdaterSignature,
  withReleaseFile,
} from "./updater-signing.mjs";

export const windowsStableEndpoint =
  "https://getsituate.com/releases/windows/current/update.json";
const architectures = {
  "x86_64-pc-windows-msvc": {
    download: "x64",
    updater: "windows-x86_64",
    machine: 0x8664,
  },
  "aarch64-pc-windows-msvc": {
    download: "arm64",
    updater: "windows-aarch64",
    machine: 0xaa64,
  },
};

export function stableWindowsVersion(version) {
  if (
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(version) ||
    version.split(".").some((component) => Number(component) > 65535)
  )
    throw new Error(
      "Expected a stable Windows version with three 16-bit components.",
    );
  return version;
}

export function windowsReleaseTag(version) {
  return `windows-v${stableWindowsVersion(version)}`;
}

export function windowsReleaseFilename(version, target) {
  stableWindowsVersion(version);
  if (!Object.hasOwn(architectures, target))
    throw new Error("Unsupported Windows release target.");
  return `Situate-${version}-windows-${architectures[target].download}-setup.exe`;
}

export function verifyApplicationMachine(bytes, target) {
  const offset = bytes.length >= 64 ? bytes.readUInt32LE(0x3c) : 0;
  if (
    !Object.hasOwn(architectures, target) ||
    bytes.toString("ascii", 0, 2) !== "MZ" ||
    offset < 64 ||
    offset + 6 > bytes.length ||
    bytes.readUInt32LE(offset) !== 0x4550 ||
    bytes.readUInt16LE(offset + 4) !== architectures[target].machine
  ) {
    throw new Error(
      `Windows application does not match release target ${target}.`,
    );
  }
}

export function readWindowsInstaller(directory, version, target, publicKey) {
  const file = windowsReleaseFilename(version, target);
  const path = join(directory, file);
  const signature = readFileSync(`${path}.sig`, "utf8").trim();
  verifyUpdaterSignature(path, signature, publicKey, version, file);
  return withReleaseFile(path, (fd, { size }) => {
    const magic = Buffer.alloc(2);
    if (
      size < 64 ||
      readSync(fd, magic, 0, 2, 0) !== 2 ||
      magic.toString("ascii") !== "MZ"
    ) {
      throw new Error("Expected a Windows installer executable.");
    }
    return {
      file,
      size,
      sha256: hashReleaseFileDescriptor(fd, size).toString("hex"),
      signature,
    };
  });
}

export function windowsReleaseMetadata(
  directories,
  version,
  source,
  publicKey,
) {
  stableWindowsVersion(version);
  if (!/^[0-9a-f]{40}$/u.test(source))
    throw new Error("Expected the exact release checkout SHA.");
  const platforms = {};
  const artifacts = [];
  for (const [target, { updater }] of Object.entries(architectures)) {
    const directory = directories[target];
    const manifest = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    );
    const { file, size, sha256, signature } = readWindowsInstaller(
      directory,
      version,
      target,
      publicKey,
    );
    if (
      manifest.kind !== "situate-windows-release" ||
      manifest.source !== source ||
      manifest.version !== version ||
      manifest.target !== target ||
      manifest.authenticode !== false ||
      manifest.file !== file ||
      manifest.size !== size ||
      manifest.sha256 !== sha256
    ) {
      throw new Error(`Windows release manifest does not match ${target}.`);
    }
    artifacts.push({ target, file, size, sha256 });
    platforms[updater] = {
      url: `https://github.com/getsituate/situate/releases/download/${windowsReleaseTag(version)}/${file}`,
      signature,
    };
  }
  return { artifacts, feed: { version, distribution: "direct", platforms } };
}

export function assembleWindowsRelease(
  output,
  directories,
  version,
  source,
  publicKey,
) {
  const { artifacts, feed } = windowsReleaseMetadata(
    directories,
    version,
    source,
    publicKey,
  );
  mkdirSync(output);
  for (const { target, file } of artifacts) {
    for (const name of [file, `${file}.sig`]) {
      copyFileSync(
        join(directories[target], name),
        join(output, name),
        constants.COPYFILE_EXCL,
      );
    }
  }
  for (const { target, file, sha256 } of artifacts) {
    const copied = readWindowsInstaller(output, version, target, publicKey);
    if (
      copied.sha256 !== sha256 ||
      copied.signature !==
        feed.platforms[architectures[target].updater].signature
    ) {
      throw new Error(`Copied installer differs from its manifest: ${file}`);
    }
  }
  writeFileSync(
    join(output, "SHA256SUMS.txt"),
    `${artifacts.map(({ file, sha256 }) => `${sha256}  ${file}`).join("\n")}\n`,
    { flag: "wx" },
  );
  writeFileSync(
    join(output, "update.json"),
    `${JSON.stringify(feed, null, 2)}\n`,
    { flag: "wx" },
  );
  writeFileSync(
    join(output, "manifest.json"),
    `${JSON.stringify({ version, source, artifacts }, null, 2)}\n`,
    { flag: "wx" },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [output, version, source, x64, arm64, ...extra] = process.argv.slice(2);
  if (!output || !version || !source || !x64 || !arm64 || extra.length) {
    throw new Error(
      "Usage: node client/scripts/windows-release.mjs NEW_DIRECTORY VERSION SOURCE_SHA X64_DIRECTORY ARM64_DIRECTORY",
    );
  }
  assembleWindowsRelease(
    output,
    {
      "x86_64-pc-windows-msvc": x64,
      "aarch64-pc-windows-msvc": arm64,
    },
    version,
    source,
    process.env.SITUATE_UPDATER_PUBLIC_KEY,
  );
}
