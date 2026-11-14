import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
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
  updaterEndpoint,
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

const root = fileURLToPath(new URL("../../", import.meta.url));
const client = join(root, "client");
const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const filename = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const environment = () => appleEnvironment(process.env, client);

function json(path) {
  if (lstatSync(path).size > 1024 * 1024)
    throw new Error("Release metadata exceeds 1 MiB.");
  return JSON.parse(readFileSync(path, "utf8"));
}

function file(directory, name, expected) {
  if (!filename.test(name) || name.trim() !== name)
    throw new Error("Unsafe artifact path.");
  const path = join(directory, name);
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    !Number.isSafeInteger(expected.size) ||
    expected.size <= 0 ||
    stat.size !== expected.size ||
    !/^[a-f0-9]{64}$/.test(expected.sha256) ||
    hash(readFileSync(path)) !== expected.sha256
  )
    throw new Error(
      "Artifact bytes or size do not match the complete manifest.",
    );
  return path;
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
  const signaturePath = file(directory, artifact.updater.signaturePath, {
    size: artifact.updater.signatureSize,
    sha256: artifact.updater.signatureSha256,
  });
  if (readFileSync(signaturePath, "utf8").trim() !== artifact.updater.signature)
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
  for (const [name, sha256] of Object.entries(files)) {
    const size = lstatSync(join(directory, name)).size;
    file(directory, name, { size, sha256 });
  }
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
  ].sort();
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
    !isDeepStrictEqual(receipt.assets.map((item) => item.name).sort(), expected)
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
  return {
    releaseIdentity: verifyDownloadReceipt(
      directory,
      manifest,
      json(resolve(releaseReceipt)),
    ),
    releaseReceiptSha256: hash(readFileSync(resolve(releaseReceipt))),
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
  let type;
  try {
    type = execFileSync("git", ["cat-file", "-t", revision], {
      cwd,
      env: {
        ...env,
        GIT_NO_LAZY_FETCH: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(message);
  }
  if (type !== "commit") throw new Error(message);
}

async function preflight(directory, revision, config) {
  const env = environment();
  assertReviewedRevision(revision);
  const manifestPath = join(directory, "manifest.json");
  if (lstatSync(manifestPath).size > 1024 * 1024)
    throw new Error("Release metadata exceeds 1 MiB.");
  const manifestBytes = readFileSync(manifestPath);
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
  if (manifest.releaseInputs) {
    const { verifyReleaseInputs } =
      await import("../../tools/release-inputs.mjs");
    const inputs = json(join(directory, manifest.releaseInputs.path));
    verifyReleaseInputs(
      inputs,
      readFileSync(join(directory, manifest.releaseInputs.catalogPath), "utf8"),
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
    verifyQualificationReceipt(
      directory,
      manifest,
      json(join(directory, "release-qualification.json")),
    );
  }
  await verifyDirectPayloads(directory, artifact, { env });
  return {
    manifest,
    artifact,
    manifestSha256: hash(manifestBytes),
    qualificationSha256: manifest.releaseInputs
      ? hash(readFileSync(join(directory, "release-qualification.json")))
      : undefined,
  };
}

function stage(directory, destination, manifest, artifact) {
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
  for (const [name, value] of Object.entries(metadata(manifest, artifact)))
    writeFileSync(
      join(destination, "metadata", name),
      `${JSON.stringify(value, null, 2)}\n`,
      { flag: "wx" },
    );
}

function inventory(destination) {
  const files = {};
  for (const directory of [destination, join(destination, "metadata")])
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (
        directory === destination &&
        name === "metadata" &&
        lstatSync(path).isDirectory() &&
        !lstatSync(path).isSymbolicLink()
      )
        continue;
      const stat = lstatSync(path);
      if (!filename.test(name) || !stat.isFile() || stat.nlink !== 1)
        throw new Error("Unexpected staged release entry.");
      files[directory === destination ? name : `metadata/${name}`] = {
        size: stat.size,
        sha256: hash(readFileSync(path)),
      };
    }
  return files;
}

function saveJournal(path, value, exclusive = false) {
  const temporary = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  const handle = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  if (!exclusive) renameSync(temporary, path);
  const directory = openSync(resolve(path, ".."), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function remote(action, request, config, tar) {
  const code = readFileSync(new URL("./remote.py", import.meta.url)).toString(
    "base64",
  );
  const encoded = Buffer.from(JSON.stringify(request)).toString("base64");
  const command = `python3 -c 'import base64;exec(base64.b64decode("${code}"))' ${action} ${encoded}`;
  let input;
  try {
    input = tar ? openSync(tar, "r") : undefined;
    return JSON.parse(
      execFileSync("ssh", [...sshArguments(config), command], {
        env: {
          ...environment(),
          ...(process.env.SSH_AUTH_SOCK
            ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }
            : {}),
        },
        timeout: 1800000,
        encoding: "utf8",
        stdio: [input ?? "ignore", "pipe", "pipe"],
        maxBuffer: 1024 * 1024,
      }),
    );
  } catch {
    throw new Error(
      "SSH outcome is uncertain. Do not retry publication; inspect and explicitly reconcile the retained journal.",
    );
  } finally {
    if (input !== undefined) closeSync(input);
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
      help: { type: "boolean" },
    },
  });
  const [action] = positionals;
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
  const journalPath = join(directory, "publication-journal.json");
  if (action === "inspect") {
    const journal = json(journalPath);
    if (journal.host !== config.WEBSITE_DEPLOY_HOST)
      throw new Error("Journal SSH destination differs from configuration.");
    const observed = remote("inspect", journal.request, config);
    saveJournal(journalPath, { ...journal, inspected: true, observed });
    console.log(JSON.stringify(observed, null, 2));
    return;
  }
  if (action === "publish" && existsSync(journalPath))
    throw new Error(
      "Publication journal exists; inspect and reconcile instead of retrying.",
    );
  const { manifest, artifact, manifestSha256, qualificationSha256 } =
    await preflight(directory, values["reviewed-revision"], config);
  let releaseIdentity;
  let releaseReceiptSha256;
  if (action === "publish" || action === "reconcile") {
    ({ releaseIdentity, releaseReceiptSha256 } = verifyPublicationInputs(
      directory,
      manifest,
      { action, releaseReceipt: values["release-receipt"] },
    ));
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
    console.log(`Staged ${manifest.version}: ${destination}`);
    return;
  }
  if (values.confirm !== `${config.WEBSITE_DEPLOY_HOST}:${manifest.version}`)
    throw new Error("--confirm must exactly match SSH_HOST:VERSION.");
  sshArguments(config);
  let journal;
  if (action === "reconcile") {
    journal = json(journalPath);
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
      stage(directory, destination, manifest, artifact);
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
        action === "reconcile" &&
        release.version === manifest.version &&
        release.manifestSha256 === manifestSha256
      ),
  );
  const tar = `${destination}.tar`;
  if (existsSync(tar)) {
    if (
      action !== "reconcile" ||
      journal.transportSha256 !== hash(readFileSync(tar))
    )
      throw new Error(
        "A differing transport archive exists; inspect it before reconciliation.",
      );
  } else {
    execFileSync(
      "tar",
      ["-cf", tar, "-C", destination, ...Object.keys(staged)],
      {
        env: { ...environment(), COPYFILE_DISABLE: "1" },
      },
    );
  }
  journal.transportSha256 = hash(readFileSync(tar));
  assertReviewedRevision(values["reviewed-revision"]);
  saveJournal(
    journalPath,
    { ...journal, state: "pending", inspected: false },
    action === "publish",
  );
  let result = remote(action, journal.request, config, tar);
  await verifyPublicAvailability(manifest, artifact);
  if (journal.request.publicVerificationRequired)
    result = remote("complete", journal.request, config);
  saveJournal(journalPath, { ...journal, state: "complete", result });
  console.log(JSON.stringify(result));
}

export function verifyStagedRelease(
  destination,
  manifest,
  artifact,
  manifestSha256,
  qualificationSha256,
) {
  const expectedMetadata = metadata(manifest, artifact);
  const staged = inventory(destination);
  const expectedNames = [
    artifact.path,
    artifact.updater.path,
    artifact.updater.signaturePath,
    "manifest.json",
    ...publicInputFiles(manifest),
    ...Object.keys(expectedMetadata).map((name) => `metadata/${name}`),
  ].sort();
  if (
    JSON.stringify(Object.keys(staged).sort()) !== JSON.stringify(expectedNames)
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
