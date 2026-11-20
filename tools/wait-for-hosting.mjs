import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { hostingReadiness } from "../infrastructure/production/hosting-deployment.mjs";
import { revisionPattern } from "../infrastructure/production/hosting-inputs.mjs";

export async function main(
  env,
  [mode] = [],
  { observe = hostingReadiness, wait = delay } = {},
) {
  const revision = env.HOSTING_SOURCE_REVISION ?? env.GITHUB_SHA;
  if (
    env.GITHUB_REPOSITORY !== "getsituate/situate" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    !revisionPattern.test(revision ?? "") ||
    (mode && !["--check", "--select", "--probe"].includes(mode))
  )
    throw new Error("Hosting readiness requires a trusted main revision.");
  const git = (args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    }).trim();
  if (git(["rev-parse", "HEAD"]) !== revision)
    throw new Error(
      "The checkout does not match the hosting readiness revision.",
    );
  let previous;
  for (;;) {
    const result = await observe({ token: env.GH_TOKEN, revision });
    if (mode === "--select") {
      appendFileSync(env.GITHUB_OUTPUT, `needed=${!result.ready}\n`);
      if (result.ready)
        console.log("The verified host already matches the hosting inputs.");
      return;
    }
    if (result.ready) {
      if (mode === "--probe") {
        const { probeReleaseHost } =
          await import("../infrastructure/releases/hosting-readiness.mjs");
        probeReleaseHost(result.revision, env);
        const final = await observe({ token: env.GH_TOKEN, revision });
        if (!final.ready || final.deploymentId !== result.deploymentId)
          throw new Error("Hosting changed during the release host probe.");
      }
      return;
    }
    if (mode) throw new Error(result.reason);
    if (result.reason !== previous) console.log(result.reason);
    previous = result.reason;
    await wait(20_000);
    if (
      git([
        "ls-remote",
        "https://github.com/getsituate/situate.git",
        "refs/heads/main",
      ]).split(/\s/)[0] !== revision
    )
      throw new Error("A newer main revision owns this publication.");
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
