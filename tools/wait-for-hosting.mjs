import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  HostingReadUnavailable,
  hostingReadiness,
  observeHostingProducer,
} from "../infrastructure/production/hosting-deployment.mjs";
import { revisionPattern } from "../infrastructure/production/hosting-inputs.mjs";

export async function main(
  env,
  [mode] = [],
  {
    observe = hostingReadiness,
    producer = observeHostingProducer,
    wait = delay,
    execute = execFileSync,
  } = {},
) {
  const revision = env.HOSTING_SOURCE_REVISION ?? env.GITHUB_SHA;
  if (
    env.GITHUB_REPOSITORY !== "getsituate/situate" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    !revisionPattern.test(revision ?? "") ||
    (mode && !["--check", "--select", "--probe", "--release"].includes(mode))
  )
    throw new Error("Hosting readiness requires a trusted main revision.");
  const git = (args) => {
    try {
      return execute("/usr/bin/git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: "/usr/bin:/bin",
          HOME: env.HOME,
          GIT_TERMINAL_PROMPT: "0",
        },
        timeout: 15_000,
      }).trim();
    } catch {
      throw new Error("Cannot verify the current Git revision for delivery.");
    }
  };
  if (git(["rev-parse", "HEAD"]) !== revision)
    throw new Error(
      "The checkout does not match the hosting readiness revision.",
    );
  const input = { token: env.GH_TOKEN, revision };
  if (!mode || mode === "--release") {
    return waitForHosting(input, {
      observe,
      producer,
      wait,
      verifyMain: () => {
        if (mode === "--release") return;
        if (
          git([
            "ls-remote",
            "https://github.com/getsituate/situate.git",
            "refs/heads/main",
          ]).split(/\s+/)[0] !== revision
        )
          throw new Error("A newer main revision owns this publication.");
      },
    });
  }
  const result = await observe(input);
  if (mode === "--select") {
    appendFileSync(env.GITHUB_OUTPUT, `needed=${!result.ready}\n`);
    if (result.ready)
      console.log("The verified host already matches the hosting inputs.");
    return;
  }
  if (!result.ready) throw new Error(result.reason);
  if (mode === "--probe") {
    const { probeReleaseHost } =
      await import("../infrastructure/releases/hosting-readiness.mjs");
    probeReleaseHost(result.revision, env);
    const final = await observe(input);
    if (!final.ready || final.deploymentId !== result.deploymentId)
      throw new Error("Hosting changed during the release host probe.");
  }
}

export class HostingProducerFailed extends Error {}

async function waitForHosting(input, { observe, producer, wait, verifyMain }) {
  let previousFailure;
  let previousReason;
  for (;;) {
    let failure;
    let reason;
    try {
      const result = await observe(input);
      if (result.ready) return;
      reason = result.reason;
      if (!result.changed) {
        const run = await producer(input);
        if (run.kind === "unavailable") reason = run.reason;
        if (run.kind === "failed") {
          failure = `${run.runId}/${run.attempt}/${run.conclusion}`;
          // Give a replacement run or a just-written deployment time to become visible.
          if (failure === previousFailure) {
            const final = await observe(input);
            verifyMain();
            if (final.ready) return;
            if (final.changed) {
              failure = undefined;
              reason = final.reason;
            } else {
              throw new HostingProducerFailed(
                `Deploy hosting run ${run.runId} (attempt ${run.attempt}) concluded ${run.conclusion} without a verified deployment for this revision. Inspect the run before retrying delivery.`,
              );
            }
          }
        }
      }
    } catch (error) {
      if (!(error instanceof HostingReadUnavailable)) throw error;
      failure = undefined;
      reason = error.message;
    }
    previousFailure = failure;
    if (reason !== previousReason) console.log(reason);
    previousReason = reason;
    await wait(20_000);
    verifyMain();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main(process.env, process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
