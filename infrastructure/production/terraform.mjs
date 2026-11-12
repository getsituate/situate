#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment, configuration } from "../website/config.mjs";
import { checkAdoptionPlan } from "./inspect.mjs";
import {
  hcpConfiguration,
  hostname,
  inspectWorkspace,
  workspaceName,
} from "./hcp.mjs";

const terraformDirectory = fileURLToPath(
  new URL("./terraform/", import.meta.url),
);
const usage =
  "Usage: node infrastructure/production/terraform.mjs init|validate|status|export <new.tfstate>|plan <variables.tfvars.json> <new.tfplan>|show <saved.tfplan>|adopt <saved.tfplan> --confirm-ownership-handoff";

function privateFile(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (process.platform !== "win32" &&
      (stat.mode & 0o077 || stat.uid !== process.getuid()))
  )
    throw new Error(
      "Expected an owner-only regular file, not a symlink or hard link.",
    );
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return false;
  }
}

function privateDestination(path, extension) {
  const absolute = resolve(path);
  if (!absolute.endsWith(extension))
    throw new Error(`Use a ${extension} file.`);
  const parent = dirname(absolute);
  const stat = statSync(parent);
  if (
    !stat.isDirectory() ||
    (process.platform !== "win32" &&
      (stat.mode & 0o077 || stat.uid !== process.getuid()))
  )
    throw new Error(
      "Use an owner-only directory (chmod 700) for state and saved plans.",
    );
  for (const args of [
    ["rev-parse", "--show-toplevel"],
    ["rev-parse", "--is-inside-git-dir"],
  ]) {
    const result = spawnSync("git", ["-C", parent, ...args], {
      env: childEnvironment(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.error)
      throw new Error("Git is required to validate private output locations.");
    if (
      result.status === 0 &&
      (args[1] === "--show-toplevel" || result.stdout.trim() === "true")
    )
      throw new Error(
        "State exports and saved plans must be outside Git repositories.",
      );
  }
  if (pathExists(absolute))
    throw new Error("Private output files are never overwritten.");
  return absolute;
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function backendMetadata(directory) {
  const path = join(directory, ".terraform/terraform.tfstate");
  try {
    const metadata = JSON.parse(readFileSync(path, "utf8"));
    const config = metadata.backend?.config;
    if (
      metadata.backend?.type !== "cloud" ||
      config?.hostname !== hostname ||
      config.workspaces?.name !== workspaceName ||
      config.workspaces?.tags?.length ||
      (config.organization != null &&
        config.organization !== "" &&
        typeof config.organization !== "string")
    )
      throw new Error("Unexpected backend configuration.");
    return { hash: digest(path), organization: config.organization };
  } catch {
    throw new Error(
      "Initialize a clean checkout with the configured HCP backend; existing backend migrations require a separate reviewed handoff.",
    );
  }
}

function targetIdentity(target) {
  return {
    hostname: target.hostname,
    organization: target.organization,
    workspace: target.workspace,
    workspaceId: target.workspaceId,
  };
}
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function initializedBackend(directory, target) {
  const metadata = backendMetadata(directory);
  const path = join(directory, ".terraform/situate-backend.json");
  let record;
  try {
    privateFile(path);
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Initialize this checkout with the configured HCP workspace first.",
    );
  }
  if (
    record.version !== 1 ||
    !same(record.target, targetIdentity(target)) ||
    record.metadataHash !== metadata.hash ||
    (metadata.organization && metadata.organization !== target.organization)
  )
    throw new Error(
      "The initialized backend does not match the configured HCP workspace.",
    );
}

function savedPlan(path) {
  const absolute = resolve(path);
  if (!absolute.endsWith(".tfplan"))
    throw new Error("Use a saved .tfplan file.");
  privateFile(absolute);
  return absolute;
}

function checkPlanBackend(plan, target) {
  const path = `${plan}.state.json`;
  privateFile(path);
  const record = JSON.parse(readFileSync(path, "utf8"));
  if (
    record.version !== 2 ||
    record.backend !== "cloud" ||
    !same(record.target, targetIdentity(target)) ||
    !same(record.stateVersion, target.stateVersion) ||
    record.sha256 !== digest(plan)
  )
    throw new Error(
      "The saved plan is not bound to the current HCP workspace and state version. Generate and review a new plan.",
    );
}

export async function main(
  args,
  {
    directory = terraformDirectory,
    environment = process.env,
    execute = spawnSync,
    fetchImpl = fetch,
  } = {},
) {
  const command = args[0];
  if (
    !(["init", "validate", "status"].includes(command) && args.length === 1) &&
    !(command === "export" && args.length === 2) &&
    !(command === "plan" && args.length === 3) &&
    !(command === "show" && args.length === 2) &&
    !(
      command === "adopt" &&
      args.length === 3 &&
      args[2] === "--confirm-ownership-handoff"
    )
  )
    throw new Error(usage);
  const oldMask = process.umask(0o077);
  try {
    const needsHcp = command !== "validate" && command !== "show";
    const names = needsHcp
      ? ["TF_CLOUD_ORGANIZATION", "TF_TOKEN_app_terraform_io"]
      : [];
    if (["plan", "adopt"].includes(command)) names.push("HCLOUD_TOKEN");
    const config = names.length ? configuration(names, environment) : {};
    const env = {
      ...childEnvironment(environment),
      TF_IN_AUTOMATION: "1",
      TF_INPUT: "0",
    };
    const hcp = needsHcp ? hcpConfiguration(config) : null;
    if (hcp) {
      env.TF_CLOUD_ORGANIZATION = hcp.organization;
      env.TF_TOKEN_app_terraform_io = hcp.token;
      env.TF_WORKSPACE = workspaceName;
    }
    if (["plan", "adopt"].includes(command)) {
      if (!config.HCLOUD_TOKEN)
        throw new Error(
          "Set HCLOUD_TOKEN before planning or adopting production resources.",
        );
      env.HCLOUD_TOKEN = config.HCLOUD_TOKEN;
    }
    function run(parameters, capture = false) {
      const result = execute("terraform", parameters, {
        cwd: directory,
        env,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      });
      if (result.error || result.status !== 0)
        throw new Error(
          "Terraform failed. Inspect HCP state and pending operations before retrying; no automatic retry was attempted.",
        );
      return result.stdout;
    }
    if (command === "validate") {
      run(["validate"]);
      return;
    }
    if (command === "show") {
      run(["show", savedPlan(args[1])]);
      return;
    }
    const inspect = () =>
      inspectWorkspace(hcp, fetchImpl, { allowLocked: command === "status" });
    const target = await inspect();
    if (command === "status") {
      console.log(JSON.stringify(target, null, 2));
      return;
    }
    if (command === "init") {
      if (
        [
          "terraform.tfstate",
          "terraform.tfstate.backup",
          "terraform.tfstate.d",
        ].some((name) => pathExists(join(directory, name)))
      )
        throw new Error(
          "Local state exists in this checkout; resolve its ownership before HCP initialization.",
        );
      const metadataPath = join(directory, ".terraform/terraform.tfstate");
      const binding = join(directory, ".terraform/situate-backend.json");
      if (pathExists(metadataPath)) {
        initializedBackend(directory, target);
        return;
      } else if (pathExists(binding))
        throw new Error(
          "Backend metadata is missing; inspect the existing workspace binding before continuing.",
        );
      run(["init", "-input=false", "-lockfile=readonly"]);
      const after = await inspect();
      if (!same(targetIdentity(after), targetIdentity(target)))
        throw new Error(
          "The HCP workspace changed during initialization; inspect it before continuing.",
        );
      const metadata = backendMetadata(directory);
      if (
        metadata.organization &&
        metadata.organization !== target.organization
      )
        throw new Error("Unexpected initialized HCP organization.");
      if (!pathExists(binding))
        writeFileSync(
          binding,
          JSON.stringify({
            version: 1,
            target: targetIdentity(target),
            metadataHash: metadata.hash,
          }) + "\n",
          { mode: 0o600, flag: "wx" },
        );
      initializedBackend(directory, target);
      return;
    }
    initializedBackend(directory, target);
    async function exportState(destination, snapshot) {
      if (!snapshot.stateVersion) {
        writeFileSync(
          `${destination}.empty.json`,
          JSON.stringify(snapshot) + "\n",
          { mode: 0o600, flag: "wx" },
        );
        return;
      }
      const raw = run(["state", "pull"], true);
      const state = JSON.parse(raw);
      if (
        state.version !== 4 ||
        typeof state.lineage !== "string" ||
        state.serial !== snapshot.stateVersion.serial ||
        !Array.isArray(state.resources)
      )
        throw new Error(
          "The exported state does not match the inspected HCP state version.",
        );
      const after = await inspect();
      if (!same(after, snapshot))
        throw new Error(
          "The HCP state changed during export; inspect it before continuing.",
        );
      writeFileSync(destination, raw, { mode: 0o600, flag: "wx" });
    }
    if (command === "export") {
      const destination = privateDestination(args[1], ".tfstate");
      if (!target.stateVersion)
        throw new Error("The HCP workspace has no state to export.");
      await exportState(destination, target);
      console.log(`Private state export: ${destination}`);
      return;
    }
    if (command === "plan") {
      const variables = resolve(args[1]);
      if (!variables.endsWith(".tfvars.json"))
        throw new Error("Use a private .tfvars.json inventory file.");
      privateFile(variables);
      const output = privateDestination(args[2], ".tfplan");
      if (pathExists(`${output}.state.json`))
        throw new Error("Private output files are never overwritten.");
      run([
        "plan",
        "-input=false",
        "-lock-timeout=30s",
        `-var-file=${variables}`,
        `-out=${output}`,
      ]);
      const checked = checkAdoptionPlan(
        JSON.parse(run(["show", "-json", output], true)),
      );
      const after = await inspect();
      if (!same(after, target))
        throw new Error(
          "The HCP workspace or state changed during planning; generate a new plan.",
        );
      initializedBackend(directory, target);
      privateFile(output);
      writeFileSync(
        `${output}.state.json`,
        JSON.stringify({
          version: 2,
          backend: "cloud",
          target: targetIdentity(target),
          stateVersion: target.stateVersion,
          sha256: digest(output),
        }) + "\n",
        { mode: 0o600, flag: "wx" },
      );
      console.log(
        `${checked.resources} resources, ${checked.imports} imports, no resource changes. Plan: ${output}`,
      );
      return;
    }
    const plan = savedPlan(args[1]);
    checkPlanBackend(plan, target);
    checkAdoptionPlan(JSON.parse(run(["show", "-json", plan], true)));
    const journal = privateDestination(`${plan}.adoption.json`, ".json");
    const prefix = `${plan}.${new Date().toISOString().replaceAll(":", "-")}`;
    await exportState(`${prefix}.before.tfstate`, target);
    if (!same(await inspect(), target))
      throw new Error(
        "The HCP workspace or state changed before adoption; generate a new plan.",
      );
    writeFileSync(
      journal,
      JSON.stringify({
        target,
        sha256: digest(plan),
        startedAt: new Date().toISOString(),
      }) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    try {
      run(["apply", "-input=false", "-lock-timeout=30s", plan]);
    } finally {
      await exportState(`${prefix}.after.tfstate`, await inspect());
    }
    writeFileSync(
      `${journal}.complete`,
      JSON.stringify({ completedAt: new Date().toISOString() }) + "\n",
      { mode: 0o600, flag: "wx" },
    );
  } finally {
    process.umask(oldMask);
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
    process.exitCode = 1;
  }
}
