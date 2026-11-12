import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readAppleEnv } from "../../client/scripts/apple-credentials.mjs";

export function sshArguments(config) {
  if (
    !/^(?:[a-z_][a-z0-9_-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(
      config.WEBSITE_DEPLOY_HOST ?? "",
    ) ||
    config.WEBSITE_DEPLOY_HOST?.trim() !== config.WEBSITE_DEPLOY_HOST
  )
    throw new Error(
      "Set WEBSITE_DEPLOY_HOST to an SSH alias or user@hostname.",
    );
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
  ];
  if (config.WEBSITE_SSH_IDENTITY) {
    if (
      !config.WEBSITE_SSH_IDENTITY.startsWith("/") ||
      /[\r\n\0]/.test(config.WEBSITE_SSH_IDENTITY)
    )
      throw new Error("WEBSITE_SSH_IDENTITY must be an absolute path.");
    args.push("-i", config.WEBSITE_SSH_IDENTITY, "-o", "IdentitiesOnly=yes");
  }
  return [...args, config.WEBSITE_DEPLOY_HOST];
}

export function readPublicationHistory(
  root,
  { environment = process.env, execute = execFileSync } = {},
) {
  const names = ["WEBSITE_DEPLOY_HOST", "WEBSITE_SSH_IDENTITY"];
  const needed = names.filter((name) => !Object.hasOwn(environment, name));
  const local =
    environment.CI || needed.length === 0
      ? {}
      : readAppleEnv(join(root, "client"), needed);
  const config = Object.fromEntries(
    names.map((name) => [
      name,
      Object.hasOwn(environment, name) ? environment[name] : local[name],
    ]),
  );
  const args = sshArguments(config);
  const code = readFileSync(new URL("./remote.py", import.meta.url)).toString(
    "base64",
  );
  const request = Buffer.from("{}").toString("base64");
  const command = `python3 -c 'import base64;exec(base64.b64decode("${code}"))' history ${request}`;
  const env = Object.fromEntries(
    ["PATH", "HOME", "SSH_AUTH_SOCK", "LANG"]
      .filter((name) => Object.hasOwn(environment, name))
      .map((name) => [name, environment[name]]),
  );
  let result;
  try {
    result = execute("ssh", [...args, command], {
      cwd: root,
      env,
      timeout: 30000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new Error(
      "Cannot read published macOS migration history from the release server. Check SSH access and release storage; no publication was attempted.",
    );
  }
  try {
    return JSON.parse(result);
  } catch {
    throw new Error("The release server returned invalid publication history.");
  }
}
