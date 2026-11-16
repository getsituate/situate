import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { digest } from "./pipeline-state.mjs";
import { verifySourceVerificationAttestation } from "./source-verification-attestation.mjs";

const sourceSHA = "a".repeat(40);
const workflowSHA = "b".repeat(40);
const bytes = Buffer.from('{"testedSHA":"untrusted-artifact-claim"}\n');
const signerURI =
  "https://github.com/getsituate/situate/.github/workflows/verify.yml@refs/pull/31/merge";

function verifiedEntry() {
  return {
    attestation: { bundle: {} },
    verificationResult: {
      signature: {
        certificate: {
          issuer: "https://token.actions.githubusercontent.com",
          subjectAlternativeName: signerURI,
          sourceRepositoryURI: "https://github.com/getsituate/situate",
          sourceRepositoryIdentifier: "1455575895",
          sourceRepositoryOwnerURI: "https://github.com/getsituate",
          sourceRepositoryVisibilityAtSigning: "public",
          sourceRepositoryRef: "refs/pull/31/merge",
          sourceRepositoryDigest: sourceSHA,
          buildConfigURI: signerURI,
          buildConfigDigest: workflowSHA,
          buildSignerURI: signerURI,
          buildSignerDigest: workflowSHA,
          buildTrigger: "pull_request",
          runnerEnvironment: "github-hosted",
          runInvocationURI:
            "https://github.com/getsituate/situate/actions/runs/123/attempts/2",
        },
      },
      verifiedTimestamps: [
        {
          type: "tlog",
          uri: "https://rekor.sigstore.dev",
          timestamp: "2026-01-01T00:00:00Z",
        },
      ],
      statement: {
        _type: "https://in-toto.io/Statement/v1",
        subject: [{ name: "evidence.json", digest: { sha256: digest(bytes) } }],
        predicateType: "https://slsa.dev/provenance/v1",
        predicate: {
          sourceRepositoryDigest: "workflow-authored-claim-is-not-authority",
        },
      },
    },
  };
}

function options(execute) {
  return {
    runId: 123,
    runAttempt: 2,
    pullNumber: 31,
    environment: {
      GH_TOKEN: "synthetic-read-only-token",
      PATH: process.env.PATH,
      HOME: "/synthetic-private-home",
      GH_CONFIG_DIR: "/synthetic-private-config",
      GH_ENTERPRISE_TOKEN: "synthetic-other-credential",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-oidc-credential",
      NODE_OPTIONS: "synthetic-untrusted-options",
    },
    execute,
  };
}

test("official gh receives exact raw bytes and isolated credentials; identity comes from verified certificate", () => {
  let directory;
  let calls = 0;
  const input = options((command, args, config) => {
    calls++;
    directory = config.cwd;
    assert.equal(command, "gh");
    assert.deepEqual(args, [
      "attestation",
      "verify",
      join(directory, "evidence.json"),
      "--repo",
      "getsituate/situate",
      "--hostname",
      "github.com",
      "--signer-workflow",
      "getsituate/situate/.github/workflows/verify.yml@refs/pull/31/merge",
      "--source-ref",
      "refs/pull/31/merge",
      "--cert-oidc-issuer",
      "https://token.actions.githubusercontent.com",
      "--deny-self-hosted-runners",
      "--predicate-type",
      "https://slsa.dev/provenance/v1",
      "--digest-alg",
      "sha256",
      "--limit",
      "5",
      "--format",
      "json",
    ]);
    assert.deepEqual(readFileSync(args[2]), bytes);
    assert.equal(statSync(args[2]).mode & 0o777, 0o600);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(config.env.GH_CONFIG_DIR).mode & 0o777, 0o700);
    assert.equal(config.env.GH_TOKEN, "synthetic-read-only-token");
    assert.equal(config.env.HOME, join(directory, "home"));
    assert.equal(config.env.GH_HOST, "github.com");
    for (const key of [
      "GH_ENTERPRISE_TOKEN",
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
      "NODE_OPTIONS",
      "GITHUB_TOKEN",
    ])
      assert.equal(config.env[key], undefined);
    assert.equal(config.timeout, 25_000);
    assert.equal(config.maxBuffer, 2 * 1024 * 1024);
    assert.deepEqual(config.stdio, ["ignore", "pipe", "pipe"]);
    return JSON.stringify([verifiedEntry()]);
  });
  assert.deepEqual(verifySourceVerificationAttestation(bytes, input), {
    checkedSHA: sourceSHA,
    workflowSHA,
    subjectDigest: digest(bytes),
    runId: "123",
    runAttempt: "2",
  });
  assert.equal(calls, 1);
  assert(!existsSync(directory));
});

test("wrong certificate identity/context cannot borrow workflow-authored provenance claims", () => {
  for (const patch of [
    { issuer: "https://example.org" },
    { subjectAlternativeName: signerURI.replace("verify.yml", "evil.yml") },
    { sourceRepositoryURI: "https://github.com/other/project" },
    { sourceRepositoryIdentifier: "1" },
    { sourceRepositoryOwnerURI: "https://github.com/other" },
    { sourceRepositoryVisibilityAtSigning: "private" },
    { sourceRepositoryRef: "refs/pull/31/head" },
    { sourceRepositoryDigest: "not-a-commit" },
    { buildConfigURI: signerURI.replace("verify.yml", "evil.yml") },
    { buildConfigDigest: "not-a-commit" },
    { buildSignerDigest: sourceSHA },
    { buildSignerURI: signerURI.replace("verify.yml", "evil.yml") },
    { buildTrigger: "push" },
    { runnerEnvironment: "self-hosted" },
    {
      runInvocationURI:
        "https://github.com/getsituate/situate/actions/runs/123/attempts/1",
    },
    {
      runInvocationURI:
        "https://github.com/getsituate/situate/actions/runs/999/attempts/2",
    },
  ]) {
    const entry = verifiedEntry();
    Object.assign(entry.verificationResult.signature.certificate, patch);
    assert.equal(
      verifySourceVerificationAttestation(
        bytes,
        options(() => JSON.stringify([entry])),
      ),
      null,
      JSON.stringify(patch),
    );
  }
});

test("raw member changes cannot reuse an attestation for canonically equal JSON", () => {
  const entry = verifiedEntry();
  const changed = Buffer.from(JSON.stringify(JSON.parse(bytes)));
  assert.notDeepEqual(changed, bytes);
  assert.deepEqual(JSON.parse(changed), JSON.parse(bytes));
  assert.equal(
    verifySourceVerificationAttestation(
      changed,
      options(() => JSON.stringify([entry])),
    ),
    null,
  );
  for (const mutate of [
    (v) => {
      v.verificationResult.verifiedTimestamps = [];
    },
    (v) => {
      v.verificationResult.statement.predicateType =
        "https://example.org/custom";
    },
    (v) => {
      v.verificationResult.statement.subject.push(
        v.verificationResult.statement.subject[0],
      );
    },
    (v) => {
      delete v.verificationResult.signature;
    },
  ]) {
    const changedEntry = verifiedEntry();
    mutate(changedEntry);
    assert.equal(
      verifySourceVerificationAttestation(
        bytes,
        options(() => JSON.stringify([changedEntry])),
      ),
      null,
    );
  }
});

test("missing, failed, oversized, ambiguous or unavailable verification is a miss and cleans temporary storage", () => {
  let directory;
  assert.equal(
    verifySourceVerificationAttestation(
      bytes,
      options((_command, _args, config) => {
        directory = config.cwd;
        throw new Error("No attestations or gh unavailable");
      }),
    ),
    null,
  );
  assert(!existsSync(directory));
  for (const stdout of [
    "not JSON",
    "[]",
    " ".repeat(2 * 1024 * 1024 + 1),
    JSON.stringify([verifiedEntry(), verifiedEntry()]),
  ])
    assert.equal(
      verifySourceVerificationAttestation(
        bytes,
        options(() => stdout),
      ),
      null,
    );
  const missingToken = options(() =>
    assert.fail("Missing credentials must not read cached authentication"),
  );
  missingToken.environment = {};
  assert.equal(verifySourceVerificationAttestation(bytes, missingToken), null);
  assert.equal(
    verifySourceVerificationAttestation(
      Buffer.alloc(256 * 1024 + 1),
      options(() => assert.fail()),
    ),
    null,
  );
});
