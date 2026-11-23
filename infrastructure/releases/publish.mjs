import { windowsAssetNames } from "../../client/scripts/windows-release.mjs";
import {
  verifyPublicWindowsFeed,
  windowsFeedForRelease,
} from "./windows-feed.mjs";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  cpSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { validateReleaseContent } from "../../client/scripts/release-history.mjs";
import { readAppleEnv } from "../../client/scripts/apple-credentials.mjs";
import {
  appleEnvironment,
  loadAppleSettings,
} from "../../client/scripts/apple-release.mjs";
import {
  hashReleaseFileDescriptor,
  readReleaseFileDescriptor,
  updaterEndpoint,
  withReleaseFile,
  verifyUpdaterSignature,
} from "../../client/scripts/updater-signing.mjs";
import { verifyDirectPayloads } from "../../client/scripts/direct-release-verification.mjs";

import { sshArguments, readPublicationHistory } from "./transport.mjs";
import {
  qualifyPublishedMigrations,
  qualifyPublicCompatibilityMigrations,
} from "../../tools/published-migrations.mjs";
import { compareVersions } from "../../tools/release-catalog.mjs";
export { sshArguments } from "./transport.mjs";

const compareCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const root = fileURLToPath(new URL("../../", import.meta.url));
const client = join(root, "client");
const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const filename = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const storageProgram = fileURLToPath(
  new URL("./publication-storage.py", import.meta.url),
);
const directoryFlags =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const environment = () => appleEnvironment(process.env, client);

function readMetadata(path) {
  return withReleaseFile(path, (fd, stat) => {
    if (stat.size > 1024 * 1024)
      throw new Error("Release metadata exceeds 1 MiB.");
    return readReleaseFileDescriptor(fd, stat.size, 1024 * 1024);
  });
}

function json(path) {
  return JSON.parse(readMetadata(path));
}

function file(directory, name, expected, { limit, requireSize = true } = {}) {
  if (typeof name !== "string" || !filename.test(name) || name.trim() !== name)
    throw new Error("Unsafe artifact path.");
  const path = join(directory, name);
  return withReleaseFile(path, (fd, stat) => {
    if (
      stat.size <= 0 ||
      (requireSize && stat.size !== expected.size) ||
      !/^[a-f0-9]{64}$/.test(expected.sha256)
    )
      throw new Error(
        "Artifact bytes or size do not match the complete manifest.",
      );
    const bytes = limit
      ? readReleaseFileDescriptor(fd, stat.size, limit)
      : undefined;
    const digest = bytes
      ? hash(bytes)
      : hashReleaseFileDescriptor(fd, stat.size).toString("hex");
    if (digest !== expected.sha256)
      throw new Error(
        "Artifact bytes or size do not match the complete manifest.",
      );
    return bytes ?? path;
  });
}

export function validateManifest(
  directory,
  manifest,
  { revision, identifier, teamId, publicKey },
) {
  if (
    revision?.length !== 40 ||
    !/^[a-f0-9]{40}$/.test(revision ?? "") ||
    manifest.schemaVersion !== 1 ||
    manifest.status !== "complete" ||
    manifest.dirty !== false ||
    manifest.revision !== revision ||
    !semver.test(manifest.version) ||
    manifest.version.trim() !== manifest.version ||
    manifest.distribution !== "direct"
  )
    throw new Error(
      "Publication requires a complete direct release built from the exact reviewed commit without uncommitted source changes.",
    );
  const artifacts = manifest.artifacts?.filter(
    (item) => item.platform === "macos",
  );
  if (artifacts?.length !== 1)
    throw new Error("Expected one macOS release artifact.");
  const artifact = artifacts[0];
  if (
    artifact.distribution !== "direct" ||
    artifact.version !== manifest.version ||
    artifact.identifier !== identifier ||
    artifact.teamId !== teamId ||
    !/^[A-Z0-9]{10}$/.test(teamId) ||
    artifact.notarized !== true ||
    artifact.architecture !== "universal" ||
    JSON.stringify(artifact.architectures) !==
      JSON.stringify(["arm64", "x86_64"]) ||
    !/^\d+\.\d+(?:\.\d+)?$/.test(artifact.minimumSystemVersion ?? "") ||
    !/^[a-f0-9]{64}$/.test(artifact.bundleSha256 ?? "") ||
    artifact.buildConfiguration?.distribution !== "direct" ||
    artifact.buildConfiguration?.publicKey !== publicKey ||
    artifact.buildConfiguration?.endpoint !== updaterEndpoint ||
    artifact.buildConfiguration?.sourceRevision !== revision ||
    artifact.buildConfiguration?.sourceDirty !== false
  )
    throw new Error(
      "Expected the production direct universal app identity and updater configuration.",
    );
  if (
    Object.hasOwn(manifest, "releaseContent") ||
    Object.hasOwn(artifact, "releaseContent") ||
    Object.hasOwn(artifact.buildConfiguration, "releaseContent")
  ) {
    validateReleaseContent(manifest.releaseContent, manifest.version);
    if (
      !isDeepStrictEqual(manifest.releaseContent, artifact.releaseContent) ||
      !isDeepStrictEqual(
        manifest.releaseContent,
        artifact.buildConfiguration.releaseContent,
      )
    )
      throw new Error("Manifest release-content bindings disagree.");
  }
  if (
    (Object.hasOwn(manifest, "migrationQualification") ||
      Object.hasOwn(artifact.buildConfiguration, "migrationQualification")) &&
    !isDeepStrictEqual(
      manifest.migrationQualification,
      artifact.buildConfiguration.migrationQualification,
    )
  )
    throw new Error(
      "Manifest migration qualification differs from the signed build configuration.",
    );
  if (
    !artifact.path.endsWith("-direct.dmg") ||
    !artifact.updater?.path.endsWith("-direct.app.tar.gz") ||
    artifact.updater.signaturePath !== `${artifact.updater.path}.sig`
  )
    throw new Error("Unexpected direct artifact names.");
  file(directory, artifact.path, artifact);
  const archive = file(directory, artifact.updater.path, artifact.updater);
  const signatureBytes = file(
    directory,
    artifact.updater.signaturePath,
    {
      size: artifact.updater.signatureSize,
      sha256: artifact.updater.signatureSha256,
    },
    { limit: 1024 * 1024 },
  );
  if (signatureBytes.toString("utf8").trim() !== artifact.updater.signature)
    throw new Error("Updater signature sidecar differs from manifest.");
  verifyUpdaterSignature(
    archive,
    artifact.updater.signature,
    publicKey,
    manifest.version,
  );
  if (Object.hasOwn(manifest, "releaseInputs"))
    verifyImmutableInputs(directory, manifest);
  return artifact;
}

export function verifyImmutableInputs(directory, manifest) {
  const inputs = manifest.releaseInputs;
  if (
    manifest.qualification?.path !== "release-qualification.json" ||
    inputs?.path !== "release-inputs.json" ||
    inputs.catalogPath !== "situate-release-history.json" ||
    !/^[a-f0-9]{64}$/.test(inputs.sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(inputs.catalogSha256 ?? "")
  )
    throw new Error("Invalid immutable release input bindings.");
  const files = {
    [inputs.path]: inputs.sha256,
    [inputs.catalogPath]: inputs.catalogSha256,
  };
  for (const [name, sha256] of Object.entries(files))
    file(directory, name, { sha256 }, { requireSize: false });
  return files;
}

export function verifyDownloadReceipt(directory, manifest, receipt) {
  const identity = receipt?.identity;
  const expected = [
    "manifest.json",
    ...publicInputFiles(manifest),
    ...manifest.artifacts
      .filter((item) => item.platform === "macos")
      .flatMap((item) => [
        item.path,
        item.updater.path,
        item.updater.signaturePath,
      ]),
    "github-release.json",
    ...(receipt?.assets?.some?.(({ name }) => name === "windows-release.json")
      ? windowsAssetNames(manifest.version)
      : []),
  ].sort(compareCodeUnits);
  if (
    receipt?.schemaVersion !== 1 ||
    receipt.kind !== "github-release-download" ||
    identity?.repository !== "getsituate/situate" ||
    identity.tag !== `v${manifest.version}` ||
    typeof identity.operationId !== "string" ||
    !identity.operationId ||
    !Number.isSafeInteger(identity.releaseId) ||
    identity.releaseId <= 0 ||
    identity.sourceRevision !== manifest.revision ||
    identity.version !== manifest.version ||
    identity.inputSha256 !== manifest.releaseInputs?.sha256 ||
    !/^[a-f0-9]{64}$/.test(receipt.evidenceSha256 ?? "") ||
    !Array.isArray(receipt.assets) ||
    !isDeepStrictEqual(
      receipt.assets.map((item) => item.name).sort(compareCodeUnits),
      expected,
    )
  )
    throw new Error(
      "Downloaded GitHub Release identity or public asset inventory differs.",
    );
  const ids = new Set();
  for (const asset of receipt.assets) {
    if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || ids.has(asset.id))
      throw new Error(
        "Downloaded GitHub asset IDs must be unique positive integers.",
      );
    ids.add(asset.id);
    file(directory, asset.name, asset);
  }
  if (
    receipt.assets.find((asset) => asset.name === "github-release.json")
      .sha256 !== receipt.evidenceSha256
  )
    throw new Error("GitHub release evidence digest differs.");
  const inputs = json(join(directory, "release-inputs.json"));
  if (
    inputs.source !== identity.sourceRevision ||
    inputs.version !== identity.version ||
    inputs.tag !== identity.tag
  )
    throw new Error(
      "Generated inputs differ from the GitHub Release identity.",
    );
  return identity;
}

export function verifyPublicationInputs(
  directory,
  manifest,
  { action, releaseReceipt },
) {
  if (
    (action === "publish" && !manifest.releaseInputs) ||
    (manifest.releaseInputs && !releaseReceipt)
  )
    throw new Error(
      "Publication requires exact GitHub Release, immutable inputs and qualification.",
    );
  if (!manifest.releaseInputs) return {};
  const receiptBytes = readMetadata(resolve(releaseReceipt));
  const receipt = JSON.parse(receiptBytes);
  return {
    releaseIdentity: verifyDownloadReceipt(directory, manifest, receipt),
    releaseReceiptSha256: hash(receiptBytes),
    ...(receipt.assets.some(({ name }) => name === "windows-release.json")
      ? { includesWindows: true }
      : {}),
  };
}

function publicInputFiles(manifest) {
  return manifest.releaseInputs
    ? [
        "release-inputs.json",
        "situate-release-history.json",
        "release-qualification.json",
      ]
    : [];
}

export async function verifyPublicAvailability(
  manifest,
  artifact,
  { fetchImpl = fetch } = {},
) {
  const expectedMetadata = metadata(manifest, artifact);
  const fetchPublic = async (url) => {
    const response = await fetchImpl(url, {
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new Error("Public release endpoint is unavailable.");
    return response;
  };
  const verifyFeeds = async () => {
    for (const name of ["download.json", "update.json"]) {
      const response = await fetchPublic(
        `https://getsituate.com/releases/current/${name}`,
      );
      let bytes = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024)
          throw new Error("Public release metadata exceeds 1 MiB.");
        chunks.push(chunk);
      }
      if (
        !isDeepStrictEqual(
          JSON.parse(Buffer.concat(chunks)),
          expectedMetadata[name],
        )
      )
        throw new Error(
          "Public release metadata differs from the activated candidate.",
        );
    }
  };
  await verifyFeeds();
  for (const item of [
    artifact,
    artifact.updater,
    {
      path: artifact.updater.signaturePath,
      size: artifact.updater.signatureSize,
      sha256: artifact.updater.signatureSha256,
    },
  ]) {
    const response = await fetchPublic(
      `https://getsituate.com/releases/${manifest.version}/${item.path}`,
    );
    const digest = createHash("sha256");
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > item.size)
        throw new Error("Public package size differs from the candidate.");
      digest.update(chunk);
    }
    if (size !== item.size || digest.digest("hex") !== item.sha256)
      throw new Error("Public package bytes differ from the candidate.");
  }
  await verifyFeeds();
  return { version: manifest.version, verified: true };
}

export function metadata(manifest, artifact) {
  const url = (name) =>
    `https://getsituate.com/releases/${manifest.version}/${name}`;
  const platform = {
    url: url(artifact.updater.path),
    signature: artifact.updater.signature,
  };
  return {
    "update.json": {
      version: manifest.version,
      distribution: "direct",
      platforms: { "darwin-aarch64": platform, "darwin-x86_64": platform },
    },
    "download.json": {
      version: manifest.version,
      url: url(artifact.path),
      sha256: artifact.sha256,
      size: artifact.size,
      minimumSystemVersion: artifact.minimumSystemVersion,
      architecture: artifact.architecture,
      distribution: "direct",
    },
    "descriptor.json": {
      schemaVersion: 1,
      version: manifest.version,
      distribution: "direct",
      revision: manifest.revision,
      artifact,
    },
  };
}

function configuration(
  names = [
    "WEBSITE_DEPLOY_HOST",
    "WEBSITE_SSH_IDENTITY",
    "WEBSITE_SSH_KNOWN_HOSTS",
    "SITUATE_UPDATER_PUBLIC_KEY",
  ],
  { environment = process.env, clientRoot = client } = {},
) {
  const needed = names.filter((name) => !Object.hasOwn(environment, name));
  const local =
    environment.CI || needed.length === 0
      ? {}
      : readAppleEnv(clientRoot, needed);
  return Object.fromEntries(
    names.map((name) => [
      name,
      Object.hasOwn(environment, name) ? environment[name] : local[name],
    ]),
  );
}

export function publicationDestination(options) {
  const config = configuration(["WEBSITE_DEPLOY_HOST"], options);
  sshArguments(config);
  return { host: config.WEBSITE_DEPLOY_HOST };
}

export function assertReviewedRevision(
  revision,
  { cwd = root, env = environment() } = {},
) {
  const message =
    "--reviewed-revision must be the full SHA of a commit available in the local repository.";
  if (
    typeof revision !== "string" ||
    revision.length !== 40 ||
    !/^[a-f0-9]{40}$/.test(revision)
  )
    throw new Error(message);
  let object;
  try {
    object = execFileSync(
      "/usr/bin/git",
      ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
      {
        cwd,
        env: {
          ...env,
          GIT_NO_LAZY_FETCH: "1",
          GIT_NO_REPLACE_OBJECTS: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        input: `${revision}\n`,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
  } catch {
    throw new Error(message);
  }
  if (object !== `${revision} commit`) throw new Error(message);
}

async function preflight(directory, revision, config) {
  const env = environment();
  assertReviewedRevision(revision);
  const manifestBytes = readMetadata(join(directory, "manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const settings = loadAppleSettings(client);
  const identifier = json(
    join(client, "app/src-tauri/tauri.conf.json"),
  ).identifier;
  const artifact = validateManifest(directory, manifest, {
    revision,
    identifier,
    teamId: settings.teamId,
    publicKey: config.SITUATE_UPDATER_PUBLIC_KEY,
  });
  let qualificationSha256;
  if (manifest.releaseInputs) {
    const { verifyReleaseInputs } =
      await import("../../tools/release-inputs.mjs");
    const inputs = json(join(directory, manifest.releaseInputs.path));
    verifyReleaseInputs(
      inputs,
      file(
        directory,
        manifest.releaseInputs.catalogPath,
        {
          sha256: manifest.releaseInputs.catalogSha256,
        },
        { limit: 4 * 1024 * 1024, requireSize: false },
      ).toString("utf8"),
    );
    if (
      inputs.source !== manifest.revision ||
      inputs.version !== manifest.version
    )
      throw new Error(
        "Generated inputs differ from the release source or version.",
      );
    const { verifyQualificationReceipt } =
      await import("../../tools/release-qualification.mjs");
    const receiptBytes = readMetadata(
      join(directory, "release-qualification.json"),
    );
    verifyQualificationReceipt(directory, manifest, JSON.parse(receiptBytes));
    qualificationSha256 = hash(receiptBytes);
  }
  await verifyDirectPayloads(directory, artifact, { env });
  return {
    manifest,
    artifact,
    manifestSha256: hash(manifestBytes),
    qualificationSha256,
  };
}

function releaseMetadata(manifest, artifact, windowsFeed) {
  return {
    ...metadata(manifest, artifact),
    ...(windowsFeed ? { "windows-update.json": windowsFeed } : {}),
  };
}

function stage(directory, destination, manifest, artifact, windowsFeed) {
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  mkdirSync(join(destination, "metadata"));
  for (const name of [
    artifact.path,
    artifact.updater.path,
    artifact.updater.signaturePath,
    "manifest.json",
    ...publicInputFiles(manifest),
  ])
    cpSync(join(directory, name), join(destination, name), {
      errorOnExist: true,
      force: false,
    });
  for (const [name, value] of Object.entries(
    releaseMetadata(manifest, artifact, windowsFeed),
  ))
    writeFileSync(
      join(destination, "metadata", name),
      `${JSON.stringify(value, null, 2)}\n`,
      { flag: "wx" },
    );
}

function inventory(destination) {
  const files = {};
  for (const directory of [destination, join(destination, "metadata")]) {
    if (!lstatSync(directory).isDirectory())
      throw new Error("Expected a staged release directory without symlinks.");
    for (const name of readdirSync(directory).sort(compareCodeUnits)) {
      const path = join(directory, name);
      if (
        directory === destination &&
        name === "metadata" &&
        lstatSync(path).isDirectory() &&
        !lstatSync(path).isSymbolicLink()
      )
        continue;
      if (!filename.test(name))
        throw new Error("Unexpected staged release entry.");
      files[directory === destination ? name : `metadata/${name}`] =
        withReleaseFile(path, (fd, stat) => ({
          size: stat.size,
          sha256: hashReleaseFileDescriptor(fd, stat.size).toString("hex"),
        }));
    }
  }
  return files;
}

function openPublicationDirectory(path) {
  const selected = lstatSync(path, { bigint: true });
  const fd = openSync(path, directoryFlags);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (opened.dev !== selected.dev || opened.ino !== selected.ino)
      throw new Error("Publication directory changed while opening it.");
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function storage(directory, operation, options = {}, args = []) {
  return execFileSync(
    "/usr/bin/python3",
    ["-IB", storageProgram, operation, ...args],
    {
      env: {},
      encoding: "utf8",
      ...options,
      stdio: ["pipe", "pipe", "pipe", directory],
    },
  );
}

function saveJournal(directory, value, exclusive = false) {
  storage(directory, exclusive ? "create-journal" : "replace-journal", {
    input: JSON.stringify(value, null, 2) + "\n",
  });
}

function remote(action, request, config, sendArchive) {
  if (
    !["inspect", "publish", "reconcile", "complete", "promote"].includes(action)
  )
    throw new Error("Unknown publication transport action.");
  const storage = readFileSync(new URL("./remote.py", import.meta.url), "utf8");
  const program =
    action === "promote"
      ? storage.replace("if __name__ == '__main__':", "if False:") +
        "\n" +
        readFileSync(new URL("./promote.py", import.meta.url), "utf8") +
        "\npromote_main()\n"
      : storage;
  const code = Buffer.from(program).toString("base64");
  const encoded = Buffer.from(JSON.stringify(request)).toString("base64");
  const command = `python3 -c 'import base64;exec(base64.b64decode("${code}"))' ${action} ${encoded}`;
  const args = [...sshArguments(config), command];
  const options = {
    env: {
      ...environment(),
      ...(process.env.SSH_AUTH_SOCK
        ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }
        : {}),
    },
    timeout: 1800000,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  };
  try {
    return JSON.parse(
      sendArchive
        ? sendArchive(args, options)
        : execFileSync("/usr/bin/ssh", args, {
            ...options,
            stdio: ["ignore", "pipe", "pipe"],
          }),
    );
  } catch {
    throw new Error(
      action === "promote"
        ? "Publication was not confirmed over SSH. Check the public version before trying again."
        : "SSH outcome is uncertain. Do not retry publication; inspect and explicitly reconcile the retained journal.",
    );
  }
}

export async function qualifyPublicationCompatibility(
  repositoryRoot,
  manifest,
  { history, qualify = qualifyPublicCompatibilityMigrations },
) {
  const qualification = await qualify(repositoryRoot, {
    revision: manifest.revision,
    history,
  });
  if (
    qualification.releases.some(
      (release) => compareVersions(release.version, manifest.version) > 0,
    )
  )
    throw new Error(
      "A newer release is already recorded; inspect its publication state before promoting this candidate.",
    );
  return { schemaVersion: 1, source: manifest.revision, qualification };
}

export function withPublicationArchive(
  destination,
  names,
  expectedDigest,
  useArchive,
) {
  const stage = basename(destination);
  const parent = openPublicationDirectory(realpathSync(dirname(destination)));
  try {
    let archive;
    try {
      archive = JSON.parse(
        storage(parent, "prepare-archive", {
          input: JSON.stringify({ stage, names, expectedDigest }),
        }),
      );
    } catch {
      throw new Error("Cannot prepare publication archive.");
    }
    if (archive.error) throw new Error(archive.error);
    // Node cannot open files relative to a directory descriptor on macOS.
    return useArchive(archive.digest, (args, options) =>
      storage(
        parent,
        "send-archive",
        {
          ...options,
          input: JSON.stringify({ stage, digest: archive.digest }),
        },
        args,
      ),
    );
  } finally {
    closeSync(parent);
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      release: { type: "string" },
      stage: { type: "string" },
      "reviewed-revision": { type: "string" },
      confirm: { type: "string" },
      destination: { type: "string" },
      "ssh-identity": { type: "string" },
      "ssh-known-hosts": { type: "string" },
      "updater-public-key": { type: "string" },
      "release-receipt": { type: "string" },
      "recovery-evidence": { type: "string" },
      fresh: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  const [action] = positionals;
  if (values.fresh && action !== "publish")
    throw new Error("--fresh is only supported with publish.");
  if (values.help) {
    console.log(
      "Usage: node infrastructure/releases/publish.mjs destination | check|stage|publish|inspect|reconcile --release DIR --reviewed-revision SHA [--stage DIR] [--destination SSH_HOST] [--ssh-identity ABS_PATH] [--ssh-known-hosts ABS_PATH] [--updater-public-key KEY] [--confirm SSH_HOST:VERSION] [--release-receipt FILE] [--recovery-evidence LEGACY_FILE]",
    );
    return;
  }
  if (positionals.length === 1 && action === "destination") {
    console.log(JSON.stringify(publicationDestination()));
    return;
  }
  if (
    positionals.length !== 1 ||
    !["check", "stage", "publish", "inspect", "reconcile"].includes(action) ||
    !values.release
  )
    throw new Error(
      "Choose destination, or check, stage, publish, inspect or reconcile with --release DIR.",
    );
  const directory = realpathSync(resolve(values.release));
  const config = values.destination
    ? {
        WEBSITE_DEPLOY_HOST: values.destination,
        WEBSITE_SSH_IDENTITY: values["ssh-identity"],
        WEBSITE_SSH_KNOWN_HOSTS: values["ssh-known-hosts"],
        ...(action === "inspect"
          ? {}
          : Object.hasOwn(values, "updater-public-key")
            ? { SITUATE_UPDATER_PUBLIC_KEY: values["updater-public-key"] }
            : configuration(["SITUATE_UPDATER_PUBLIC_KEY"])),
      }
    : configuration();
  const journalDirectory = ["inspect", "publish", "reconcile"].includes(action)
    ? openPublicationDirectory(directory)
    : undefined;
  try {
    await runPublication(action, values, directory, config, journalDirectory);
  } finally {
    if (journalDirectory !== undefined) closeSync(journalDirectory);
  }
}

async function runPublication(
  action,
  values,
  directory,
  config,
  journalDirectory,
) {
  const journalText = () => {
    try {
      return storage(journalDirectory, "read-journal");
    } catch {
      throw new Error("Cannot read publication journal.");
    }
  };
  const readJournal = () => {
    const recorded = journalText();
    if (!recorded) throw new Error("Publication journal is missing.");
    return JSON.parse(recorded);
  };
  if (action === "inspect") {
    const journal = readJournal();
    if (journal.host !== config.WEBSITE_DEPLOY_HOST)
      throw new Error("Journal SSH destination differs from configuration.");
    const observed = remote("inspect", journal.request, config);
    saveJournal(journalDirectory, {
      ...journal,
      inspected: true,
      observed,
    });
    console.log(JSON.stringify(observed, null, 2));
    return;
  }
  if (action === "publish" && !values.fresh && journalText())
    throw new Error(
      "Publication journal exists; inspect and reconcile instead of retrying.",
    );
  const { manifest, artifact, manifestSha256, qualificationSha256 } =
    await preflight(directory, values["reviewed-revision"], config);
  let releaseIdentity;
  let releaseReceiptSha256;
  let windowsFeed;
  if (action === "publish" || action === "reconcile") {
    const publication = verifyPublicationInputs(directory, manifest, {
      action,
      releaseReceipt: values["release-receipt"],
    });
    ({ releaseIdentity, releaseReceiptSha256 } = publication);
    if (publication.includesWindows) {
      if (!values.fresh)
        throw new Error(
          "Use the hosted publisher for a combined desktop release.",
        );
      windowsFeed = windowsFeedForRelease(
        directory,
        releaseIdentity,
        configuration(["SITUATE_WINDOWS_UPDATER_PUBLIC_KEY"])
          .SITUATE_WINDOWS_UPDATER_PUBLIC_KEY,
      );
    }
  }
  if (action === "check") {
    console.log(`Verified direct release ${manifest.version}.`);
    return;
  }
  if (!values.stage)
    throw new Error(
      "Provide a new local --stage directory, or the existing stage for reconciliation.",
    );
  const destination = resolve(values.stage);
  if (action === "stage") {
    stage(directory, destination, manifest, artifact);
    verifyStagedRelease(
      destination,
      manifest,
      artifact,
      manifestSha256,
      qualificationSha256,
    );
    console.log(`Staged direct release ${manifest.version}.`);
    return;
  }
  if (values.confirm !== `${config.WEBSITE_DEPLOY_HOST}:${manifest.version}`)
    throw new Error("--confirm must exactly match SSH_HOST:VERSION.");
  sshArguments(config);
  let journal;
  if (action === "reconcile") {
    journal = readJournal();
    if (
      !journal.inspected ||
      journal.host !== config.WEBSITE_DEPLOY_HOST ||
      journal.stage !== destination ||
      journal.request.version !== manifest.version ||
      (journal.request.releaseIdentity &&
        !isDeepStrictEqual(journal.request.releaseIdentity, releaseIdentity)) ||
      (journal.releaseReceiptSha256 &&
        journal.releaseReceiptSha256 !== releaseReceiptSha256)
    )
      throw new Error(
        "Inspect the same journal, destination and release before reconciliation.",
      );
  } else {
    if (!existsSync(destination))
      stage(directory, destination, manifest, artifact, windowsFeed);
    journal = {
      host: config.WEBSITE_DEPLOY_HOST,
      stage: destination,
      state: "pending",
      releaseReceiptSha256,
      request: {
        releaseIdentity,
        version: manifest.version,
        token: randomUUID(),
        files: inventory(destination),
        publicVerificationRequired: true,
      },
    };
  }
  const staged = verifyStagedRelease(
    destination,
    manifest,
    artifact,
    manifestSha256,
    qualificationSha256,
    windowsFeed,
  );
  if (JSON.stringify(staged) !== JSON.stringify(journal.request.files))
    throw new Error("Staged inventory differs from the publication journal.");
  const history = readPublicationHistory(root, {
    environment: { ...process.env, ...config },
  });
  journal.publicCompatibility = await qualifyPublicationCompatibility(
    root,
    manifest,
    { history },
  );
  const qualification = qualifyPublishedMigrations(root, {
    revision: manifest.revision,
    history,
  });
  // An identical stored candidate can be the result of an interrupted activation.
  journal.request.migrationBaseline = qualification.releases.filter(
    (release) =>
      !(
        (action === "reconcile" || values.fresh) &&
        release.version === manifest.version &&
        release.manifestSha256 === manifestSha256
      ),
  );
  let result = withPublicationArchive(
    destination,
    Object.keys(staged),
    action === "reconcile" ? (journal.transportSha256 ?? null) : undefined,
    (transportSha256, sendArchive) => {
      assertReviewedRevision(values["reviewed-revision"]);
      if (values.fresh)
        return remote("promote", journal.request, config, sendArchive);
      journal.transportSha256 = transportSha256;
      saveJournal(
        journalDirectory,
        { ...journal, state: "pending", inspected: false },
        action === "publish",
      );
      return action === "reconcile"
        ? remote("reconcile", journal.request, config, sendArchive)
        : remote("publish", journal.request, config, sendArchive);
    },
  );
  await verifyPublicAvailability(manifest, artifact);
  if (windowsFeed) await verifyPublicWindowsFeed(windowsFeed);
  if (values.fresh) {
    console.log(JSON.stringify(result));
    return;
  }
  if (journal.request.publicVerificationRequired)
    result = remote("complete", journal.request, config);
  saveJournal(journalDirectory, {
    ...journal,
    state: "complete",
    result,
  });
  console.log(JSON.stringify(result));
}

export function verifyStagedRelease(
  destination,
  manifest,
  artifact,
  manifestSha256,
  qualificationSha256,
  windowsFeed,
) {
  const expectedMetadata = releaseMetadata(manifest, artifact, windowsFeed);
  const staged = inventory(destination);
  const expectedNames = [
    artifact.path,
    artifact.updater.path,
    artifact.updater.signaturePath,
    "manifest.json",
    ...publicInputFiles(manifest),
    ...Object.keys(expectedMetadata).map((name) => `metadata/${name}`),
  ].sort(compareCodeUnits);
  if (
    JSON.stringify(Object.keys(staged).sort(compareCodeUnits)) !==
    JSON.stringify(expectedNames)
  )
    throw new Error("Staged file inventory differs from the approved release.");
  for (const [name, value] of Object.entries(expectedMetadata))
    if (
      hash(Buffer.from(`${JSON.stringify(value, null, 2)}\n`)) !==
      staged[`metadata/${name}`]?.sha256
    )
      throw new Error("Staged metadata changed after approval.");
  const approvedHashes = {
    [artifact.path]: artifact.sha256,
    [artifact.updater.path]: artifact.updater.sha256,
    [artifact.updater.signaturePath]: artifact.updater.signatureSha256,
    "manifest.json": manifestSha256,
    ...(manifest.releaseInputs
      ? verifyImmutableInputs(destination, manifest)
      : {}),
  };
  if (manifest.releaseInputs) {
    const receipt = json(join(destination, "release-qualification.json"));
    if (
      !/^[a-f0-9]{64}$/.test(qualificationSha256 ?? "") ||
      staged["release-qualification.json"]?.sha256 !== qualificationSha256 ||
      receipt.manifestSha256 !== manifestSha256 ||
      receipt.releaseInputsSha256 !== manifest.releaseInputs.sha256 ||
      receipt.sourceRevision !== manifest.revision ||
      receipt.version !== manifest.version
    )
      throw new Error(
        "Qualification receipt differs from the immutable release.",
      );
  }
  for (const [name, approvedHash] of Object.entries(approvedHashes))
    if (approvedHash !== staged[name]?.sha256)
      throw new Error("Staged payload changed after approval.");
  return staged;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
