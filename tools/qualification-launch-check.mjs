import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { run } from "../client/scripts/ios-xcode.mjs";
import {
  launchBaselineStatus,
  queryLaunchConsent,
} from "../client/scripts/qualification-launch-confirmation.mjs";
import { createQualificationProcess } from "../client/scripts/final-artifact-process.mjs";
import { probeReleaseDesktop } from "./release-desktop.mjs";
import { validateQualificationProgress } from "./qualification-progress.mjs";
import { runCoordinated } from "./run-coordinated.mjs";

// Digests from the public v2026.11.14 release manifest.
const published = Object.freeze({
  version: "2026.11.14",
  path: "Situate-2026.11.14-macos-universal-direct.dmg",
  size: 43331630,
  sha256: "78a7b129a4fabff758380de232bdb2a0f2ac54ff764a240a9747a5c1a5e9f6d2",
  bundleSha256:
    "233c455dd310b240e4bfbf435b2238f8ad6283f591e23ca175ffcab8da8758eb",
  identifier: "com.getsituate.app",
});
const directory = fileURLToPath(new URL("../", import.meta.url));
const safeEnvironment = (env) =>
  Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL"]
      .filter((key) => typeof env[key] === "string")
      .map((key) => [key, env[key]]),
  );

export async function launchBaselineSamples({
  samples,
  environment,
  signal,
  query = queryLaunchConsent,
  output = console.log,
}) {
  assert(Number.isInteger(samples) && samples >= 1 && samples <= 20);
  let clear = true;
  for (let sample = 1; sample <= samples; sample++) {
    signal?.throwIfAborted();
    const started = performance.now();
    const result = await query("baseline", { environment, signal });
    output(
      JSON.stringify({
        sample,
        status: launchBaselineStatus(result),
        elapsedMs: Math.round(performance.now() - started),
      }),
    );
    clear &&= result === "absent";
  }
  return clear;
}

async function checkPublishedDmg(environment, signal) {
  const user = userInfo();
  assert(user.uid > 500, "A disposable macOS account is required");
  const scratch = mkdtempSync(
    join(realpathSync(tmpdir()), "situate-launch-check-"),
  );
  const dmg = join(scratch, published.path);
  try {
    console.log(JSON.stringify({ publishedDmg: published.version }));
    try {
      await run(
        "/usr/bin/curl",
        [
          "--disable",
          "--fail",
          "--silent",
          "--location",
          "--max-redirs",
          "4",
          "--proto",
          "=https",
          "--proto-redir",
          "=https",
          "--max-time",
          "60",
          "--max-filesize",
          String(published.size),
          "--output",
          dmg,
          `https://github.com/getsituate/situate/releases/download/v${published.version}/${published.path}`,
        ],
        { env: environment, capture: true, signal },
      );
      assert.equal(lstatSync(dmg).size, published.size);
    } catch (error) {
      console.log(JSON.stringify({ status: "published_dmg_download_failed" }));
      throw error;
    }
    const { createSignedFirstLaunchDiagnostic } =
      await import("../client/scripts/final-artifact-qualification.mjs");
    let phase = "prepare";
    const started = performance.now();
    const progress = (
      name,
      status,
      command = "none",
      elapsedMs = Math.round(performance.now() - started),
    ) => {
      if (command === "none") phase = name;
      const event = validateQualificationProgress({
        phase: name,
        status,
        command,
        elapsedMs,
      });
      console.log(JSON.stringify(event));
    };
    const diagnose = createSignedFirstLaunchDiagnostic(
      {
        mode: "ephemeral-host",
        uid: user.uid,
        name: user.username,
        home: user.homedir,
      },
      {
        environment,
        signal,
        progress,
        execute: createQualificationProcess({
          progress,
          getPhase: () => phase,
        }),
      },
    );
    await diagnose(scratch, published);
  } finally {
    rmSync(scratch, { recursive: true });
  }
}

function usageError(message) {
  console.error(message);
  return 1;
}

async function main(args, environment) {
  const { values } = parseArgs({
    args,
    options: {
      samples: { type: "string", default: "5" },
      "published-dmg": { type: "boolean" },
      "disposable-account": { type: "boolean" },
    },
  });
  if (
    process.platform !== "darwin" ||
    !/^(?:[1-9]|1\d|20)$/.test(values.samples)
  )
    return usageError("Use macOS with --samples 1 through 20.");
  const hosted =
    environment.GITHUB_ACTIONS === "true" &&
    environment.RUNNER_ENVIRONMENT === "github-hosted";
  const publishedDmg =
    values["published-dmg"] ||
    environment.LAUNCH_CHECK_PUBLISHED_DMG === "true";
  if (!hosted && environment.SITUATE_NATIVE_EXECUTOR !== "vm")
    return usageError(
      "Run inside a disposable macOS VM with SITUATE_NATIVE_EXECUTOR=vm.",
    );
  if (publishedDmg && !hosted && !values["disposable-account"])
    return usageError(
      "Use --disposable-account to install the published DMG inside the VM.",
    );
  if (environment.SITUATE_COORDINATED_DESKTOP !== "1")
    return runCoordinated({
      directory,
      resource: "desktop",
      command: process.execPath,
      args: [fileURLToPath(import.meta.url), ...args],
      environment,
      cleanupGraceMs: 75_000,
    });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    const env = safeEnvironment(environment);
    if (
      !hosted &&
      (await run("/usr/sbin/sysctl", ["-n", "kern.hv_vmm_present"], {
        env,
        capture: true,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
      })) !== "1"
    )
      return usageError("Run inside a disposable macOS VM, not on the host.");
    const releaseInfo = await run("/usr/bin/sw_vers", [], {
      env,
      capture: true,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
    });
    const version = /^ProductVersion:\s*([\d.]+)$/m.exec(releaseInfo)?.[1];
    const build = /^BuildVersion:\s*([a-zA-Z0-9]+)$/m.exec(releaseInfo)?.[1];
    assert(version && build, "macOS version unavailable");
    console.log(JSON.stringify({ macos: version, build }));
    try {
      console.log(
        JSON.stringify({ desktop: await probeReleaseDesktop({ environment }) }),
      );
    } catch (error) {
      if (error.diagnostic)
        console.log(JSON.stringify({ desktop: error.diagnostic }));
      throw error;
    }
    const clear = await launchBaselineSamples({
      samples: Number(values.samples),
      environment: env,
      signal: controller.signal,
    });
    if (clear && publishedDmg) await checkPublishedDmg(env, controller.signal);
    return clear ? 0 : 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.exitCode = await main(process.argv.slice(2), process.env);
  } catch {
    console.error(
      "macOS first-launch check failed. Review the diagnostic codes above.",
    );
    process.exitCode = 1;
  }
}
