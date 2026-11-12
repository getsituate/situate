import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { childEnvironment, parseAgentOptions } from "./agent-e2e-runtime.mjs";
import { readPackage } from "./native-vm-package.mjs";

export async function createGuestIsolation(manifest) {
  const { root, owner, identifier } = manifest.isolation;
  await mkdir(root, { mode: 0o700 });
  await writeFile(join(root, ".smoke-owner"), owner, {
    flag: "wx",
    mode: 0o600,
  });
  for (const name of ["home", "tmp", "config", "data", "cache", "pi"])
    await mkdir(join(root, name), { mode: 0o700 });
  const isolated = {
    root,
    owner,
    identifier,
    async cleanup() {
      const marker = join(root, ".smoke-owner");
      if (
        !(await lstat(root)).isDirectory() ||
        (await lstat(root)).isSymbolicLink() ||
        !(await lstat(marker)).isFile() ||
        (await lstat(marker)).isSymbolicLink() ||
        (await readFile(marker, "utf8")) !== owner
      )
        throw new Error("Native VM isolation ownership mismatch.");
      await rm(root, { recursive: true });
    },
  };
  isolated.env = childEnvironment(isolated, {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  });
  return isolated;
}

export async function executePackage(
  manifest,
  { isolate = createGuestIsolation, native, agent } = {},
) {
  if (
    manifest.kind === "agent" &&
    parseAgentOptions(manifest.args).provider !== "fixture"
  )
    throw new Error("Native VM journeys require the fixture provider.");
  const isolated = await isolate(manifest);
  const environment = {
    ...isolated.env,
    SITUATE_NATIVE_EXECUTOR: "local",
    CI: "true",
    SITUATE_ONBOARDING_HANDOFF_ONLY: manifest.modes.handoff ? "1" : "0",
    SITUATE_PROCESS_CONNECTION_ONLY: manifest.modes.process ? "1" : "0",
  };
  // Smoke phase workers inherit process.env; erase the SSH session's ambient configuration.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment);
  const retain = () =>
    writeFile(join(manifest.root, ".native-vm-retain"), "1\n", { mode: 0o600 });
  try {
    const build = async () => ({
      executable: manifest.executable,
      release: async () => {},
    });
    if (manifest.kind === "agent") {
      agent ??= (await import("./test-agent-e2e.mjs")).runAgent;
      const report = await agent(manifest.args, {
        environment,
        isolate: async () => isolated,
        build,
      });
      if (report.cleanup === "failed") await retain();
      console.log(JSON.stringify(report));
      return report.outcome === "passed" && report.cleanup !== "failed"
        ? 0
        : report.outcome === "cancel"
          ? 130
          : report.outcome === "blocked"
            ? 2
            : 1;
    }
    native ??= (await import("./test-native.mjs")).runNative;
    await native(manifest.args, {
      environment,
      isolate: async (run) => {
        try {
          return await run(isolated);
        } finally {
          await isolated.cleanup();
        }
      },
      build: async () => manifest.executable,
    });
    return 0;
  } catch (error) {
    if (error.cleanupUnsafe) await retain();
    throw error;
  }
}

export async function main() {
  const directory = fileURLToPath(new URL("../../", import.meta.url));
  const manifest = await readPackage(directory);
  if ((await realpath(directory)) !== manifest.root)
    throw new Error(
      "Native VM package is outside its allocated run directory.",
    );
  return executePackage(manifest);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main();
