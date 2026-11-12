#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../website/site.mjs";
import {
  childEnvironment,
  configuration,
  sshArguments,
} from "../website/config.mjs";
import { createArchive, releasePattern, run } from "../website/deploy.mjs";

const directory = fileURLToPath(new URL("./", import.meta.url));
const usage =
  "Usage: node infrastructure/production/deploy.mjs check|prepare|deploy|inventory|edge --confirm-domain getsituate.com|feeds --confirm-domain getsituate.com|activate --confirm-domain getsituate.com --confirm-public-content|quiesce|retire <reviewed-inventory.json> --confirm-host getsituate-production --confirm-discard-prototype";

function publicTree(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
    throw new Error(
      "Public website staging must contain only regular files and directories.",
    );
  chmodSync(path, stat.isDirectory() ? 0o755 : 0o644);
  if (stat.isDirectory())
    for (const name of readdirSync(path)) publicTree(join(path, name));
}

export async function stage(destination) {
  mkdirSync(destination, { recursive: true, mode: 0o755 });
  await build(join(destination, "site"));
  for (const file of [
    "compose.yaml",
    "edge-compose.yaml",
    "nginx.conf",
    "Caddyfile",
  ])
    cpSync(join(directory, "docker", file), join(destination, file));
  for (const file of [
    "activate.sh",
    "configure-proxy.sh",
    "relocate-edge.sh",
    "edge-snippets.sh",
    "retire-prototype.py",
  ])
    cpSync(join(directory, file), join(destination, file));
  publicTree(destination);
}

export async function main(
  args,
  { execute = run, environment = process.env } = {},
) {
  const command = args[0];
  const ordinary =
    ["check", "prepare", "deploy", "inventory"].includes(command) &&
    args.length === 1;
  const retire =
    ["quiesce", "retire"].includes(command) &&
    args.length === 5 &&
    args[2] === "--confirm-host" &&
    args[3] === "getsituate-production" &&
    args[4] === "--confirm-discard-prototype";
  const edge =
    command === "edge" &&
    args.length === 3 &&
    args[1] === "--confirm-domain" &&
    args[2] === "getsituate.com";
  const feeds =
    command === "feeds" &&
    args.length === 3 &&
    args[1] === "--confirm-domain" &&
    args[2] === "getsituate.com";
  const activate =
    command === "activate" &&
    args.length === 4 &&
    args[1] === "--confirm-domain" &&
    args[2] === "getsituate.com" &&
    args[3] === "--confirm-public-content";
  if (!ordinary && !edge && !feeds && !activate && !retire)
    throw new Error(usage);
  if (command === "check") {
    const temporary = mkdtempSync(join(tmpdir(), "situate-production-"));
    try {
      await stage(temporary);
      execute("docker", [
        "compose",
        "-f",
        join(temporary, "compose.yaml"),
        "config",
        "--quiet",
      ]);
      execute("docker", [
        "compose",
        "-f",
        join(temporary, "edge-compose.yaml"),
        "config",
        "--quiet",
      ]);
      console.log("Production website and Compose configuration are valid.");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
    return;
  }
  const config = configuration(
    ["WEBSITE_DEPLOY_HOST", "WEBSITE_SSH_IDENTITY"],
    environment,
  );
  const ssh = sshArguments(config);
  const env = childEnvironment(environment);
  if (command === "prepare") {
    execute("ssh", [...ssh, "sudo -n bash -s"], {
      input: readFileSync(join(directory, "prepare-host.sh")),
      stdio: ["pipe", "inherit", "inherit"],
      env,
    });
    return;
  }
  if (command === "inventory" || retire) {
    const input = retire ? readFileSync(resolve(args[1])) : undefined;
    execute(
      "ssh",
      [
        ...ssh,
        `sudo -n python3 /opt/situate-production/current/retire-prototype.py ${retire ? `${command} --confirm-host getsituate-production --confirm-discard-prototype` : "inventory"}`,
      ],
      { env, input, stdio: [retire ? "pipe" : "ignore", "inherit", "inherit"] },
    );
    return;
  }
  if (edge) {
    execute(
      "ssh",
      [...ssh, "bash /opt/situate-production/current/relocate-edge.sh"],
      { env },
    );
    return;
  }
  if (feeds || activate) {
    execute(
      "ssh",
      [
        ...ssh,
        `bash /opt/situate-production/current/configure-proxy.sh ${feeds ? "feeds" : "website"}`,
      ],
      { env },
    );
    return;
  }
  const id =
    new Date().toISOString().replace(/\D/g, "").slice(0, 14) +
    "-" +
    randomBytes(6).toString("hex");
  if (!releasePattern.test(id))
    throw new Error("Could not create a website release ID.");
  const remote = `/opt/situate-production/releases/${id}`;
  const temporary = mkdtempSync(join(tmpdir(), "situate-production-"));
  try {
    const staged = join(temporary, "website");
    await stage(staged);
    execute("docker", [
      "compose",
      "-f",
      join(staged, "compose.yaml"),
      "config",
      "--quiet",
    ]);
    createArchive(staged, join(temporary, "website.tar.gz"));
    execute(
      "ssh",
      [
        ...ssh,
        `set -eu; test -d /opt/situate-production/releases; test -d /opt/situate/releases; mkdir -m 0755 '${remote}'`,
      ],
      { env },
    );
    const archive = openSync(join(temporary, "website.tar.gz"), "r");
    try {
      execute("ssh", [...ssh, `tar --no-same-owner -xzf - -C '${remote}'`], {
        stdio: [archive, "inherit", "inherit"],
        env,
      });
    } finally {
      closeSync(archive);
    }
    execute("ssh", [...ssh, `bash '${remote}/activate.sh' '${id}'`], { env });
    console.log(`Production website service release: ${id}`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(
      "If a host request was sent, inspect its markers and running services before retrying; a failed SSH request does not establish the remote outcome.",
    );
    process.exitCode = 1;
  }
}
