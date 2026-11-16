import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { digest, validatePlan } from "./pipeline-state.mjs";
import { verifyReleaseInputs } from "./release-inputs.mjs";
import { validateReservation } from "./release-reservation.mjs";

export function checkpointGitHubWrites(adapter, persist) {
  const writes = new Set(["createDraft", "uploadAsset", "finalize"]);
  return Object.fromEntries(
    Object.entries(adapter).map(([name, invoke]) => [
      name,
      writes.has(name)
        ? async (...args) => {
            await persist();
            return invoke.apply(adapter, args);
          }
        : invoke.bind(adapter),
    ]),
  );
}

export const checkpointIdentity = (plan) => ({
  operationId: plan.operation,
  planDigest: plan.authorizationDigest,
  sourceRevision: plan.source,
});
export function checkpointFile(file) {
  for (let parent = resolve(dirname(file)); ; parent = dirname(parent)) {
    const stat = lstatSync(parent);
    assert(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "Checkpoint path traverses linked storage",
    );
    if (parent === dirname(parent)) break;
  }
  const fd = openSync(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    assert(
      stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid(),
      "Checkpoint payload must be an owned single-link regular file",
    );
    assert(stat.size <= 8 * 1024 * 1024, "Checkpoint metadata exceeds bound");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function checkpointFileHash(file) {
  checkpointFileParent(file);
  const fd = openSync(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    assert(
      stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid(),
      "Checkpoint payload must be an owned single-link regular file",
    );
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let size = 0;
    for (;;) {
      const count = readSync(fd, buffer);
      if (!count) break;
      size += count;
      assert(size <= 16 * 1024 ** 3, "Checkpoint exceeds size limit");
      hash.update(buffer.subarray(0, count));
    }
    return { size, sha256: hash.digest("hex") };
  } finally {
    closeSync(fd);
  }
}
export function checkpointPackages(manifest, { predecessor = false } = {}) {
  if (predecessor) {
    const artifact = manifest?.artifacts?.[0];
    assert(
      manifest.artifacts.length === 1,
      "Missing exact predecessor package inventory",
    );
    const items = [
      { name: artifact.path, sha256: artifact.sha256 },
      { name: artifact.updater?.path, sha256: artifact.updater?.sha256 },
      {
        name: artifact.updater?.signaturePath,
        sha256: artifact.updater?.signatureSha256,
      },
    ];
    for (const item of items)
      assert(
        /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(item.name ?? "") &&
          /^[a-f0-9]{64}$/.test(item.sha256 ?? ""),
        "Invalid predecessor package binding",
      );
    return items;
  }
  assert(
    manifest?.status === "complete" &&
      manifest.distribution === "direct" &&
      manifest.dirty === false &&
      manifest.artifacts?.length === 1,
    "Checkpoint requires complete final manifest",
  );
  const artifact = manifest.artifacts[0];
  assert(
    artifact.platform === "macos" &&
      artifact.architecture === "universal" &&
      artifact.notarized === true,
    "Checkpoint requires notarized universal packages",
  );
  const files = [
    { name: artifact.path, sha256: artifact.sha256 },
    { name: artifact.updater?.path, sha256: artifact.updater?.sha256 },
    {
      name: artifact.updater?.signaturePath,
      sha256: artifact.updater?.signatureSha256,
    },
    {
      name: manifest.releaseInputs?.path,
      sha256: manifest.releaseInputs?.sha256,
    },
    {
      name: manifest.releaseInputs?.catalogPath,
      sha256: manifest.releaseInputs?.catalogSha256,
    },
  ];
  for (const item of files)
    assert(
      /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(item.name ?? "") &&
        /^[a-f0-9]{64}$/.test(item.sha256 ?? ""),
      "Invalid checkpoint asset binding",
    );
  assert.equal(manifest.releaseInputs.path, "release-inputs.json");
  assert.equal(
    manifest.releaseInputs.catalogPath,
    "situate-release-history.json",
  );
  assert.equal(
    new Set([
      "plan.json",
      "configuration.json",
      "operation.json",
      "manifest.json",
      ...files.map((item) => item.name),
    ]).size,
    files.length + 4,
    "Duplicate checkpoint asset",
  );
  return files;
}
export function createCheckpoint({
  kind,
  operation,
  planBytes = `${JSON.stringify(operation.plan)}\n`,
  configurationBytes,
  directory,
  authorization,
}) {
  const plan = validatePlan(operation.plan);
  assert.deepEqual(JSON.parse(planBytes), plan, "Original plan bytes differ");
  assert.equal(
    digest(configurationBytes),
    plan.configurationDigest,
    "Checkpoint configuration differs from sealed plan",
  );
  const files = [
    { name: "plan.json", bytes: Buffer.from(planBytes) },
    { name: "configuration.json", bytes: Buffer.from(configurationBytes) },
    {
      name: "operation.json",
      bytes: Buffer.from(`${JSON.stringify(operation)}\n`),
    },
  ];
  if (kind === "build") {
    validateReservation(operation.reservation);
    assert.equal(operation.reservation.sourceRevision, plan.source);
    assert.equal(operation.reservation.operationId, plan.operation);
    const bytes = checkpointFile(join(directory, "manifest.json"));
    const manifest = JSON.parse(bytes);
    assert.equal(manifest.revision, plan.source, "Checkpoint source differs");
    assert.equal(
      manifest.version,
      operation.reservation?.version,
      "Checkpoint reservation version differs",
    );
    assert.equal(
      manifest.buildNumber,
      operation.reservation?.buildNumber,
      "Checkpoint reservation build differs",
    );
    files.push({ name: "manifest.json", bytes });
    for (const item of checkpointPackages(manifest)) {
      const value = checkpointFileHash(join(directory, item.name));
      assert.equal(
        value.sha256,
        item.sha256,
        "Checkpoint package hash differs",
      );
      files.push({
        name: item.name,
        file: join(directory, item.name),
        ...value,
      });
    }
    const inputs = JSON.parse(
      checkpointFile(join(directory, "release-inputs.json")),
    );
    assert(
      inputs.source === plan.source &&
        inputs.version === operation.reservation.version &&
        inputs.build === operation.reservation.buildNumber &&
        inputs.tag === operation.reservation.tag,
      "Generated input reservation binding differs",
    );
    verifyReleaseInputs(
      inputs,
      checkpointFile(join(directory, "situate-release-history.json")).toString(
        "utf8",
      ),
    );
    assert.equal(
      manifest.releaseInputs.sha256,
      operation.reservation.generatedInputDigest,
      "Checkpoint generated inputs differ from reservation",
    );
    const predecessor =
      JSON.parse(configurationBytes).qualification?.predecessor;
    assert(
      predecessor?.manifest && predecessor.directory,
      "Missing original predecessor inputs",
    );
    const predecessorBytes = checkpointFile(
      join(predecessor.directory, "manifest.json"),
    );
    assert.deepEqual(
      JSON.parse(predecessorBytes),
      predecessor.manifest,
      "Original predecessor manifest differs",
    );
    files.push({ name: "predecessor-manifest.json", bytes: predecessorBytes });
    for (const item of checkpointPackages(predecessor.manifest, {
      predecessor: true,
    })) {
      const file = join(predecessor.directory, item.name);
      const value = checkpointFileHash(file);
      assert.equal(value.sha256, item.sha256, "Predecessor asset differs");
      files.push({ name: `predecessor-${item.name}`, file, ...value });
    }
  } else if (kind === "runtime-authorization") {
    assert(authorization, "Missing runtime authorization");
    files.push({
      name: "runtime-authorization.json",
      bytes: Buffer.from(`${JSON.stringify(authorization)}\n`),
    });
  } else assert.equal(kind, "intent", "Unknown checkpoint kind");
  const descriptor = {
    schemaVersion: 1,
    checkpointId: randomUUID(),
    kind,
    identity: checkpointIdentity(plan),
    files: files.map((item) => ({
      name: item.name,
      size: item.bytes?.length ?? item.size,
      sha256: item.bytes ? digest(item.bytes) : item.sha256,
    })),
  };
  assert(
    descriptor.files.reduce((size, item) => size + item.size, 0) <=
      16 * 1024 ** 3,
    "Checkpoint exceeds size limit",
  );
  return { descriptor, files };
}
export function validateRestoredCheckpoint(descriptor, directory, plan) {
  assert.equal(descriptor.kind, "build");
  assert.deepEqual(descriptor.identity, checkpointIdentity(plan));
  for (const item of descriptor.files) {
    assert(
      /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(item.name),
      "Invalid checkpoint path",
    );
    const value = checkpointFileHash(join(directory, item.name));
    assert.equal(value.size, item.size, "Restored checkpoint size differs");
    assert.equal(value.sha256, item.sha256, "Restored checkpoint hash differs");
  }
  const original = JSON.parse(checkpointFile(join(directory, "plan.json")));
  validatePlan(original);
  assert.deepEqual(original, plan, "Restored plan differs");
  const configurationBytes = checkpointFile(
    join(directory, "configuration.json"),
  );
  assert.equal(
    digest(configurationBytes),
    plan.configurationDigest,
    "Restored configuration differs",
  );
  const operation = JSON.parse(
    checkpointFile(join(directory, "operation.json")),
  );
  assert.deepEqual(operation.plan, plan);
  validateReservation(operation.reservation);
  assert.equal(operation.reservation.sourceRevision, plan.source);
  assert.equal(operation.reservation.operationId, plan.operation);
  const manifest = JSON.parse(checkpointFile(join(directory, "manifest.json")));
  assert.equal(manifest.revision, plan.source);
  assert.equal(manifest.version, operation.reservation?.version);
  assert.equal(manifest.buildNumber, operation.reservation?.buildNumber);
  assert.equal(
    manifest.releaseInputs.sha256,
    operation.reservation?.generatedInputDigest,
  );
  const predecessorBytes = checkpointFile(
    join(directory, "predecessor-manifest.json"),
  );
  const predecessor = JSON.parse(predecessorBytes);
  assert.deepEqual(
    predecessor,
    JSON.parse(configurationBytes).qualification.predecessor.manifest,
  );
  const expectedNames = [
    "plan.json",
    "configuration.json",
    "operation.json",
    "manifest.json",
    ...checkpointPackages(manifest).map((item) => item.name),
    "predecessor-manifest.json",
    ...checkpointPackages(predecessor, { predecessor: true }).map(
      (item) => `predecessor-${item.name}`,
    ),
  ];
  assert.deepEqual(
    descriptor.files.map((item) => item.name),
    expectedNames,
    "Restored checkpoint inventory differs",
  );
  for (const [prefix, value] of [
    ["", manifest],
    ["predecessor-", predecessor],
  ]) {
    for (const item of checkpointPackages(value, {
      predecessor: Boolean(prefix),
    }))
      assert.equal(
        checkpointFileHash(join(directory, `${prefix}${item.name}`)).sha256,
        item.sha256,
        "Restored package identity differs",
      );
  }
  verifyReleaseInputs(
    JSON.parse(checkpointFile(join(directory, "release-inputs.json"))),
    checkpointFile(join(directory, "situate-release-history.json")).toString(
      "utf8",
    ),
  );
  return {
    operation,
    configurationBytes,
    manifestBytes: checkpointFile(join(directory, "manifest.json")),
  };
}
export function createRestoreDirectory(destination) {
  assert(
    isAbsolute(destination),
    "Restore requires an explicit absolute destination",
  );
  checkpointFileParent(destination);
  mkdirSync(destination, { mode: 0o700 });
  const parent = openSync(dirname(destination), "r");
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}
function checkpointFileParent(destination) {
  for (let parent = dirname(destination); ; parent = dirname(parent)) {
    const stat = lstatSync(parent);
    assert(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "Restore path traverses linked storage",
    );
    if (parent === dirname(parent)) break;
  }
}
export function writeRestoredFile(directory, item, bytes) {
  assert(
    /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(item.name),
    "Invalid checkpoint path",
  );
  assert.equal(bytes.length, item.size);
  assert.equal(digest(bytes), item.sha256, "Restored checkpoint hash differs");
  const fd = openSync(join(directory, item.name), "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
