import assert from "node:assert/strict";
import { isDeepStrictEqual, promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHostAllocatorLock } from "../infrastructure/releases/allocator.mjs";

const executeFile = promisify(execFile);

/** The build reader must verify both GitHub and host history, including legacy
 * CFBundleVersion values. Construction performs no network or credential reads.
 */
export function createGitReservationAdapter({
  root,
  remote = "origin",
  hostConfig,
  readVerifiedBuilds,
  withAllocatorLock,
  environment = process.env,
  executeGit,
}) {
  assert(
    typeof root === "string" &&
      typeof remote === "string" &&
      remote &&
      !remote.startsWith("-") &&
      !/[\r\n\0]/u.test(remote),
    "Invalid reservation Git target",
  );
  assert(
    typeof readVerifiedBuilds === "function",
    "A verified historical build reader is required",
  );
  const git = async (args, input) => {
    if (executeGit) return executeGit(args, input);
    const options = {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...environment,
        GIT_NO_LAZY_FETCH: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_COMMITTER_NAME: "Situate Release",
        GIT_COMMITTER_EMAIL: "release@getsituate.com",
      },
    };
    const commandArgs = environment.GH_TOKEN
      ? [
          "-c",
          "credential.helper=",
          "-c",
          "credential.helper=!gh auth git-credential",
          ...args,
        ]
      : args;
    if (input === undefined)
      return (await executeFile("git", commandArgs, options)).stdout;
    return new Promise((resolve, reject) => {
      const child = execFile("git", commandArgs, options, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      );
      child.stdin.on("error", reject);
      child.stdin.end(input);
    });
  };
  const verifyRepository = async () => {
    const fetch = (await git(["remote", "get-url", "--all", remote]))
      .trim()
      .split("\n");
    const push = (await git(["remote", "get-url", "--push", "--all", remote]))
      .trim()
      .split("\n");
    const allowed =
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)getsituate\/situate(?:\.git)?$/u;
    assert(
      fetch.length === 1 &&
        push.length === 1 &&
        fetch.every((url) => allowed.test(url)) &&
        push.every((url) => allowed.test(url)),
      "Release tag target must be exactly getsituate/situate with one verified push destination",
    );
  };
  const refs = async () => {
    const output = await git(["ls-remote", "--tags", "--refs", remote]);
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match =
          /^([a-f0-9]{40}(?:[a-f0-9]{24})?)\trefs\/tags\/(.+)$/u.exec(line);
        assert(match, "Invalid remote tag inventory");
        return { oid: match[1], name: match[2] };
      });
  };
  const readTag = async ({ oid, name }) => {
    await git(["fetch", "--no-tags", "--no-write-fetch-head", remote, oid]);
    const type = (await git(["cat-file", "-t", oid])).trim();
    if (type !== "tag") return { name, annotated: false, sourceRevision: oid };
    const text = await git(["cat-file", "tag", oid]);
    const boundary = text.indexOf("\n\n");
    assert(boundary > 0, "Malformed annotated tag object");
    const header = text.slice(0, boundary);
    const target = /^object ([a-f0-9]{40}(?:[a-f0-9]{24})?)$/mu.exec(
      header,
    )?.[1];
    const tagName = /^tag (.+)$/mu.exec(header)?.[1];
    assert(
      /^type commit$/mu.test(header) && target && tagName === name,
      "Release tag must point directly to a commit with the exact tag name",
    );
    return {
      name,
      annotated: true,
      sourceRevision: target,
      annotation: text.slice(boundary + 2),
    };
  };
  return {
    withAllocatorLock:
      withAllocatorLock ?? createHostAllocatorLock(hostConfig, { environment }),
    readInventory: async (lease) => {
      assert(
        typeof lease?.inventory === "function",
        "Build inventory requires the active allocator lease",
      );
      await verifyRepository();
      const before = await refs();
      const hostSnapshot = await lease.inventory();
      assert(
        hostSnapshot?.complete === true && Array.isArray(hostSnapshot.builds),
        "Host Apple build inventory is incomplete",
      );
      const historical = await readVerifiedBuilds({ lease, hostSnapshot });
      assert(
        historical?.complete === true && Array.isArray(historical.builds),
        "Historical Apple build inventory is incomplete",
      );
      const tags = [];
      for (const entry of before) {
        const version = entry.name.startsWith("v")
          ? entry.name.slice(1)
          : entry.name;
        if (!numericVersion.test(version) && !/^\d{4}\./u.test(version)) {
          tags.push({ name: entry.name });
          continue;
        }
        const tag = await readTag(entry);
        let reservation;
        if (tag.annotation) {
          let parsed;
          try {
            parsed = JSON.parse(tag.annotation);
          } catch {
            /* Historical annotations were free text. */
          }
          if (parsed?.kind === "situate-release-reservation")
            reservation = validateReservation(parsed);
        }
        if (numericVersion.test(version) && parts(version)[0] >= 1000)
          assert(
            reservation,
            "Calendar release tag has no valid reservation annotation",
          );
        tags.push({ ...tag, ...(reservation ? { reservation } : {}) });
      }
      assert(
        isDeepStrictEqual(await refs(), before),
        "Remote tags changed during inventory; inspect and retry allocation",
      );
      return {
        complete: true,
        tags,
        builds: [...hostSnapshot.builds, ...historical.builds],
      };
    },
    inspectTag: async (name) => {
      await verifyRepository();
      const found = (await refs()).find((entry) => entry.name === name);
      return found ? readTag(found) : null;
    },
    createAnnotatedTag: async ({ tag, sourceRevision, annotation, force }) => {
      assert(force === false, "Forced release tag creation is prohibited");
      await verifyRepository();
      const value = validateReservation(JSON.parse(annotation));
      assert(
        value.tag === tag && value.sourceRevision === sourceRevision,
        "Annotated tag request binding differs",
      );
      assert(
        (await git(["cat-file", "-t", sourceRevision])).trim() === "commit",
        "Source must be an existing commit",
      );
      const tagger = (await git(["var", "GIT_COMMITTER_IDENT"])).trim();
      const object = (
        await git(
          ["mktag"],
          `object ${sourceRevision}\ntype commit\ntag ${tag}\ntagger ${tagger}\n\n${annotation}`,
        )
      ).trim();
      await git(["push", "--porcelain", remote, `${object}:refs/tags/${tag}`]);
    },
  };
}

const digest = /^[a-f0-9]{64}$/u;
const revision = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const numericVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const reservationKeys =
  "buildNumber,buildSequence,fragmentDigest,generatedInputDigest,kind,operationId,schemaVersion,sourceRevision,tag,version";

function parts(version) {
  assert(
    typeof version === "string" && numericVersion.test(version),
    "Invalid release version",
  );
  const result = version.split(".").map(Number);
  assert(
    result.every(Number.isSafeInteger),
    "Release version exceeds integer limits",
  );
  return result;
}

function compare(a, b) {
  const left = parts(a),
    right = parts(b);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function appleBuildSequence(buildNumber) {
  assert(
    typeof buildNumber === "string" &&
      /^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,2}$/u.test(buildNumber),
    "Invalid Apple build number",
  );
  const [major, minor = 0, patch = 0] = buildNumber.split(".").map(Number);
  assert(
    major <= 9999 && minor <= 99 && patch <= 99,
    "Apple build number exceeds component limits",
  );
  return major * 10000 + minor * 100 + patch;
}

export function appleBuildNumber(sequence) {
  assert(
    Number.isSafeInteger(sequence) && sequence >= 10000 && sequence <= 99999999,
    "Apple build sequence exhausted or invalid",
  );
  return `${Math.floor(sequence / 10000)}.${Math.floor(sequence / 100) % 100}.${sequence % 100}`;
}

function validateRequest(request) {
  assert(
    request &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(request.operationId ?? ""),
    "Invalid reservation operation ID",
  );
  assert(
    revision.test(request.sourceRevision ?? ""),
    "An exact source revision is required",
  );
  assert(digest.test(request.fragmentDigest ?? ""), "Invalid fragment digest");
}

export function validateReservation(value) {
  validateRequest(value);
  assert(
    Object.keys(value).sort().join() === reservationKeys &&
      value.schemaVersion === 1 &&
      value.kind === "situate-release-reservation",
    "Invalid release reservation schema",
  );
  const [year, month, sequence] = parts(value.version);
  assert(
    year >= 1000 &&
      year <= 9999 &&
      month >= 1 &&
      month <= 12 &&
      sequence > 0 &&
      value.tag === `v${value.version}`,
    "Invalid CalVer reservation",
  );
  assert(
    value.buildNumber === appleBuildNumber(value.buildSequence),
    "Apple build identity differs",
  );
  assert(
    digest.test(value.generatedInputDigest ?? ""),
    "Invalid generated input digest",
  );
  return value;
}

export function reservationAnnotation(value) {
  validateReservation(value);
  return `${JSON.stringify(value)}\n`;
}

/** Inventory must include every tag/reservation and verified historical build value.
 * Read failures or incomplete pagination must not be represented as an empty inventory.
 */
function validateInventory(inventory) {
  assert(
    inventory?.complete === true &&
      Array.isArray(inventory.tags) &&
      Array.isArray(inventory.builds),
    "A complete release inventory is required",
  );
  let maximumBuild = 9999;
  const versions = [];
  const seen = new Set(),
    operations = new Set(),
    sequences = new Set();
  for (const entry of inventory.tags) {
    assert(
      typeof entry?.name === "string" && !seen.has(entry.name),
      "Duplicate or invalid inventory tag",
    );
    seen.add(entry.name);
    if (entry.reservation !== undefined) {
      const value = validateReservation(entry.reservation);
      assert(
        entry.name === value.tag &&
          entry.annotated === true &&
          entry.sourceRevision === value.sourceRevision,
        "Reservation tag binding differs",
      );
      assert(
        !operations.has(value.operationId) &&
          !sequences.has(value.buildSequence),
        "Duplicate reservation operation or build sequence",
      );
      operations.add(value.operationId);
      sequences.add(value.buildSequence);
      maximumBuild = Math.max(maximumBuild, value.buildSequence);
    }
    const name = entry.name.startsWith("v") ? entry.name.slice(1) : entry.name;
    if (!numericVersion.test(name)) {
      assert(!/^v?\d{4}\./u.test(entry.name), "Malformed calendar release tag");
      continue;
    }
    const [year, month, sequence] = parts(name);
    if (year >= 1000)
      assert(
        year <= 9999 && month >= 1 && month <= 12 && sequence > 0,
        "Malformed calendar release tag",
      );
    versions.push(name);
  }
  for (const build of inventory.builds)
    maximumBuild = Math.max(maximumBuild, appleBuildSequence(build));
  return { versions, maximumBuild };
}

export function allocateReleaseIdentity(inventory, now = new Date()) {
  const { versions, maximumBuild } = validateInventory(inventory);
  assert(
    now instanceof Date && Number.isFinite(now.getTime()),
    "Invalid allocation clock",
  );
  const year = now.getUTCFullYear(),
    month = now.getUTCMonth() + 1;
  assert(
    year >= 1000 && year <= 9999,
    "Allocation year is outside supported limits",
  );
  let next = 1;
  for (const name of versions) {
    const [tagYear, tagMonth, tagSequence] = parts(name);
    assert(
      compare(name, `${year}.${month}.${Number.MAX_SAFE_INTEGER}`) <= 0,
      "Allocation clock regressed behind an existing release",
    );
    if (tagYear === year && tagMonth === month) {
      assert(
        tagSequence < Number.MAX_SAFE_INTEGER,
        "Monthly release sequence exhausted",
      );
      next = Math.max(next, tagSequence + 1);
    }
  }
  const version = `${year}.${month}.${next}`,
    buildSequence = maximumBuild + 1;
  return {
    version,
    tag: `v${version}`,
    buildSequence,
    buildNumber: appleBuildNumber(buildSequence),
  };
}

function matchingRequest(value, request) {
  assert(
    value.operationId === request.operationId &&
      value.sourceRevision === request.sourceRevision &&
      value.fragmentDigest === request.fragmentDigest,
    "Reservation operation binding differs",
  );
}

async function verifyInputs(value, prepareInputs) {
  const { version, tag, buildSequence, buildNumber } = value;
  const result = await prepareInputs({
    version,
    tag,
    buildSequence,
    buildNumber,
  });
  assert(
    digest.test(result?.generatedInputDigest ?? ""),
    "Invalid generated input digest",
  );
  if (result.fragmentDigest !== undefined && value.fragmentDigest !== undefined)
    assert.equal(
      result.fragmentDigest,
      value.fragmentDigest,
      "Generated fragment digest differs",
    );
  if (value.generatedInputDigest)
    assert.equal(
      result.generatedInputDigest,
      value.generatedInputDigest,
      "Generated inputs differ from immutable reservation",
    );
  return result.generatedInputDigest;
}

async function inspectExact(adapter, value) {
  const tag = await adapter.inspectTag(value.tag);
  if (tag === null) return { status: "absent", reservation: value };
  assert(
    tag?.annotated === true && tag.sourceRevision === value.sourceRevision,
    "Reserved tag must be annotated and target the exact source commit",
  );
  const actual = validateReservation(JSON.parse(tag.annotation));
  assert(isDeepStrictEqual(actual, value), "Reserved tag annotation differs");
  return { status: "reserved", reservation: value };
}

/** Adapters share a host-wide lock. The lease provides pending(), saveIntent(value),
 * clearIntent(value), and assertHeld(); save/clear must be durable and exact-match.
 * createAnnotatedTag receives {tag, sourceRevision, annotation, force:false} and
 * must create only when absent, never move a ref. inspectTag returns null only
 * for authoritative absence, otherwise {annotated, sourceRevision, annotation}.
 */
export async function reserveRelease(request, adapter) {
  validateRequest(request);
  return adapter.withAllocatorLock(async (lease) => {
    const pending = await lease.pending();
    assert(
      pending === null,
      "An unresolved reservation requires inspection and explicit reconciliation",
    );
    const inventory = await adapter.readInventory(lease);
    // Validation precedes lookup so a truncated inventory cannot authorize reuse.
    validateInventory(inventory);
    const existing = inventory.tags.find(
      (entry) => entry.reservation?.operationId === request.operationId,
    )?.reservation;
    if (existing) {
      matchingRequest(existing, request);
      await verifyInputs(existing, request.prepareInputs);
      return inspectExact(adapter, existing);
    }
    const identity = allocateReleaseIdentity(
      inventory,
      request.now ?? new Date(),
    );
    const generatedInputDigest = await verifyInputs(
      { ...identity, fragmentDigest: request.fragmentDigest },
      request.prepareInputs,
    );
    const value = validateReservation({
      schemaVersion: 1,
      kind: "situate-release-reservation",
      operationId: request.operationId,
      sourceRevision: request.sourceRevision,
      ...identity,
      fragmentDigest: request.fragmentDigest,
      generatedInputDigest,
    });
    await lease.saveIntent(value);
    await lease.assertHeld();
    try {
      await adapter.createAnnotatedTag({
        tag: value.tag,
        sourceRevision: value.sourceRevision,
        annotation: reservationAnnotation(value),
        force: false,
      });
      const result = await inspectExact(adapter, value);
      assert(result.status === "reserved", "Tag creation outcome is unknown");
      await lease.clearIntent(value);
      return result;
    } catch {
      // A lost response is not authoritative absence and cannot free the slot.
      return { status: "unknown", reservation: value };
    }
  });
}

export async function inspectReservation(value, adapter) {
  validateReservation(value);
  return adapter.withAllocatorLock(async (lease) => {
    const pending = await lease.pending();
    if (pending !== null)
      assert(
        isDeepStrictEqual(pending, value),
        "A different reservation is unresolved",
      );
    return inspectExact(adapter, value);
  });
}

/** An explicit retry may recreate only the same absent tag and immutable binding,
 * after inspection under the shared lock. It cannot allocate a replacement.
 */
export async function reconcileReservation(
  value,
  adapter,
  { retryAbsent = false } = {},
) {
  validateReservation(value);
  return adapter.withAllocatorLock(async (lease) => {
    const pending = await lease.pending();
    if (pending !== null)
      assert(
        isDeepStrictEqual(pending, value),
        "A different reservation is unresolved",
      );
    let result = await inspectExact(adapter, value);
    if (result.status === "absent" && retryAbsent) {
      assert(
        pending !== null,
        "Retry requires the original durable reservation intent",
      );
      await lease.assertHeld();
      try {
        await adapter.createAnnotatedTag({
          tag: value.tag,
          sourceRevision: value.sourceRevision,
          annotation: reservationAnnotation(value),
          force: false,
        });
        result = await inspectExact(adapter, value);
        if (result.status !== "reserved")
          return { status: "unknown", reservation: value };
      } catch {
        return { status: "unknown", reservation: value };
      }
    }
    if (result.status === "reserved" && pending !== null)
      await lease.clearIntent(value);
    return result;
  });
}
