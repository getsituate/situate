#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment, configuration } from "../website/config.mjs";
import { checkAdoptionPlan } from "./inspect.mjs";
import { checkImmutablePlan, immutablePhases } from "./immutable-plan.mjs";
import {
  beginRollout,
  pendingRollout,
  readRollout,
} from "./rollout-journal.mjs";
import { verifyAppliedOutcome } from "./rollout-reconcile.mjs";
import {
  downloadCurrentState,
  hcpConfiguration,
  hostname,
  inspectWorkspace,
  workspaceName,
} from "./hcp.mjs";

const terraformDirectory = fileURLToPath(
  new URL("./terraform/", import.meta.url),
);
const usage =
  "Usage: node infrastructure/production/terraform.mjs init|validate|status|export <new.tfstate>|plan <variables.tfvars.json> <new.tfplan>|show <saved.tfplan>|adopt <saved.tfplan> --confirm-ownership-handoff\n       rollout-begin <proposal.json>\n       legacy-retirement-begin <proposal.json> --confirm-legacy-cutover\n       rollout-reconcile <phase> <attempted.tfplan> <variables.tfvars.json> <observation.tfplan> [qualification.json]\n       immutable-plan <phase> <variables.tfvars.json> <new.tfplan> [phase-evidence.json]\n       immutable-apply <phase> <saved.tfplan> --confirm-immutable-change [phase-evidence.json]";

export const systemPath = "/usr/bin:/bin:/usr/sbin:/sbin";

export function resolveTerraform(environment) {
  const usable = (path) => {
    if (!path || !isAbsolute(path)) return false;
    const info = statSync(path, { throwIfNoEntry: false });
    return (
      info?.isFile() &&
      Boolean(info.mode & 0o111) &&
      !(info.mode & 0o022) &&
      [0, process.getuid()].includes(info.uid)
    );
  };

  if (environment.GITHUB_ACTIONS === "true") {
    // setup-terraform extracts the unwrapped binary directly into a runner temp subdirectory.
    const temp = environment.RUNNER_TEMP;
    if (temp && isAbsolute(temp)) {
      const root = realpathSync(temp);
      const info = statSync(root);
      if (
        !info.isDirectory() ||
        info.uid !== process.getuid() ||
        info.mode & 0o022
      )
        throw new Error(
          "Expected a runner-owned Terraform installation directory.",
        );
      const candidates = [];
      for (const name of readdirSync(root)) {
        if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name))
          continue;
        const entry = join(root, name);
        const directory = lstatSync(entry, { throwIfNoEntry: false });
        if (
          !directory?.isDirectory() ||
          directory.uid !== process.getuid() ||
          directory.mode & 0o022
        )
          continue;
        const binary = join(entry, "terraform");
        if (usable(binary) && realpathSync(binary) === binary)
          candidates.push(binary);
      }
      if (candidates.length === 1) return candidates[0];
    }
    throw new Error(
      "Expected one Terraform installation from setup-terraform in runner temp.",
    );
  }

  const explicit = environment.SITUATE_TERRAFORM_EXECUTABLE;
  const candidates =
    explicit === undefined
      ? [
          "/opt/homebrew/bin/terraform",
          "/usr/local/bin/terraform",
          "/usr/bin/terraform",
        ]
      : [explicit];
  const binary = candidates.find(usable);
  if (!binary)
    throw new Error(
      "Install Terraform in a standard location or set SITUATE_TERRAFORM_EXECUTABLE to a trusted absolute executable path.",
    );
  return realpathSync(binary);
}

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
    const result = spawnSync("/usr/bin/git", ["-C", parent, ...args], {
      env: { ...childEnvironment(), PATH: systemPath },
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
    deployment,
    directory = terraformDirectory,
    environment = process.env,
    execute = spawnSync,
    fetchImpl = fetch,
  } = {},
) {
  const [command] = args;
  const phase = args[1];
  const takesReceipt = args.length === 5;
  const legacyBegin =
    command === "legacy-retirement-begin" &&
    args.length === 3 &&
    args[2] === "--confirm-legacy-cutover";
  const rolloutBegin =
    (command === "rollout-begin" && args.length === 2) || legacyBegin;
  const immutablePlan =
    command === "immutable-plan" &&
    (args.length === 4 || takesReceipt) &&
    immutablePhases.includes(phase);
  const immutableApply =
    command === "immutable-apply" &&
    (args.length === 4 || takesReceipt) &&
    immutablePhases.includes(phase) &&
    args[3] === "--confirm-immutable-change";
  const reconcile =
    command === "rollout-reconcile" &&
    immutablePhases.includes(phase) &&
    (args.length === 5 || (phase === "stage" && args.length === 6));
  const needsProvider =
    immutablePlan ||
    immutableApply ||
    reconcile ||
    ["plan", "adopt"].includes(command);
  if (
    !immutablePlan &&
    !immutableApply &&
    !rolloutBegin &&
    !reconcile &&
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
  let receiptBytes;
  if (takesReceipt && (immutablePlan || immutableApply)) {
    const receiptPath = resolve(args[4]);
    privateFile(receiptPath);
    receiptBytes = readFileSync(receiptPath);
  }
  const oldMask = process.umask(0o077);
  try {
    const needsHcp = command !== "validate" && command !== "show";
    const names = needsHcp
      ? ["TF_CLOUD_ORGANIZATION", "TF_TOKEN_app_terraform_io"]
      : [];
    if (needsProvider) names.push("HCLOUD_TOKEN");
    const config = names.length ? configuration(names, environment) : {};
    const env = {
      ...childEnvironment(environment),
      PATH: systemPath,
      TF_IN_AUTOMATION: "1",
      TF_INPUT: "0",
    };
    const hcp = needsHcp ? hcpConfiguration(config) : null;
    if (hcp) {
      env.TF_CLOUD_ORGANIZATION = hcp.organization;
      env.TF_TOKEN_app_terraform_io = hcp.token;
      env.TF_WORKSPACE = workspaceName;
    }
    if (needsProvider) {
      if (!config.HCLOUD_TOKEN)
        throw new Error(
          "Set HCLOUD_TOKEN before planning or adopting production resources.",
        );
      env.HCLOUD_TOKEN = config.HCLOUD_TOKEN;
    }
    let executable;
    function run(parameters, capture = false) {
      executable ??= resolveTerraform(environment);
      const init = parameters[0] === "init";
      const result = execute(executable, parameters, {
        cwd: directory,
        env,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: capture || init ? ["ignore", "pipe", "pipe"] : "inherit",
        ...(init ? { timeout: 180_000, killSignal: "SIGKILL" } : {}),
      });
      if (result.error || result.status !== 0) {
        if (init) {
          if (result.error?.code === "ETIMEDOUT") {
            const lines = String(result.stdout ?? "").split(/\r?\n/);
            const stage = lines.some(
              (line) => line.trim() === "Initializing provider plugins...",
            )
              ? "provider initialization"
              : lines.some(
                    (line) => line.trim() === "Initializing HCP Terraform...",
                  )
                ? "HCP backend initialization"
                : "before reporting an initialization phase";
            throw new Error(`Terraform init timed out during ${stage}.`);
          }
          const outcome = result.error
            ? "could not start"
            : result.signal
              ? `signal ${result.signal}`
              : `exit ${result.status}`;
          throw new Error(`Terraform init failed (${outcome}).`);
        }
        throw new Error(
          "Terraform failed. Inspect HCP state and pending operations before retrying; no automatic retry was attempted.",
        );
      }
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
      run(["init", "-no-color", "-input=false", "-lockfile=readonly"]);
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
      const raw = await downloadCurrentState(hcp, snapshot, fetchImpl);
      let state;
      try {
        state = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new Error("HCP Terraform state download returned invalid JSON.");
      }
      if (
        state?.version !== 4 ||
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
    if (rolloutBegin) {
      const input = resolve(args[1]);
      privateFile(input);
      const root = environment.SITUATE_ROLLOUT_DIRECTORY;
      if (!root)
        throw new Error(
          "Set SITUATE_ROLLOUT_DIRECTORY to the durable journal directory.",
        );
      privateDestination(join(root, ".check-location.json"), ".json");
      const operation = beginRollout(
        environment.SITUATE_ROLLOUT_DIRECTORY,
        target,
        JSON.parse(readFileSync(input, "utf8")),
        legacyBegin,
      );
      console.log(`Rollout ${operation.id} recorded.`);
      return;
    }
    if (command === "export") {
      const destination = privateDestination(args[1], ".tfstate");
      if (!target.stateVersion)
        throw new Error("The HCP workspace has no state to export.");
      await exportState(destination, target);
      console.log(`Private state export: ${destination}`);
      return;
    }
    if (reconcile) {
      const root = environment.SITUATE_ROLLOUT_DIRECTORY;
      if (!root)
        throw new Error(
          "Set SITUATE_ROLLOUT_DIRECTORY to the durable journal directory.",
        );
      privateDestination(join(root, ".check-location.json"), ".json");
      const pending = pendingRollout(root, target, phase);
      const attempted = savedPlan(args[2]);
      checkPlanBackend(attempted, pending.before);
      const planHash = digest(attempted);
      if (planHash !== pending.planSha256)
        throw new Error("The saved plan does not match the pending operation.");
      const operation = readRollout(
        root,
        pending.before,
        phase,
        pending.evidence,
      );
      const original = JSON.parse(run(["show", "-json", attempted], true));
      let qualification;
      if (args[5]) {
        privateFile(resolve(args[5]));
        qualification = readFileSync(resolve(args[5]));
      }
      checkImmutablePlan(original, phase, qualification, operation);
      const variables = resolve(args[3]);
      if (!variables.endsWith(".tfvars.json"))
        throw new Error("Use a private .tfvars.json inventory file.");
      privateFile(variables);
      const observation = privateDestination(args[4], ".tfplan");
      run([
        "plan",
        "-input=false",
        "-lock-timeout=30s",
        `-var-file=${variables}`,
        `-out=${observation}`,
      ]);
      verifyAppliedOutcome(
        original,
        JSON.parse(run(["show", "-json", observation], true)),
      );
      const current = await inspect();
      if (!same(current, target))
        throw new Error("HCP state changed during reconciliation.");
      operation.acknowledge(planHash, current);
      console.log("Confirmed the attempted phase without replaying it.");
      return;
    }
    const usesJournal =
      (immutablePlan || immutableApply) &&
      Boolean(environment.SITUATE_ROLLOUT_DIRECTORY);
    if (usesJournal)
      privateDestination(
        join(environment.SITUATE_ROLLOUT_DIRECTORY, ".check-location.json"),
        ".json",
      );
    const operation =
      deployment ??
      (usesJournal
        ? readRollout(
            environment.SITUATE_ROLLOUT_DIRECTORY,
            target,
            phase,
            phase === "stage" || !receiptBytes
              ? undefined
              : JSON.parse(receiptBytes),
          )
        : undefined);
    if (
      (immutablePlan || immutableApply) &&
      !deployment &&
      !usesJournal &&
      !["stage", "attach", "traffic"].includes(phase)
    )
      throw new Error("This phase requires the production rollout journal.");
    const checkPlan = (path) => {
      const plan = JSON.parse(run(["show", "-json", path], true));
      return immutablePlan || immutableApply
        ? checkImmutablePlan(
            plan,
            phase,
            phase === "stage" ? receiptBytes : undefined,
            operation,
          )
        : checkAdoptionPlan(plan);
    };
    if ((immutablePlan || immutableApply) && !target.stateVersion)
      throw new Error(
        "Adopt existing production ownership before using immutable operations.",
      );
    if (command === "plan" || immutablePlan) {
      const variables = resolve(args[immutablePlan ? 2 : 1]);
      if (!variables.endsWith(".tfvars.json"))
        throw new Error("Use a private .tfvars.json inventory file.");
      privateFile(variables);
      const output = privateDestination(args[immutablePlan ? 3 : 2], ".tfplan");
      if (pathExists(`${output}.state.json`))
        throw new Error("Private output files are never overwritten.");
      run([
        "plan",
        "-input=false",
        "-lock-timeout=30s",
        `-var-file=${variables}`,
        `-out=${output}`,
      ]);
      const checked = checkPlan(output);
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
        immutablePlan
          ? `${checked} resource changes allowed for ${phase}. Review plan: ${output}`
          : `${checked.resources} resources, ${checked.imports} imports, no resource changes. Plan: ${output}`,
      );
      return;
    }
    const plan = savedPlan(args[immutableApply ? 2 : 1]);
    checkPlanBackend(plan, target);
    checkPlan(plan);
    const action = immutableApply ? phase : "adoption";
    const journal = privateDestination(`${plan}.${action}.json`, ".json");
    const prefix = `${plan}.${new Date().toISOString().replaceAll(":", "-")}`;
    await exportState(`${prefix}.before.tfstate`, target);
    if (!same(await inspect(), target))
      throw new Error(
        "The HCP workspace or state changed before apply; generate a new plan.",
      );
    writeFileSync(
      journal,
      JSON.stringify({
        target,
        operation: action,
        sha256: digest(plan),
        startedAt: new Date().toISOString(),
      }) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    operation?.beginApply?.(digest(plan));
    let after;
    try {
      run(["apply", "-input=false", "-lock-timeout=30s", plan]);
    } finally {
      after = await inspect();
      await exportState(`${prefix}.after.tfstate`, after);
    }
    operation?.complete?.(after);
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
