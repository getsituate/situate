import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBrowserServer } from "../../tools/browser-server.mjs";
import { compilerCacheEnvironment } from "../../tools/compiler-cache.mjs";

export function tauriDevCommand(
  root,
  url,
  args = [],
  env = {},
  { appDataRoot } = {},
) {
  if (
    appDataRoot &&
    args.some(
      (arg) =>
        arg === "--config" ||
        arg.startsWith("--config=") ||
        arg.startsWith("-c"),
    )
  )
    throw new Error(
      "Custom Tauri configuration is not supported for isolated desktop development.",
    );
  return {
    args: [
      "dev",
      "--config",
      JSON.stringify({
        build: { beforeDevCommand: "", devUrl: url },
        ...(appDataRoot
          ? { app: { appDirectoriesOverride: appDataRoot } }
          : {}),
      }),
      ...args,
    ],
    cwd: root,
    env: compilerCacheEnvironment({ ...process.env, ...env }),
    stdio: "inherit",
  };
}

export async function runTauriDev({
  root,
  start,
  launch,
  args = [],
  env = {},
  appDataRoot,
}) {
  let child;
  let stopping;
  const stop = (signal) => {
    stopping = signal;
    child?.kill(signal);
  };
  const handlers = new Map(
    ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [
      signal,
      () => stop(signal),
    ]),
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  let server;
  try {
    server = await start();
    if (stopping) return 0;
    const command = tauriDevCommand(root, server.url, args, env, {
      appDataRoot,
    });
    console.log(`Development server: ${server.url}`);
    child = launch(command);
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
  } finally {
    try {
      await server?.close();
    } finally {
      for (const [signal, handler] of handlers)
        process.removeListener(signal, handler);
    }
  }
}

export async function startTauriDev(
  root,
  env = {},
  args = process.argv.slice(2),
  { appDataRoot } = {},
) {
  const vite = await import("vite");
  return runTauriDev({
    root,
    env,
    appDataRoot,
    start: () =>
      startBrowserServer(vite, {
        root,
        configFile: resolve(root, "vite.config.ts"),
      }),
    launch: ({ args, ...options }) =>
      spawn(
        process.execPath,
        [
          fileURLToPath(import.meta.resolve("@tauri-apps/cli/tauri.js")),
          ...args,
        ],
        options,
      ),
    args,
  });
}
