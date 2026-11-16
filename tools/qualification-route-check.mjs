import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createQualificationHost,
  withQualificationRoute,
} from "../infrastructure/releases/qualification-host.mjs";
import { run } from "../client/scripts/ios-xcode.mjs";
import { readConfiguration } from "./pipeline-operations.mjs";
import {
  automaticQualification,
  qualificationEnvironment,
} from "./release-runtime.mjs";
import { releaseEnvironment, withReleaseSSH } from "./release-environment.mjs";
import { coordinated, runCoordinated } from "./run-coordinated.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export function routeCheckEnvironment(environment) {
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "USER",
      "LOGNAME",
      "LANG",
      "LC_ALL",
      "CI",
      "GITHUB_ACTIONS",
      "RUNNER_ENVIRONMENT",
      "SITUATE_COORDINATED_WORKTREE",
      "SITUATE_RELEASE_CONFIG_JSON",
      "SITUATE_RELEASE_CONFIG_SHA256",
      "SITUATE_UPDATER_ENDPOINT",
      "WEBSITE_DEPLOY_HOST",
      "SITUATE_RELEASE_SSH_PRIVATE_KEY",
      "SITUATE_RELEASE_SSH_KNOWN_HOSTS",
    ]
      .filter((name) => Object.hasOwn(environment, name))
      .map((name) => [name, environment[name]]),
  );
}

// This child receives only public expected hashes and a credential-free environment.
export const workerProgram = `
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const expected = JSON.parse(process.argv[1]);
let phase = 'routing';
try {
  const { createQualificationRouting } = await import(expected.module);
  await createQualificationRouting(expected.routing, {
    environment: process.env, signal: AbortSignal.timeout(45000),
  }).inspect();
  phase = 'feed-https';
  const data = execFileSync('/usr/bin/curl', [
    '--silent', '--show-error', '--fail', '--max-time', '15', '--noproxy', '*',
    expected.routing.endpoint,
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, maxBuffer: 1048576 });
  assert.equal(createHash('sha256').update(data).digest('hex'), expected.feedSha256);
  console.log(JSON.stringify({ status: 'passed', phase: 'complete' }));
} catch {
  console.log(JSON.stringify({ status: 'failed', phase }));
}
`;

export async function checkQualificationRoute({
  directory = root,
  environment = process.env,
  platform = process.platform,
  fetchPublic = fetch,
  resolvePublic = lookup,
  prepareSSH = withReleaseSSH,
  createHost = createQualificationHost,
  withRoute = withQualificationRoute,
  execute = run,
  signal,
} = {}) {
  assert(
    platform === "darwin" &&
      environment.CI === "true" &&
      environment.GITHUB_ACTIONS === "true" &&
      environment.RUNNER_ENVIRONMENT === "github-hosted",
    "Qualification route diagnostics require a disposable GitHub-hosted macOS runner.",
  );
  let phase = "configuration";
  const operation = { operationNonce: `route-probe-${randomUUID()}` };
  let diagnostic;
  let cleanup = "not-needed";
  let failed = false;
  const temporary = mkdtempSync(join(tmpdir(), "situate-route-check-"));
  try {
    const record = readConfiguration(directory, undefined, { environment });
    assert(record?.sha256 === environment.SITUATE_RELEASE_CONFIG_SHA256);
    assert(automaticQualification(record.configuration));
    const tls = record.configuration.qualification.tls;
    assert(tls);
    assert.equal(
      environment.SITUATE_UPDATER_ENDPOINT,
      "https://getsituate.com/releases/current/update.json",
    );
    const endpoint = new URL(environment.SITUATE_UPDATER_ENDPOINT);
    const publicBytes = async (url) => {
      const response = await fetchPublic(url, {
        redirect: "error",
        signal: AbortSignal.any(
          [signal, AbortSignal.timeout(15000)].filter(Boolean),
        ),
      });
      assert(response.ok);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert(bytes.length <= 1024 * 1024);
      return bytes;
    };
    phase = "public-baseline";
    const original = await publicBytes(endpoint.href);
    const publicAddress = (
      await resolvePublic(endpoint.hostname, { family: 4 })
    ).address;
    assert(isIP(publicAddress) === 4 && !publicAddress.startsWith("127."));
    await prepareSSH(
      { root: directory, environment: routeCheckEnvironment(environment) },
      async (prepared) => {
        const destination = releaseEnvironment(
          directory,
          ["WEBSITE_DEPLOY_HOST"],
          prepared,
        );
        const host = createHost(
          {
            ...tls,
            host: destination.WEBSITE_DEPLOY_HOST,
            sshIdentity: prepared.WEBSITE_SSH_IDENTITY,
            sshKnownHosts: prepared.WEBSITE_SSH_KNOWN_HOSTS,
            hostname: endpoint.hostname,
            feedPath: endpoint.pathname.slice(1),
            publicFeedSha256: sha256(original),
          },
          { environment: prepared },
        );
        let attempted = false;
        try {
          phase = "host-prepare";
          attempted = true;
          const facts = await host.prepare(operation);
          phase = "public-isolation";
          const outside = await fetchPublic(
            endpoint.origin + facts.identityPath,
            {
              redirect: "error",
              signal: AbortSignal.timeout(15000),
            },
          );
          await outside.body?.cancel();
          assert.equal(outside.status, 404);
          const bytes = Buffer.from('{"probe":"private-route"}\n');
          const file = join(temporary, "feed.json");
          writeFileSync(file, bytes, { mode: 0o600, flag: "wx" });
          phase = "host-stage";
          await host.stage({
            ...operation,
            files: [
              {
                path: endpoint.pathname.slice(1),
                source: file,
                size: bytes.length,
                sha256: sha256(bytes),
              },
            ],
          });
          phase = "host-serve";
          await host.serve(operation);
          phase = "route";
          await withRoute(
            {
              ...operation,
              host,
              hostname: endpoint.hostname,
              privateAddress: "127.0.0.2",
              localPort: 443,
              trustedEphemeralRunner: true,
            },
            async (_facts, routeSignal) => {
              phase = "worker";
              const output = await execute(
                process.execPath,
                [
                  "--input-type=module",
                  "-e",
                  workerProgram,
                  JSON.stringify({
                    module: pathToFileURL(
                      join(
                        directory,
                        "client/scripts/final-artifact-routing.mjs",
                      ),
                    ).href,
                    routing: {
                      endpoint: endpoint.href,
                      privateAddress: "127.0.0.2",
                      publicAddress,
                      interface: "lo0",
                      identityPath: facts.identityPath,
                      identitySha256: facts.identitySha256,
                      publicFeedSha256: sha256(original),
                      operationId: operation.operationNonce,
                    },
                    feedSha256: sha256(bytes),
                  }),
                ],
                {
                  env: qualificationEnvironment(environment),
                  capture: true,
                  signal: AbortSignal.any(
                    [signal, routeSignal, AbortSignal.timeout(75000)].filter(
                      Boolean,
                    ),
                  ),
                },
              );
              const report = JSON.parse(output);
              if (["routing", "feed-https"].includes(report.phase))
                phase = report.phase;
              assert.deepEqual(report, { status: "passed", phase: "complete" });
            },
            { signal },
          );
        } catch (error) {
          if (error?.diagnostic) diagnostic = error.diagnostic;
          failed = true;
        } finally {
          if (attempted) {
            cleanup = "uncertain";
            const state = await host.cleanup(operation);
            assert(["cleaned", "cleaned-retained"].includes(state.status));
            assert(!state.uncertain);
            cleanup = "confirmed";
          }
        }
      },
    );
    phase = failed ? phase : "public-restoration";
    assert.equal(sha256(await publicBytes(endpoint.href)), sha256(original));
    if (!failed) phase = "complete";
  } catch {
    failed = true;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return {
    version: 1,
    status: failed ? "failed" : "passed",
    phase,
    cleanup,
    ...operation,
    ...(diagnostic ? { route: diagnostic } : {}),
  };
}

export async function main() {
  const abort = new AbortController();
  const cancel = () =>
    abort.abort(new Error("Qualification route diagnostic cancelled"));
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    const report = await checkQualificationRoute({ signal: abort.signal });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.status !== "passed") process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!coordinated(root))
    process.exitCode = await runCoordinated({
      directory: root,
      command: process.execPath,
      args: process.argv.slice(1),
      environment: routeCheckEnvironment(process.env),
      cleanupGraceMs: 90000,
    });
  else await main();
}
