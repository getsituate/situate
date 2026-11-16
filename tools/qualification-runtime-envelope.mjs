import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

const maximum = 2 * 1024 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function writeQualificationRuntimeEnvelope(
  file,
  { plan, runtimeAuthorization, inspection, recoveryAuthorization },
) {
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      plan,
      runtimeAuthorization,
      inspection,
      recoveryAuthorization,
    }),
  );
  assert(
    bytes.length <= maximum,
    "Qualification runtime authorization exceeds its size limit",
  );
  writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  return hash(bytes);
}

export async function readQualificationRuntimeEnvelope(
  file,
  expected,
  { configuration, configurationBytes, manifestBytes, validate } = {},
) {
  assert(
    /^[a-f0-9]{64}$/.test(expected ?? ""),
    "Missing qualification runtime authorization identity",
  );
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const stat = fstatSync(fd);
    assert(
      stat.isFile() &&
        stat.nlink === 1 &&
        stat.uid === process.getuid() &&
        (stat.mode & 0o777) === 0o600 &&
        stat.size <= maximum,
      "Qualification runtime authorization must be an owned private regular file",
    );
    bytes = readFileSync(fd);
    assert(
      bytes.length === stat.size && hash(bytes) === expected,
      "Qualification runtime authorization bytes differ",
    );
  } finally {
    closeSync(fd);
  }
  let envelope;
  try {
    envelope = JSON.parse(bytes);
  } catch {
    throw new Error("Qualification runtime authorization is not valid JSON");
  }
  assert(
    envelope?.schemaVersion === 1 &&
      Object.keys(envelope).sort().join() ===
        "inspection,plan,recoveryAuthorization,runtimeAuthorization,schemaVersion",
    "Invalid qualification runtime authorization envelope",
  );
  try {
    validate ??= (await import("./release-runtime-authorization.mjs"))
      .validateQualificationRuntimeAuthorization;
    const qualificationRuntime = validate(envelope.runtimeAuthorization, {
      plan: envelope.plan,
      configuration,
      configurationBytes,
      manifestBytes,
      inspection: envelope.inspection,
      recoveryAuthorization: envelope.recoveryAuthorization,
    });
    return {
      qualificationRuntime,
      runtimeAuthorizationDigest:
        envelope.runtimeAuthorization.authorizationDigest,
    };
  } catch (cause) {
    throw new Error("Qualification runtime authorization validation failed", {
      cause,
    });
  }
}
