import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const repository = "getsituate/situate";
const positive = /^[1-9][0-9]*$/;
const digest = (value) => createHash("sha256").update(value).digest("hex");
export function requireProvisioned(env, workflow) {
  const expectedPath =
    workflow === "create" ? "release-macos" : "publish-macos";
  if (
    env.PIPELINE_RELEASE_ENABLED !== "true" ||
    env.GITHUB_REF_PROTECTED !== "true" ||
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_WORKFLOW_REF !==
      `${repository}/.github/workflows/${expectedPath}.yml@refs/heads/main` ||
    !(workflow === "create"
      ? env.GITHUB_EVENT_NAME === "push"
      : ["workflow_dispatch", "workflow_run"].includes(env.GITHUB_EVENT_NAME))
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
  const bytes = env.PIPELINE_CONFIGURATION_JSON;
  if (
    typeof bytes !== "string" ||
    !/^[a-f0-9]{64}$/.test(env.PIPELINE_CONFIGURATION_SHA256 ?? "") ||
    digest(bytes) !== env.PIPELINE_CONFIGURATION_SHA256
  )
    throw new Error(
      "Private release configuration does not match its provisioning attestation.",
    );
  const config = JSON.parse(bytes);
  if (
    config.schemaVersion !== 1 ||
    !config.recoveryEvidence ||
    !env.PIPELINE_DESTINATION
  )
    throw new Error(
      "Private configuration requires recovery evidence and an explicit destination.",
    );
  const state = stateDirectory(env, workflow, true);
  const configuration = join(state, "configuration.json");
  privateJson(configuration, bytes);
  return { state, configuration };
}
function jsonCommand(execute, args) {
  return JSON.parse(execute(process.execPath, ["tools/pipeline.mjs", ...args]));
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
  const plan = jsonCommand(execute, [
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
    env.PIPELINE_DESTINATION,
    "--configuration",
    configuration,
  ]);
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
  if (workflow === "publish")
    names.push("SITUATE_UPDATER_PUBLIC_KEY", "APPLE_TEAM_ID");
  if (stage === "build")
    names.push(
      "APPLE_TEAM_ID",
      "APPLE_MACOS_SIGNING_IDENTITY",
      "APPLE_DEVELOPER_ID_P12_FILE",
      "APPLE_DEVELOPER_ID_P12_PASSWORD",
      "APPLE_API_KEY",
      "APPLE_API_ISSUER",
      "APPLE_API_PRIVATE_KEY",
      "SITUATE_UPDATER_PUBLIC_KEY",
      "SITUATE_UPDATER_ENDPOINT",
      "TAURI_SIGNING_PRIVATE_KEY",
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    );
  return Object.fromEntries(
    names
      .filter((name) => Object.hasOwn(env, name))
      .map((name) => [name, env[name]]),
  );
}
export function runReleaseStage(env, workflow, stage, execute) {
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
  let certificateBytes;
  if (stage === "build" && env.APPLE_DEVELOPER_ID_P12_BASE64) {
    const encoded = env.APPLE_DEVELOPER_ID_P12_BASE64;
    if (env.APPLE_DEVELOPER_ID_P12_FILE)
      throw new Error(
        "Select either a Developer ID certificate file or its base64 input, not both.",
      );
    if (
      typeof encoded !== "string" ||
      encoded.length > 4 * Math.ceil((1024 * 1024) / 3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        encoded,
      )
    )
      throw new Error(
        "Developer ID certificate input must be canonical base64 of at most 1 MiB.",
      );
    certificateBytes = Buffer.from(encoded, "base64");
    if (
      !certificateBytes.length ||
      certificateBytes.length > 1024 * 1024 ||
      certificateBytes.toString("base64") !== encoded
    )
      throw new Error(
        "Developer ID certificate input must be canonical base64 of at most 1 MiB.",
      );
  }
  const environment = stageEnvironment(env, workflow, stage);
  if (workflow === "create" && stage === "inputs")
    Object.assign(environment, {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "credential.https://github.com.helper",
      GIT_CONFIG_VALUE_1: "!gh auth git-credential",
    });
  let credentials;
  let certificate;
  try {
    if (certificateBytes) {
      certificate = mkdtempSync(
        join(env.RUNNER_TEMP, "situate-signing-certificate-"),
      );
      const path = join(certificate, "developer-id.p12");
      writeFileSync(path, certificateBytes, { mode: 0o600, flag: "wx" });
      environment.APPLE_DEVELOPER_ID_P12_FILE = path;
    }
    if (
      workflow === "publish" ||
      ["inputs", "build", "github"].includes(stage)
    ) {
      const key = env.SITUATE_RELEASE_SSH_PRIVATE_KEY;
      const hosts = env.SITUATE_RELEASE_SSH_KNOWN_HOSTS;
      if (key || hosts) {
        if (
          [key, hosts].some(
            (value) =>
              typeof value !== "string" ||
              !value.trim() ||
              value.includes("\0") ||
              Buffer.byteLength(value) > 1024 * 1024,
          )
        )
          throw new Error(
            "SSH operations require both a private key and pinned known-host data.",
          );
        credentials = mkdtempSync(
          join(env.RUNNER_TEMP, "situate-operation-ssh-"),
        );
        const identity = join(credentials, "identity");
        const knownHosts = join(credentials, "known_hosts");
        privateJson(identity, key.endsWith("\n") ? key : `${key}\n`);
        privateJson(knownHosts, hosts.endsWith("\n") ? hosts : `${hosts}\n`);
        environment.WEBSITE_SSH_IDENTITY = identity;
        environment.WEBSITE_SSH_KNOWN_HOSTS = knownHosts;
      }
    }
    execute(process.execPath, ["tools/pipeline.mjs", ...args], {
      stdio: "inherit",
      env: environment,
    });
  } finally {
    try {
      if (credentials) rmSync(credentials, { recursive: true, force: true });
    } finally {
      if (certificate) rmSync(certificate, { recursive: true, force: true });
    }
  }
}
export async function prepareReleaseDependencies(directory, execute) {
  for (const target of [undefined, "client"])
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
  ])
    execute(
      process.execPath,
      ["tools/run-coordinated.mjs", "--", command, ...args],
      { stdio: "inherit" },
    );
}
export function resolveProducerRelease(event, execute) {
  const producer = event.workflow_run;
  if (
    !positive.test(String(producer?.id ?? "")) ||
    !positive.test(String(producer?.run_attempt ?? ""))
  )
    throw new Error("Missing exact producer run identity.");
  const api = (path, extra = []) =>
    JSON.parse(execute("gh", ["api", `repos/${repository}/${path}`, ...extra]));
  const run = api(
    `actions/runs/${producer.id}/attempts/${producer.run_attempt}`,
  );
  if (
    run.id !== producer.id ||
    run.run_attempt !== producer.run_attempt ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    run.path !== ".github/workflows/release-macos.yml" ||
    run.event !== "push" ||
    run.head_branch !== "main" ||
    run.conclusion !== "success" ||
    run.head_sha !== producer.head_sha ||
    !/^[a-f0-9]{40}$/.test(run.head_sha ?? "")
  )
    throw new Error("Untrusted release producer.");
  const jobs = api(
    `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
  );
  if (jobs.total_count !== jobs.jobs?.length)
    throw new Error("Incomplete producer job inventory.");
  const creator = jobs.jobs.filter(
    ({ name }) => name === "Create GitHub Release",
  );
  if (creator.length !== 1) throw new Error("Missing exact creator job.");
  if (creator[0].conclusion === "skipped") return null;
  if (creator[0].conclusion !== "success")
    throw new Error("Release creation did not succeed.");
  const pages = api("releases?per_page=100", ["--paginate", "--slurp"]);
  const releases = pages.flat();
  if (releases.length > 1000)
    throw new Error("Release inventory exceeds the supported lookup limit.");
  const matches = [];
  for (const release of releases.filter(
    ({ draft, published_at }) => !draft && published_at,
  )) {
    const assets =
      release.assets?.filter(({ name }) => name === "github-release.json") ??
      [];
    if (assets.length !== 1) continue;
    const asset = assets[0];
    if (
      !positive.test(String(asset.id)) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 1 ||
      asset.size > 1024 * 1024
    )
      throw new Error("Invalid GitHub Release identity evidence.");
    const evidence = api(`releases/assets/${asset.id}`, [
      "--header",
      "Accept: application/octet-stream",
    ]);
    if (
      evidence.identity?.operationId === `actions-${run.id}-${run.run_attempt}`
    ) {
      if (
        evidence.identity.repository !== repository ||
        evidence.identity.sourceRevision !== run.head_sha ||
        evidence.identity.tag !== release.tag_name
      )
        throw new Error("Release evidence differs from its producer.");
      matches.push(release);
    }
  }
  if (matches.length !== 1 || !positive.test(String(matches[0].id)))
    throw new Error("Expected one exact completed producer release.");
  return String(matches[0].id);
}
export function preparePublish(env, execute) {
  requireProvisioned(env, "publish");
  let releaseId = env.PIPELINE_RELEASE_ID;
  if (env.GITHUB_EVENT_NAME === "workflow_run")
    releaseId = resolveProducerRelease(
      JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")),
      execute,
    );
  if (releaseId === null) return { selected: false };
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
    env.PIPELINE_DESTINATION,
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
  privateJson(join(state, "plan.json"), plan);
  return { selected: true, state, release_id: releaseId };
}
