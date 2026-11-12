import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  statSync,
  lstatSync,
  readdirSync,
  writeFileSync,
  globSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { readImageLock, root } from "./ci-image.mjs";
import { browserShards, linuxShards } from "./ci-shard.mjs";

const shardNames = ["quick", ...linuxShards, "history"];
const metadata = [
  "GITHUB_REPOSITORY",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "PR_NUMBER",
  "HEAD_SHA",
  "MAIN_SHA",
  "SIDE",
  "PREPARATION_STATUS",
];
export function inside(workspace, path) {
  const name = relative(workspace, path);
  if (name === ".." || name.startsWith(`..${sep}`) || isAbsolute(name))
    throw new Error("CI paths must stay inside the checkout workspace.");
  return name ? `/workspace/${name.split(sep).join("/")}` : "/workspace";
}
export function visualDependencyPaths(directory) {
  const client = resolve(directory, "client");
  const { workspaces } = JSON.parse(
    readFileSync(resolve(client, "package.json"), "utf8"),
  );
  return [
    "client/node_modules",
    ...globSync(workspaces, { cwd: client })
      .filter((path) => existsSync(resolve(client, path, "package.json")))
      .map((path) => `client/${path}/node_modules`),
  ];
}
export function containerArguments({
  workspace,
  harness,
  source,
  cache,
  lock,
  shard,
  environment = {},
  uid,
  gid,
  name,
  token,
  rust,
  visual,
  project,
  grep,
  dependencyPaths = ["client/node_modules"],
}) {
  if (!shardNames.includes(shard) && !["coverage", "visual"].includes(shard))
    throw new Error("Unknown container test shard.");
  if (!Number.isInteger(uid) || uid < 1 || !Number.isInteger(gid) || gid < 0)
    throw new Error("Run CI containers as a non-root host user.");
  if (!/^\d+\.\d+\.\d+$/.test(rust))
    throw new Error("CI requires an exact Rust toolchain version.");
  inside(workspace, harness);
  inside(workspace, source);
  const target = shard === "coverage" ? "/workspace/harness" : "/workspace";
  const args = [
    "run",
    "--rm",
    "--init",
    "--name",
    name,
    "--label",
    `dev.situate.ci-run=${token}`,
    "--platform",
    lock.platform,
    "--user",
    `${uid}:${gid}`,
    "--shm-size=2g",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--mount",
    `type=bind,src=${harness},dst=${target}`,
    "--mount",
    `type=bind,src=${cache},dst=/ci-cache`,
    "--workdir",
    shard === "coverage" ? "/workspace" : target,
  ];
  const env = {
    CI: "true",
    HOME: "/tmp/situate-ci-home",
    CARGO_HOME: "/ci-cache/cargo",
    npm_config_cache: "/ci-cache/npm",
    RUSTUP_TOOLCHAIN: rust,
    LIBGL_ALWAYS_SOFTWARE: "1",
    WEBKIT_DISABLE_DMABUF_RENDERER: "1",
    CARGO_INCREMENTAL: "0",
    PLAYWRIGHT_BROWSERS_PATH: "/ci-cache/browsers",
    SITUATE_CI_IMAGE: lock.image,
  };
  if (shard !== "coverage") {
    env.CARGO_PROFILE_DEV_DEBUG = "line-tables-only";
    env.CARGO_PROFILE_TEST_DEBUG = "line-tables-only";
  }
  if (shard === "coverage") {
    args.push(
      "--mount",
      `type=bind,src=${source},dst=/workspace/source`,
      "--mount",
      `type=bind,src=${resolve(workspace, "report.json")},dst=/workspace/report.json`,
    );
    env.PREPARATION_STATUS = "success";
    for (const key of metadata)
      if (environment[key] !== undefined) env[key] = environment[key];
    if (environment.GITHUB_STEP_SUMMARY) {
      args.push(
        "--mount",
        `type=bind,src=${environment.GITHUB_STEP_SUMMARY},dst=/ci-step-summary`,
      );
      env.GITHUB_STEP_SUMMARY = "/ci-step-summary";
    }
  }
  if (shard === "visual") env.SITUATE_VISUAL_GREP = grep ?? "";
  if (shard === "quick" || linuxShards.includes(shard)) {
    if (environment.SITUATE_CI_SELECTION !== undefined)
      env.SITUATE_CI_SELECTION = environment.SITUATE_CI_SELECTION;
  }
  for (const [key, value] of Object.entries(env))
    args.push("--env", `${key}=${value}`);
  const setup =
    'mkdir -p "$HOME" "$CARGO_HOME" "$npm_config_cache"; source /opt/ci-tools/ci-user.sh; git -C /tmp config --global --add safe.directory /workspace; df -h /workspace /ci-cache;';
  let script;
  if (shard === "coverage") {
    const sourcePath = "/workspace/source";
    script = `${setup}\ngit config --global --add safe.directory "$1"; git config --global --add safe.directory "$2";\nif test "$PREPARATION_STATUS" != failure && test "$PREPARATION_STATUS" != cancelled && test -f "$1/tools/test.mjs" && grep -q -- --coverage "$1/tools/test.mjs"; then\n  if ! npm ci --prefix "$1/client"; then export PREPARATION_STATUS=failure; fi\nfi\nnode "$2/tools/coverage.mjs" "$1";`;
    args.push(
      lock.image,
      "bash",
      "-eu",
      "-o",
      "pipefail",
      "-c",
      script,
      "ci",
      sourcePath,
      target,
    );
  } else if (shard === "visual") {
    if (!["check", "update"].includes(visual))
      throw new Error("--visual must be check or update.");
    if (visual === "update" && environment.CI)
      throw new Error("Update visual baselines locally, not in CI.");
    if (project && !["desktop", "mobile"].includes(project))
      throw new Error("--project must be desktop or mobile.");
    // Linux dependencies must not replace a worktree's host-native installation.
    for (const path of dependencyPaths)
      args.push(
        "--tmpfs",
        `${inside(workspace, resolve(harness, path))}:exec,mode=1777`,
      );
    script = `${setup}\nnpm ci --prefix client; node client/node_modules/playwright/cli.js install chromium; cd client; exec node node_modules/@playwright/test/cli.js test --config app/playwright.visual.config.ts "$@"`;
    args.push(
      lock.image,
      "bash",
      "-eu",
      "-o",
      "pipefail",
      "-c",
      script,
      "visual",
      `--update-snapshots=${visual === "update" ? "changed" : "none"}`,
    );
    if (project !== undefined) args.push("--project", project);
  } else if (shard === "history") {
    args.push(
      lock.image,
      "bash",
      "-eu",
      "-o",
      "pipefail",
      "-c",
      `${setup}\nexec gitleaks git . --redact --config .gitleaks.toml`,
    );
  } else {
    const installs =
      shard === "quick"
        ? "npm ci; npm ci --prefix client; npm ci --prefix requirements;"
        : shard === "checks"
          ? "npm ci; npm ci --prefix client; npm ci --prefix requirements; (cd client && cargo fetch --locked);"
          : browserShards.includes(shard)
            ? "npm ci --prefix client; npm ci --prefix requirements; node client/node_modules/playwright/cli.js install chromium webkit; node requirements/node_modules/playwright/cli.js install chromium;"
            : "npm ci --prefix client;";
    script = `{ ${setup}\n${installs}\n} >&2\nexec node tools/ci-shard.mjs --shard "$1" --timeout 1800 --json`;
    args.push(
      lock.image,
      "bash",
      "-eu",
      "-o",
      "pipefail",
      "-c",
      script,
      "ci",
      shard,
    );
  }
  return args;
}
export function validateCacheDirectory(cache, workspace, home = homedir()) {
  const contains = (parent, child) => {
    const path = relative(parent, child);
    return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  };
  if (
    contains(cache, home) ||
    contains(cache, workspace) ||
    contains(workspace, cache)
  )
    throw new Error(
      "Use a dedicated cache outside the checkout, not a host home or shared parent directory.",
    );
  if (
    readdirSync(cache).some(
      (name) => !["npm", "cargo", "browsers"].includes(name),
    )
  )
    throw new Error("The CI cache directory contains unrelated files.");
}
export function cleanupOwnedContainer(name, token, run = spawnSync) {
  const options = {
    encoding: "utf8",
    timeout: 3000,
    killSignal: "SIGKILL",
    maxBuffer: 4096,
  };
  const inspected = run(
    "docker",
    [
      "inspect",
      "--format",
      '{{index .Config.Labels "dev.situate.ci-run"}}',
      name,
    ],
    options,
  );
  if (inspected.error)
    return new Error("Could not verify CI container ownership during cleanup.");
  if (inspected.status !== 0) {
    if (/No such (?:object|container)/i.test(inspected.stderr ?? ""))
      return null;
    return new Error("Could not inspect the CI container during cleanup.");
  }
  if (inspected.stdout.trim() !== token)
    return new Error("Refusing to remove a container with a different owner.");
  const removed = run("docker", ["rm", "--force", name], options);
  return removed.status === 0
    ? null
    : new Error("Could not remove the owned CI container.");
}
async function main() {
  const { values } = parseArgs({
    options: {
      shard: { type: "string" },
      coverage: { type: "string" },
      visual: { type: "string" },
      project: { type: "string" },
      grep: { type: "string" },
    },
    strict: true,
  });
  if (
    [values.shard, values.coverage, values.visual].filter(Boolean).length !== 1
  )
    throw new Error(
      `Choose --shard ${shardNames.join("|")}, --coverage <source-directory>, or --visual check|update.`,
    );
  if (
    !values.visual &&
    (values.project !== undefined || values.grep !== undefined)
  )
    throw new Error("--project and --grep require --visual.");
  const workspace = realpathSync(process.cwd());
  const harness = realpathSync(root);
  inside(workspace, harness);
  const source = values.coverage
    ? realpathSync(resolve(workspace, values.coverage))
    : harness;
  if (
    !values.visual &&
    (!existsSync(resolve(source, ".git")) ||
      !statSync(resolve(source, ".git")).isDirectory())
  )
    throw new Error(
      "Use a regular checkout with its .git directory inside the workspace, not a linked worktree.",
    );
  const cachePath =
    process.env.CI_CACHE_DIR ||
    (process.env.RUNNER_TEMP &&
      resolve(process.env.RUNNER_TEMP, "situate-downloads"));
  if (
    !cachePath ||
    !isAbsolute(cachePath) ||
    cachePath.includes(",") ||
    workspace.includes(",")
  )
    throw new Error(
      "Set CI_CACHE_DIR to a dedicated absolute cache directory; Docker mount paths cannot contain commas.",
    );
  mkdirSync(cachePath, { recursive: true });
  const cache = realpathSync(cachePath);
  validateCacheDirectory(cache, workspace);
  const rust = readFileSync(
    resolve(harness, "client/rust-toolchain.toml"),
    "utf8",
  ).match(/channel\s*=\s*"([^"]+)"/)?.[1];
  const token = randomUUID();
  const name = `situate-ci-${token}`;
  const args = containerArguments({
    workspace,
    harness,
    source,
    cache,
    lock: readImageLock(harness),
    shard: values.coverage
      ? "coverage"
      : values.visual
        ? "visual"
        : values.shard,
    visual: values.visual,
    project: values.project,
    grep: values.grep,
    dependencyPaths: values.visual ? visualDependencyPaths(harness) : undefined,
    environment: process.env,
    uid: process.getuid?.(),
    gid: process.getgid?.(),
    name,
    token,
    rust,
  });
  if (values.coverage) {
    if (
      process.env.GITHUB_STEP_SUMMARY &&
      !lstatSync(process.env.GITHUB_STEP_SUMMARY).isFile()
    )
      throw new Error("The step summary must be a regular file.");
    writeFileSync(resolve(workspace, "report.json"), "", { flag: "wx" });
  }
  const child = spawn("docker", args, { stdio: "inherit" });
  const signals = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  let interrupted;
  let escalation;
  const errors = [];
  const listeners = Object.entries(signals).map(([signal, code]) => {
    const listener = () => {
      interrupted = code;
      child.kill(signal);
      clearTimeout(escalation);
      escalation = setTimeout(
        () => {
          const error = cleanupOwnedContainer(name, token);
          if (error) errors.push(error);
          child.kill("SIGKILL");
        },
        signal === "SIGINT" ? 1000 : 0,
      );
    };
    process.on(signal, listener);
    return [signal, listener];
  });
  try {
    const code = await new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("exit", (status) => accept(status ?? 1));
    });
    process.exitCode = interrupted ?? code;
    spawnSync("df", ["-h", workspace, cache], {
      stdio: ["ignore", 2, 2],
      timeout: 3000,
    });
    if (existsSync(resolve(source, "client/target")))
      spawnSync("du", ["-sh", resolve(source, "client/target")], {
        stdio: ["ignore", 2, 2],
        timeout: 3000,
      });
  } catch (error) {
    errors.push(error);
  } finally {
    for (const [signal, listener] of listeners) process.off(signal, listener);
    clearTimeout(escalation);
    const cleanupError = cleanupOwnedContainer(name, token);
    if (cleanupError) errors.push(cleanupError);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "CI execution and cleanup failed.");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main().catch((error) => {
    console.error(error);
    process.exitCode ||= 1;
  });
