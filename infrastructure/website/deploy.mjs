#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../../website/site.mjs";
import { childEnvironment } from "./config.mjs";

const directory = fileURLToPath(new URL("./", import.meta.url));
export const releasePattern = /^[0-9]{14}-[a-f0-9]{12}$/;

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    env: childEnvironment(),
    stdio: "inherit",
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      command === "ssh"
        ? "SSH failed. Inspect the remote release and containers before retrying; an interruption does not prove failure."
        : `${command} failed (${result.status ?? "could not start"}).`,
    );
}

export async function stage(destination) {
  await build(join(destination, "site"));
  for (const file of ["compose.yaml", "nginx.conf", "reboot.caddy"])
    cpSync(join(directory, "docker", file), join(destination, file));
  for (const file of ["activate.sh", "configure-proxy.sh"])
    cpSync(join(directory, file), join(destination, file));
}

export function createArchive(staging, destination) {
  run(
    "tar",
    [
      "--format=ustar",
      "--no-xattrs",
      "--no-acls",
      "-czf",
      destination,
      "-C",
      staging,
      ".",
    ],
    {
      env: { ...childEnvironment(), COPYFILE_DISABLE: "1" },
    },
  );
}

export async function main(args = process.argv.slice(2)) {
  const [command, release] = args;
  if (
    !["deploy", "check", "proxy", "rollback"].includes(command) ||
    args.length !== (command === "rollback" ? 2 : 1) ||
    (command === "rollback" && !releasePattern.test(release))
  )
    throw new Error(
      "Usage: node infrastructure/website/deploy.mjs check|deploy|proxy|rollback <release-id>",
    );
  if (command === "check") {
    const staging = mkdtempSync(join(tmpdir(), "situate-website-"));
    try {
      await stage(staging);
      run("docker", [
        "compose",
        "-f",
        join(staging, "compose.yaml"),
        "config",
        "--quiet",
      ]);
      console.log("Website build and Compose configuration are valid.");
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    return;
  }
  throw new Error(
    "Preview hosting is retired. Use infrastructure/production/deploy.mjs for getsituate.com.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
