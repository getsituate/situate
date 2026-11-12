#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { root, prepareDependencies } from "./test.mjs";
import { coordinated, runCoordinated } from "./run-coordinated.mjs";

export async function main(args = process.argv.slice(2)) {
  const workspace = args[0] ?? ".";
  if (args.length > 1 || ![".", "client", "requirements"].includes(workspace)) {
    console.error("Usage: node tools/npm-ci.mjs [.|client|requirements]");
    return 2;
  }
  if (!coordinated(root))
    return runCoordinated({
      directory: root,
      command: process.execPath,
      args: [fileURLToPath(import.meta.url), workspace],
    });
  const controller = new AbortController();
  const stop = () => controller.abort();
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(name, stop);
  let dependencies;
  try {
    dependencies = await prepareDependencies(workspace, {
      force: true,
      signal: controller.signal,
    });
    if (dependencies.failure) throw new Error(dependencies.failure.error);
    return 0;
  } catch (error) {
    console.error(error.message);
    return controller.signal.aborted ? 130 : 1;
  } finally {
    dependencies?.release();
    for (const name of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.removeListener(name, stop);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main();
