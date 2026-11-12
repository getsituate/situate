import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  createReadStream,
  lstatSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

export const image = "ghcr.io/getsituate/situate-ci-linux";
export const maxArchiveBytes = 8 * 1024 ** 3;
export const maxExpandedArchiveBytes = 12 * 1024 ** 3;
const hex = /^[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const runPattern = /^[1-9][0-9]{0,19}$/;

export function context(env = process.env) {
  if (
    env.GITHUB_REPOSITORY !== "getsituate/situate" ||
    !runPattern.test(env.GITHUB_REPOSITORY_ID ?? "") ||
    !runPattern.test(env.GITHUB_RUN_ID ?? "") ||
    !runPattern.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
    !revisionPattern.test(env.WORKFLOW_SHA ?? "") ||
    env.GITHUB_REF !== "refs/heads/main" ||
    !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)
  )
    throw new Error(
      "Publication requires a main-branch run in getsituate/situate.",
    );
  return {
    repository: env.GITHUB_REPOSITORY,
    repositoryId: env.GITHUB_REPOSITORY_ID,
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    workflowSha: env.WORKFLOW_SHA,
    localTag: `situate-ci-build:${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    publishTag: `${image}:build-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
  };
}

export function candidateRevision(requested, fallback) {
  const revision = requested || fallback;
  if (!revisionPattern.test(revision ?? ""))
    throw new Error(
      "The candidate revision must be a lowercase 40-character commit SHA.",
    );
  return revision;
}

export function validateProvenance(value, expected) {
  if (
    !value ||
    value.version !== 1 ||
    Object.entries(expected).some(([key, entry]) => value[key] !== entry) ||
    !revisionPattern.test(value.revision ?? "") ||
    !hex.test(value.inputsSha256 ?? "") ||
    !hex.test(value.archiveSha256 ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(value.imageId ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(value.configDigest ?? "") ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > maxArchiveBytes
  )
    throw new Error("Invalid image provenance.");
  return value;
}

export function validateExpandedArchiveSize(bytes) {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > maxExpandedArchiveBytes
  )
    throw new Error("Expanded image archive exceeds 12 GiB.");
}

export async function archiveDigest(directory) {
  if (JSON.stringify(readdirSync(directory).sort()) !== '["image.tar"]')
    throw new Error("The artifact must contain only image.tar.");
  const file = join(directory, "image.tar");
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > maxArchiveBytes)
    throw new Error("Image archive must be a regular file of at most 8 GiB.");
  const hash = createHash("sha256");
  let bytes = 0;
  let gzip = false;
  for await (const chunk of createReadStream(file)) {
    if (bytes === 0) gzip = chunk[0] === 0x1f && chunk[1] === 0x8b;
    bytes += chunk.length;
    if (bytes > maxArchiveBytes)
      throw new Error("Image archive exceeds 8 GiB.");
    hash.update(chunk);
  }
  if (bytes !== stat.size)
    throw new Error("Image archive changed while reading.");
  if (gzip) {
    let expandedBytes = 0;
    const source = createReadStream(file);
    const expanded = source.pipe(createGunzip());
    source.on("error", (error) => expanded.destroy(error));
    try {
      for await (const chunk of expanded) {
        expandedBytes += chunk.length;
        validateExpandedArchiveSize(expandedBytes);
      }
    } finally {
      source.destroy();
      expanded.destroy();
    }
  }
  return { bytes, archiveSha256: hash.digest("hex") };
}

export function validateArchiveManifest(manifest, provenance) {
  if (!Array.isArray(manifest) || manifest.length !== 1)
    throw new Error("Archive must contain exactly one image.");
  const entry = manifest[0];
  const digest = provenance.configDigest.slice(7);
  if (
    JSON.stringify(entry.RepoTags) !== JSON.stringify([provenance.localTag]) ||
    ![`${digest}.json`, `blobs/sha256/${digest}`].includes(entry.Config) ||
    !Array.isArray(entry.Layers) ||
    !entry.Layers.length ||
    entry.Layers.some(
      (path) =>
        typeof path !== "string" ||
        !/^(?:[a-f0-9]{64}\/layer\.tar|blobs\/sha256\/[a-f0-9]{64})$/.test(
          path,
        ),
    )
  )
    throw new Error("Archive tag, image ID or layers do not match provenance.");
}

export function imageConfigDigest(inspected) {
  const descriptor = inspected?.Descriptor;
  if (!descriptor) return inspected?.Id;
  if (
    ![
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
    ].includes(descriptor.mediaType)
  )
    throw new Error(
      "Expected a single-platform image manifest, not an image index.",
    );
  const digest = descriptor.annotations?.["config.digest"];
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest ?? ""))
    throw new Error("Docker did not report the image configuration digest.");
  return digest;
}

export function validateImage(inspected, provenance) {
  const labels = inspected?.Config?.Labels;
  if (
    inspected?.Id !== provenance.imageId ||
    imageConfigDigest(inspected) !== provenance.configDigest ||
    inspected.Os !== "linux" ||
    inspected.Architecture !== "amd64" ||
    !inspected.RepoTags?.includes(provenance.localTag) ||
    labels?.["org.opencontainers.image.source"] !==
      `https://github.com/${provenance.repository}` ||
    labels?.["org.opencontainers.image.revision"] !== provenance.revision
  )
    throw new Error("Loaded image does not match the Linux build provenance.");
}

export function validatePackage(pkg, expected, visibility = "public") {
  if (
    pkg?.name !== "situate-ci-linux" ||
    pkg.package_type !== "container" ||
    pkg.visibility !== visibility ||
    pkg.repository?.full_name !== expected.repository ||
    String(pkg.repository?.id) !== expected.repositoryId
  )
    throw new Error(
      `GHCR package must be ${visibility} and linked to the exact current repository.`,
    );
}

export function validateArtifactResponse(response, name) {
  const matches = response.artifacts?.filter(
    (artifact) => artifact.name === name,
  );
  if (
    !Number.isSafeInteger(response.total_count) ||
    response.total_count < 1 ||
    response.total_count > 100 ||
    response.total_count !== response.artifacts?.length ||
    matches?.length !== 1 ||
    matches[0].expired !== false ||
    !Number.isSafeInteger(matches[0].size_in_bytes) ||
    matches[0].size_in_bytes < 1 ||
    matches[0].size_in_bytes > maxArchiveBytes
  )
    throw new Error(
      "Expected one nonexpired same-run image artifact of at most 8 GiB.",
    );
}

const docker = (args, options = {}) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30 * 60 * 1000,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
const inspect = (tag) => JSON.parse(docker(["image", "inspect", tag]))[0];

async function api(path, allowMissing = false) {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is required.");
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok)
    throw new Error(`GitHub API returned HTTP ${response.status}.`);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024)
      throw new Error("GitHub API response is too large.");
    chunks.push(chunk);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!data || typeof data !== "object")
    throw new Error("Invalid GitHub API response.");
  return data;
}
const packagePath = "/orgs/getsituate/packages/container/situate-ci-linux";

export async function main(args = process.argv.slice(2)) {
  const [command, directory] = args;
  const expected = context();
  if (command === "revision") {
    console.log(
      candidateRevision(process.env.REQUESTED_REVISION, process.env.GITHUB_SHA),
    );
    return;
  }
  if (command === "artifact") {
    validateArtifactResponse(
      await api(
        `/repos/${expected.repository}/actions/runs/${expected.runId}/artifacts?per_page=100`,
      ),
      `ci-image-${expected.runId}-${expected.attempt}`,
    );
    return;
  }
  if (command === "seal") {
    const revision = candidateRevision(process.env.SOURCE_REVISION);
    const inspected = inspect(expected.localTag);
    const provenance = validateProvenance(
      {
        version: 1,
        ...expected,
        revision,
        inputsSha256: process.env.INPUTS_SHA256,
        imageId: inspected.Id,
        configDigest: imageConfigDigest(inspected),
        ...(await archiveDigest(directory)),
      },
      expected,
    );
    validateImage(inspected, provenance);
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `provenance=${JSON.stringify(provenance)}\n`,
    );
    return;
  }
  const bootstrap = command === "bootstrap";
  if (command !== "publish" && !bootstrap)
    throw new Error("Choose revision, artifact, seal, bootstrap or publish.");
  if (bootstrap && process.env.GITHUB_EVENT_NAME !== "workflow_dispatch")
    throw new Error("Bootstrap requires an explicitly reviewed manual run.");
  const raw = process.env.PROVENANCE ?? "";
  if (raw.length > 8192) throw new Error("Image provenance is too large.");
  const provenance = validateProvenance(JSON.parse(raw), expected);
  const archive = await archiveDigest(directory);
  if (
    archive.bytes !== provenance.bytes ||
    archive.archiveSha256 !== provenance.archiveSha256
  )
    throw new Error("Image archive checksum or size differs from the build.");
  const manifest = JSON.parse(
    execFileSync(
      "tar",
      ["-xOf", join(directory, "image.tar"), "manifest.json"],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: 60000,
      },
    ),
  );
  validateArchiveManifest(manifest, provenance);
  const existing = await api(packagePath, true);
  if (bootstrap) {
    if (existing) throw new Error("Bootstrap requires an absent GHCR package.");
  } else {
    if (!existing)
      throw new Error(
        "GHCR package is absent; use a reviewed manual bootstrap.",
      );
    validatePackage(existing, expected);
  }
  const username = process.env.GITHUB_ACTOR;
  if (!username)
    throw new Error("GITHUB_ACTOR is required for registry login.");
  docker(["load", "--input", join(directory, "image.tar")]);
  validateImage(inspect(expected.localTag), provenance);
  docker(["tag", provenance.imageId, expected.publishTag]);
  docker(["login", "ghcr.io", "--username", username, "--password-stdin"], {
    input: process.env.GH_TOKEN,
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    docker(["push", expected.publishTag]);
    validatePackage(
      await api(packagePath),
      expected,
      bootstrap ? "private" : "public",
    );
    if (bootstrap) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Linux CI image bootstrap\n\nCreated the private package linked to \`${expected.repository}\` (repository ID \`${expected.repositoryId}\`). Review the retained source inventories and distribution rights, then explicitly make the package public. Run normal publication and verify anonymous digest access before pinning.\n\n- Tag: \`${expected.publishTag}\`\n- Revision: \`${provenance.revision}\`\n- Inputs SHA-256: \`${provenance.inputsSha256}\`\n`,
      );
      return;
    }
    const digest = inspect(expected.publishTag).RepoDigests?.find((value) =>
      value.startsWith(`${image}@sha256:`),
    );
    if (
      !digest ||
      !new RegExp(`^${image.replaceAll(".", "\\.")}@sha256:[a-f0-9]{64}$`).test(
        digest,
      )
    )
      throw new Error("The pushed image digest is unavailable.");
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Public Linux CI image\n\n- Image: \`${digest}\`\n- Tag: \`${expected.publishTag}\`\n- Revision: \`${provenance.revision}\`\n- Inputs SHA-256: \`${provenance.inputsSha256}\`\n\nPin the image digest and input hash through a reviewed pull request.\n`,
    );
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `digest=${digest}\ninputsSha256=${provenance.inputsSha256}\nrevision=${provenance.revision}\n`,
    );
  } finally {
    docker(["logout", "ghcr.io"]);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
