#!/usr/bin/env node
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { readImageLock, root } from "./ci-image.mjs";

export function parseOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      check: { type: "boolean" },
      update: { type: "boolean" },
      project: { type: "string" },
      grep: { type: "string" },
    },
  });
  if (values.check && values.update)
    throw new Error("Choose either --check or --update.");
  if (values.project && !["desktop", "mobile"].includes(values.project))
    throw new Error("--project must be desktop or mobile.");
  return values;
}

export function visualCommand(
  options,
  {
    image,
    environment = process.env,
    platform = process.platform,
    arch = process.arch,
  } = {},
) {
  if (options.update && environment.CI)
    throw new Error("Update visual baselines locally, not in CI.");
  const filters = [];
  for (const name of ["project", "grep"])
    if (options[name] !== undefined) filters.push(`--${name}`, options[name]);
  if (environment.SITUATE_CI_IMAGE) {
    if (
      environment.SITUATE_CI_IMAGE !== image ||
      platform !== "linux" ||
      arch !== "x64"
    )
      throw new Error("Visual tests require the locked Linux/amd64 CI image.");
    return {
      cwd: join(root, "client"),
      env: { SITUATE_VISUAL_GREP: options.grep ?? "" },
      args: [
        "node_modules/@playwright/test/cli.js",
        "test",
        "--config",
        "app/playwright.visual.config.ts",
        `--update-snapshots=${options.update ? "changed" : "none"}`,
        ...(options.project !== undefined
          ? ["--project", options.project]
          : []),
      ],
    };
  }
  return {
    cwd: root,
    args: [
      "tools/ci-container.mjs",
      "--visual",
      options.update ? "update" : "check",
      ...filters,
    ],
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const { image } = readImageLock(root);
  const command = visualCommand(options, { image });
  const child = spawn(process.execPath, command.args, {
    cwd: command.cwd,
    env: {
      ...process.env,
      ...command.env,
      CI_CACHE_DIR:
        process.env.CI_CACHE_DIR ?? join(tmpdir(), "situate-visual-downloads"),
    },
    stdio: "inherit",
  });
  let interrupted;
  const handlers = Object.entries({
    SIGINT: 130,
    SIGTERM: 143,
    SIGHUP: 129,
  }).map(([signal, code]) => {
    const handler = () => {
      interrupted = code;
      child.kill(signal);
    };
    process.on(signal, handler);
    return [signal, handler];
  });
  try {
    return await new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => accept(interrupted ?? code ?? 1));
    });
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
