import { readFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const root = fileURLToPath(new URL("../../", import.meta.url));

export function configuration(
  names,
  environment = process.env,
  directory = root,
) {
  let local = {};
  if (!environment.CI) {
    const path = resolve(directory, ".env");
    try {
      const stat = lstatSync(path);
      if (
        !stat.isFile() ||
        stat.size > 2 * 1024 * 1024 ||
        (process.platform !== "win32" && stat.mode & 0o077)
      )
        throw new Error(
          "The root .env must be a regular, owner-only file (chmod 600 .env).",
        );
      local = parseEnv(readFileSync(path, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return Object.fromEntries(
    names.map((name) => [name, environment[name] ?? local[name]]),
  );
}

export function childEnvironment(environment = process.env) {
  return Object.fromEntries(
    ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "SSH_AUTH_SOCK", "SystemRoot"]
      .filter((name) => environment[name] !== undefined)
      .map((name) => [name, environment[name]]),
  );
}

export function sshArguments(config) {
  const host = config.WEBSITE_DEPLOY_HOST;
  if (!host || !/^(?:[a-z_][a-z0-9_-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host))
    throw new Error(
      "Set WEBSITE_DEPLOY_HOST to an SSH host alias or user@hostname.",
    );
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=10",
  ];
  if (config.WEBSITE_SSH_IDENTITY)
    args.push("-i", config.WEBSITE_SSH_IDENTITY, "-o", "IdentitiesOnly=yes");
  return [...args, host];
}
