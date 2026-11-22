import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withSigningCertificate } from "../client/scripts/apple-credentials.mjs";
import {
  trustedReleaseCacheHost,
  releaseCachePaths,
} from "./release-build-cache.mjs";
import { readOperation } from "./pipeline-state.mjs";

const repository = "getsituate/situate";
const positive = /^[1-9][0-9]*$/;
const digest = (value) => createHash("sha256").update(value).digest("hex");
export function requireProvisioned(env, workflow) {
  const automatic = env.GITHUB_EVENT_NAME === "push";
  const expectedPath = automatic ? "release-macos" : "publish-macos";
  if (
    env.PIPELINE_RELEASE_ENABLED !== "true" ||
    env.GITHUB_REF_PROTECTED !== "true" ||
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_WORKFLOW_REF !==
      `${repository}/.github/workflows/${expectedPath}.yml@refs/heads/main` ||
    !(
      automatic ||
      (workflow === "publish" && env.GITHUB_EVENT_NAME === "workflow_dispatch")
    )
  )
    throw new Error(
      "Release automation is blocked: attested provisioning, protected main and the exact trusted workflow are required.",
    );
}
function stateDirectory(env, workflow, create = false) {
  if (
    !positive.test(env.GITHUB_RUN_ID ?? "") ||
    !positive.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
    !isAbsolute(env.RUNNER_TEMP ?? "")
  )
    throw new Error("Invalid release runner identity.");
  const path = join(
    resolve(env.RUNNER_TEMP),
    `situate-${workflow}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
  );
  if (create) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid()
  )
    throw new Error("Release state must be an owned private directory.");
  return path;
}
function privateJson(path, value) {
  writeFileSync(
    path,
    typeof value === "string" ? value : JSON.stringify(value),
    { mode: 0o600, flag: "wx" },
  );
}
export function configureRelease(env, workflow) {
  requireProvisioned(env, workflow);
  const bytes = env.SITUATE_RELEASE_CONFIG_JSON;
  if (
    typeof bytes !== "string" ||
    !/^[a-f0-9]{64}$/.test(env.SITUATE_RELEASE_CONFIG_SHA256 ?? "") ||
    digest(bytes) !== env.SITUATE_RELEASE_CONFIG_SHA256
  )
    throw new Error(
      "Private release configuration does not match its provisioning attestation.",
    );
  let config;
  try {
    config = JSON.parse(bytes);
  } catch {
    throw new Error("Private release configuration must contain valid JSON.");
  }
  if (config?.schemaVersion !== 1 || !env.WEBSITE_DEPLOY_HOST)
    throw new Error(
      "Private configuration requires schema version 1 and an explicit destination.",
    );
  const state = stateDirectory(env, workflow, true);
  const configuration = join(state, "configuration.json");
  privateJson(configuration, bytes);
  return { state, configuration };
}
function jsonCommand(execute, args, environment) {
  return JSON.parse(
    execute(
      process.execPath,
      ["tools/pipeline.mjs", ...args],
      environment ? { env: environment } : undefined,
    ),
  );
}
function readJson(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid()
  )
    throw new Error("Release inputs must be owned private regular files.");
  return JSON.parse(readFileSync(path, "utf8"));
}
export async function prepareCreate(env, execute, validateSourcePlan) {
  const sourcePlan = JSON.parse(env.PIPELINE_PLAN);
  const receipts = await validateSourcePlan(
    sourcePlan,
    JSON.parse(env.PIPELINE_NEEDS),
  );
  const { state, configuration } = configureRelease(env, "create");
  const original = join(state, "verification-plan.json");
  privateJson(original, sourcePlan);
  privateJson(join(state, "receipts.json"), receipts);
  const plan = jsonCommand(
    execute,
    [
      "plan",
      "create",
      "--source",
      sourcePlan.source,
      "--base",
      sourcePlan.base,
      "--verification-plan",
      original,
      "--operation",
      `actions-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
      "--destination",
      env.WEBSITE_DEPLOY_HOST,
      "--configuration",
      configuration,
    ],
    { ...env, PIPELINE_FRESH_RELEASE: "1" },
  );
  if (
    plan.workflow !== "create" ||
    plan.verificationPlan?.authorizationDigest !==
      sourcePlan.authorizationDigest ||
    plan.source !== sourcePlan.source ||
    JSON.stringify(plan.lanes) !== JSON.stringify(sourcePlan.lanes)
  )
    throw new Error(
      "Final creation plan differs from the verified source plan.",
    );
  privateJson(join(state, "plan.json"), plan);
  return { state, operation: plan.operation };
}
export function stageEnvironment(env, workflow, stage) {
  const names = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "USER",
    "LOGNAME",
    "VOLTA_HOME",
    "CI",
    "CARGO_HOME",
    "RUSTUP_HOME",
    "DEVELOPER_DIR",
    "SDKROOT",
    "RUNNER_TEMP",
    "RUNNER_OS",
    "RUNNER_ARCH",
    "RUNNER_ENVIRONMENT",
    "ImageOS",
    "ImageVersion",
    "GITHUB_ACTIONS",
    "GITHUB_REPOSITORY",
    "GITHUB_SHA",
    "GITHUB_REF",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_WORKSPACE",
    "GITHUB_SERVER_URL",
    "GITHUB_API_URL",
    "GITHUB_GRAPHQL_URL",
  ];
  if (workflow === "publish" || ["inputs", "github"].includes(stage))
    names.push("GH_TOKEN");
  if (
    workflow === "publish" ||
    ["inputs", "build", "qualify", "github"].includes(stage)
  )
    names.push(
      "SITUATE_RELEASE_SSH_PRIVATE_KEY",
      "SITUATE_RELEASE_SSH_KNOWN_HOSTS",
      "WEBSITE_SSH_IDENTITY",
      "WEBSITE_SSH_KNOWN_HOSTS",
    );
  if (workflow === "publish")
    names.push("SITUATE_UPDATER_PUBLIC_KEY", "APPLE_TEAM_ID");
  if (stage === "build")
    names.push(
      "APPLE_TEAM_ID",
      "APPLE_MACOS_SIGNING_IDENTITY",
      "APPLE_DEVELOPER_ID_P12_FILE",
      "APPLE_DEVELOPER_ID_P12_BASE64",
      "APPLE_DEVELOPER_ID_P12_PASSWORD",
      "APPLE_API_KEY",
      "APPLE_API_ISSUER",
      "APPLE_API_PRIVATE_KEY",
      "SITUATE_UPDATER_PUBLIC_KEY",
      "SITUATE_UPDATER_ENDPOINT",
      "TAURI_SIGNING_PRIVATE_KEY",
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    );
  const cacheEnabled =
    workflow === "create" &&
    stage === "build" &&
    env.SITUATE_RELEASE_BUILD_CACHE === "1" &&
    trustedReleaseCacheHost(env);
  if (cacheEnabled)
    names.push(
      "SITUATE_RELEASE_BUILD_CACHE",
      "SITUATE_RELEASE_CACHE_SOCKET",
      "GITHUB_REF_PROTECTED",
      "GITHUB_EVENT_NAME",
      "GITHUB_WORKFLOW_REF",
    );
  const environment = Object.fromEntries(
    names
      .filter((name) => Object.hasOwn(env, name))
      .map((name) => [name, env[name]]),
  );
  if (cacheEnabled) environment.CARGO_HOME = releaseCachePaths(env).cargoHome;
  return environment;
}
export async function runReleaseStage(
  env,
  workflow,
  stage,
  execute,
  root = fileURLToPath(new URL("../", import.meta.url)),
) {
  requireProvisioned(env, workflow);
  const state = stateDirectory(env, workflow);
  const plan = readJson(join(state, "plan.json"));
  if (plan.workflow !== workflow || plan.repository !== repository)
    throw new Error("Release workflow identity differs from the sealed plan.");
  const args = [
    stage ? "stage" : "run",
    workflow,
    "--plan",
    join(state, "plan.json"),
    "--confirm",
    plan.authorizationDigest,
  ];
  if (workflow === "create")
    args.push("--receipts", join(state, "receipts.json"));
  if (stage) {
    if (
      !["inputs", "build", "qualify", "github"].includes(stage) ||
      workflow !== "create"
    )
      throw new Error("Unsupported hosted release stage.");
    args.push("--stage", stage);
  }
  const environment = stageEnvironment(env, workflow, stage);
  environment.PIPELINE_FRESH_RELEASE = "1";
  if (workflow === "create" && stage === "inputs")
    Object.assign(environment, {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "credential.https://github.com.helper",
      GIT_CONFIG_VALUE_1: "!gh auth git-credential",
    });
  const launch = async (environment) => {
    await execute(process.execPath, ["tools/pipeline.mjs", ...args], {
      stdio: "inherit",
      env: environment,
    });
  };
  if (
    stage === "build" &&
    (environment.APPLE_DEVELOPER_ID_P12_BASE64 ||
      environment.APPLE_DEVELOPER_ID_P12_FILE)
  )
    return withSigningCertificate(
      {
        root: fileURLToPath(new URL("../client", import.meta.url)),
        environment,
      },
      launch,
    );
  await launch(environment);
  if (stage === "github") {
    const operation = readOperation(root, plan.operation);
    const completed = operation.stages.at(-1);
    const releaseId = String(completed?.output?.releaseId ?? "");
    if (
      operation.status !== "paused" ||
      operation.stages.some(({ status }) => status !== "passed") ||
      operation.plan.authorizationDigest !== plan.authorizationDigest ||
      completed?.name !== "github" ||
      completed.status !== "passed" ||
      !positive.test(releaseId)
    )
      throw new Error("Missing completed GitHub Release identity.");
    return { release_id: releaseId };
  }
}
export async function prepareReleaseDependencies(
  directory,
  execute,
  { toolchainOnly = false } = {},
) {
  for (const target of toolchainOnly ? [] : [undefined, "client"])
    execute(
      process.execPath,
      ["tools/npm-ci.mjs", ...(target ? [target] : [])],
      { stdio: "inherit" },
    );
  const channel = readFileSync(
    join(directory, "client/rust-toolchain.toml"),
    "utf8",
  ).match(/channel\s*=\s*"([^"]+)"/)?.[1];
  if (!/^\d+\.\d+\.\d+$/.test(channel ?? ""))
    throw new Error("Missing pinned release Rust toolchain.");
  for (const [command, args] of [
    [
      "rustup",
      [
        "toolchain",
        "install",
        channel,
        "--profile",
        "minimal",
        "--component",
        "clippy",
        "--component",
        "rustfmt",
        "--component",
        "llvm-tools",
      ],
    ],
    [
      "rustup",
      [
        "target",
        "add",
        "--toolchain",
        channel,
        "aarch64-apple-darwin",
        "x86_64-apple-darwin",
      ],
    ],
    ...(!toolchainOnly
      ? [
          [
            "rustup",
            [
              "run",
              channel,
              "cargo",
              "fetch",
              "--locked",
              "--manifest-path",
              "client/Cargo.toml",
            ],
          ],
          ["xcodebuild", ["-version"]],
        ]
      : []),
  ])
    execute(
      process.execPath,
      ["tools/run-coordinated.mjs", "--", command, ...args],
      { stdio: "inherit" },
    );
}
export function preparePublish(env, execute) {
  requireProvisioned(env, "publish");
  const releaseId = env.PIPELINE_RELEASE_ID;
  if (!positive.test(releaseId ?? ""))
    throw new Error("Select an exact completed GitHub Release ID.");
  const { state, configuration } = configureRelease(env, "publish");
  const plan = jsonCommand(execute, [
    "plan",
    "publish",
    "--release-id",
    releaseId,
    "--operation",
    `publish-actions-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    "--destination",
    env.WEBSITE_DEPLOY_HOST,
    "--configuration",
    configuration,
  ]);
  if (
    plan.workflow !== "publish" ||
    String(plan.releaseId) !== releaseId ||
    plan.repository !== repository
  )
    throw new Error(
      "Publication plan differs from the exact selected release.",
    );
  if (env.GITHUB_EVENT_NAME === "push") {
    const identity = plan.release?.identity;
    const prefix = `actions-${env.GITHUB_RUN_ID}-`;
    if (
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
      identity?.sourceRevision !== env.GITHUB_SHA ||
      !identity?.operationId?.startsWith(prefix) ||
      !positive.test(identity.operationId.slice(prefix.length)) ||
      BigInt(identity.operationId.slice(prefix.length)) >
        BigInt(env.GITHUB_RUN_ATTEMPT)
    )
      throw new Error("Release evidence differs from its producer.");
  }
  privateJson(join(state, "plan.json"), plan);
  return { selected: true, state, release_id: releaseId };
}
