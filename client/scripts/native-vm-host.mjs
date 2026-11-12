import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./native-vm-build.mjs";
import { createIsolation, parseAgentOptions } from "./agent-e2e-runtime.mjs";
import { parseSmokeOptions } from "./native-smoke-runtime.mjs";
import { guestIsolation, stagePackage } from "./native-vm-package.mjs";

export function verifyRuntimeDependencies(executable, inspect = spawnSync) {
  const result = inspect("/usr/bin/otool", ["-L", executable], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  if (result.error || result.status !== 0)
    throw new Error("Could not inspect native VM runtime dependencies.");
  const lines = result.stdout.trimEnd().split("\n");
  if (lines.shift() !== `${executable}:` || lines.length === 0)
    throw new Error("Invalid native VM runtime dependency inventory.");
  for (const line of lines) {
    const dependency = line.match(
      /^\s+(.+?) \(compatibility version [^\n]+\)$/,
    )?.[1];
    if (
      !dependency ||
      !/^\/(?:usr\/lib|System\/Library)\//.test(dependency) ||
      dependency.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error(
        "Native VM runtime requires a non-system dynamic library.",
      );
  }
}

export async function runNativeVm(
  kind,
  args,
  {
    environment = process.env,
    signal,
    transport,
    build = buildApp,
    isolate = createIsolation,
    stage = stagePackage,
    verify = verifyRuntimeDependencies,
  } = {},
) {
  const options =
    kind === "agent"
      ? parseAgentOptions(args)
      : {
          ...parseSmokeOptions(args),
          "build-timeout": 900,
          nativeSmoke: true,
        };
  if (kind === "agent" && options.provider !== "fixture")
    throw new Error("Native VM journeys require the fixture provider.");
  const run = await transport.createNativeVmRun({ environment, signal });
  let isolated,
    staging,
    built,
    unsafeBuild = false,
    retainGuest = false;
  try {
    const guest = guestIsolation(run);
    isolated = await isolate();
    // Build tools use local HOME and temporary files; only the app-data override is remote.
    built = await build(
      {
        ...isolated,
        root: guest.root,
        identifier:
          kind === "native" ? "dev.situate.client.smoke" : guest.identifier,
        buildRoot: isolated.root,
      },
      options,
      environment,
      signal,
    );
    await verify(built.executable);
    staging = await mkdtemp(join(tmpdir(), "situate-native-vm-package-"));
    await stage(staging, {
      run,
      kind,
      args,
      modes: {
        handoff: environment.SITUATE_ONBOARDING_HANDOFF_ONLY === "1",
        process: environment.SITUATE_PROCESS_CONNECTION_ONLY === "1",
      },
      executable: built.executable,
    });
    await built.release();
    built = undefined;
    await isolated.cleanup();
    isolated = undefined;
    await run.upload(staging);
    retainGuest = true;
    const code = await run.execute({
      entrypoint: "client/scripts/native-vm-guest.mjs",
      args: [],
      timeoutMs: kind === "agent" ? options.timeout * 1000 + 60000 : 1800000,
    });
    if (!Number.isInteger(code) || code < 0 || code > 255)
      throw new Error("Invalid native VM execution result.");
    retainGuest = code !== 0;
    return code;
  } catch (error) {
    unsafeBuild = error.cleanupUnsafe === true;
    throw error;
  } finally {
    try {
      if (built && !unsafeBuild) await built.release();
      if (isolated && !unsafeBuild) await isolated.cleanup();
      if (staging) await rm(staging, { recursive: true, force: true });
    } finally {
      if (!retainGuest) await run.cleanup();
    }
  }
}
