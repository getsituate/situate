#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareDependencies, root } from "./test.mjs";
import { coordinated, runCoordinated } from "./run-coordinated.mjs";
import { fileURLToPath } from "node:url";

const extraEntrypoints = JSON.parse(
  readFileSync(
    new URL("./dev-tui/client-dependencies.json", import.meta.url),
    "utf8",
  ),
);

export async function prepareClientDependencies(options = {}) {
  const dependencies = await prepareDependencies("client", {
    ...options,
    extraEntrypoints,
  });
  try {
    if (dependencies.failure) throw new Error(dependencies.failure.error);
  } finally {
    dependencies.release();
  }
}

export async function main() {
  const controller = new AbortController();
  let exitCode;
  const handlers = Object.entries({
    SIGINT: 130,
    SIGTERM: 143,
    SIGHUP: 129,
  }).map(([name, code]) => {
    const handler = () => {
      exitCode = code;
      controller.abort();
    };
    process.on(name, handler);
    return [name, handler];
  });
  try {
    await prepareClientDependencies({ signal: controller.signal });
    return exitCode ?? 0;
  } catch (error) {
    console.error(error.message);
    return exitCode ?? 1;
  } finally {
    for (const [name, handler] of handlers)
      process.removeListener(name, handler);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = coordinated(root)
    ? await main()
    : await runCoordinated({
        directory: root,
        command: process.execPath,
        args: [fileURLToPath(import.meta.url)],
      });
