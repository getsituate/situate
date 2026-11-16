import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "./pipeline-state.mjs";
import { MAX_SOURCE_EVIDENCE_BYTES } from "./source-verification-evidence.mjs";

const repository = "getsituate/situate";
const repositoryURI = `https://github.com/${repository}`;
const issuer = "https://token.actions.githubusercontent.com";
const predicateType = "https://slsa.dev/provenance/v1";
const maxOutput = 2 * 1024 * 1024;
const maxAttestations = 5;
const sha = /^[a-f0-9]{40}$/;
const decimal = (value) => {
  assert(
    /^[1-9][0-9]{0,15}$/.test(String(value)) &&
      Number.isSafeInteger(Number(value)),
  );
  return String(value);
};
const executeDefault = (command, args, options) => {
  const result = spawnSync(command, args, options);
  assert(
    !result.error && result.status === 0,
    "Attestation verification failed",
  );
  return result.stdout;
};

/**
 * Only gh's successfully verified certificate extensions establish execution
 * identity. Workflow-authored predicate metadata is not an identity authority.
 * JSON field names follow gh 2.104.0 and sigstore-go's certificate.Summary.
 */
export function verifySourceVerificationAttestation(
  jsonBytes,
  {
    runId,
    runAttempt,
    pullNumber,
    environment = process.env,
    execute = executeDefault,
  } = {},
) {
  let directory;
  try {
    assert(
      Buffer.isBuffer(jsonBytes) &&
        jsonBytes.length > 0 &&
        jsonBytes.length <= MAX_SOURCE_EVIDENCE_BYTES,
    );
    runId = decimal(runId);
    runAttempt = decimal(runAttempt);
    pullNumber = decimal(pullNumber);
    const token = environment.GH_TOKEN ?? environment.GITHUB_TOKEN;
    assert(
      typeof token === "string" && token.length > 0 && !/[\r\n]/.test(token),
    );
    directory = mkdtempSync(join(tmpdir(), "situate-source-attestation-"));
    const stat = lstatSync(directory);
    assert(
      stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        stat.uid === process.getuid() &&
        (stat.mode & 0o077) === 0,
    );
    for (const name of ["config", "home", "cache"])
      mkdirSync(join(directory, name), { mode: 0o700 });
    const file = join(directory, "evidence.json");
    writeFileSync(file, jsonBytes, { mode: 0o600, flag: "wx" });
    const ref = `refs/pull/${pullNumber}/merge`;
    const signer = `${repository}/.github/workflows/verify.yml@${ref}`;
    const signerURI = `https://github.com/${signer}`;
    const invocationURI = `${repositoryURI}/actions/runs/${runId}/attempts/${runAttempt}`;
    const stdout = execute(
      "gh",
      [
        "attestation",
        "verify",
        file,
        "--repo",
        repository,
        "--hostname",
        "github.com",
        "--signer-workflow",
        signer,
        "--source-ref",
        ref,
        "--cert-oidc-issuer",
        issuer,
        "--deny-self-hosted-runners",
        "--predicate-type",
        predicateType,
        "--digest-alg",
        "sha256",
        "--limit",
        String(maxAttestations),
        "--format",
        "json",
      ],
      {
        cwd: directory,
        env: {
          PATH: environment.PATH,
          HOME: join(directory, "home"),
          TMPDIR: directory,
          XDG_CACHE_HOME: join(directory, "cache"),
          GH_CONFIG_DIR: join(directory, "config"),
          GH_TOKEN: token,
          GH_HOST: "github.com",
          GH_PROMPT_DISABLED: "1",
          GH_NO_UPDATE_NOTIFIER: "1",
          GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
        },
        encoding: "utf8",
        timeout: 25_000,
        maxBuffer: maxOutput,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    assert(
      typeof stdout === "string" && Buffer.byteLength(stdout) <= maxOutput,
    );
    const entries = JSON.parse(stdout);
    assert(
      Array.isArray(entries) &&
        entries.length > 0 &&
        entries.length <= maxAttestations,
    );
    const subjectDigest = digest(jsonBytes);
    const matches = [];
    for (const entry of entries) {
      try {
        const verified = entry.verificationResult;
        const certificate = verified.signature.certificate;
        assert.equal(certificate.issuer, issuer);
        assert.equal(certificate.subjectAlternativeName, signerURI);
        assert.equal(certificate.sourceRepositoryURI, repositoryURI);
        assert.equal(certificate.sourceRepositoryIdentifier, "1455575895");
        assert.equal(
          certificate.sourceRepositoryOwnerURI,
          "https://github.com/getsituate",
        );
        assert.equal(certificate.sourceRepositoryVisibilityAtSigning, "public");
        assert.equal(certificate.sourceRepositoryRef, ref);
        assert.equal(certificate.buildTrigger, "pull_request");
        assert.equal(certificate.runnerEnvironment, "github-hosted");
        assert.equal(certificate.runInvocationURI, invocationURI);
        assert.equal(certificate.buildConfigURI, signerURI);
        assert.equal(certificate.buildSignerURI, signerURI);
        assert(
          sha.test(certificate.sourceRepositoryDigest) &&
            sha.test(certificate.buildConfigDigest),
        );
        assert.equal(
          certificate.buildSignerDigest,
          certificate.buildConfigDigest,
        );
        assert(
          Array.isArray(verified.verifiedTimestamps) &&
            verified.verifiedTimestamps.length > 0 &&
            verified.verifiedTimestamps.length <= 10,
        );
        const statement = verified.statement;
        assert.equal(statement._type, "https://in-toto.io/Statement/v1");
        assert.equal(statement.predicateType, predicateType);
        assert(
          Array.isArray(statement.subject) && statement.subject.length === 1,
        );
        assert.equal(statement.subject[0].digest?.sha256, subjectDigest);
        matches.push({
          checkedSHA: certificate.sourceRepositoryDigest,
          workflowSHA: certificate.buildConfigDigest,
          subjectDigest,
          runId,
          runAttempt,
        });
      } catch {
        // Other verified attestations do not authorize this particular producer.
      }
    }
    assert.equal(matches.length, 1);
    return matches[0];
  } catch {
    return null;
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}
