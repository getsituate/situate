import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { ordinaryEnvironment } from "./pipeline-environment.mjs";
import { aggregateReceipts, digest, validatePlan } from "./pipeline-state.mjs";
import { suiteInventory } from "./test.mjs";
import { verifySourceVerificationAttestation } from "./source-verification-attestation.mjs";
import {
  createSourceVerificationEvidence,
  MAX_SOURCE_EVIDENCE_BYTES,
  MAX_SOURCE_EVIDENCE_CANDIDATES,
  sanitizeSourceVerificationReceipts,
  selectSourceVerificationEvidence,
  validateSourceVerificationEvidence,
} from "./source-verification-evidence.mjs";

const repository = "getsituate/situate";
const repositoryId = 1455575895;
const workflowId = 417380313;
const workflowPath = ".github/workflows/verify.yml";
const maxArchive = MAX_SOURCE_EVIDENCE_BYTES + 1024 * 1024;
const maxMetadata = 2 * 1024 * 1024;
const revision = /^[a-f0-9]{40}$/;
const families = ["frontend", "rust", "browser", "macos-code", "macos-native"];
const artifactName = (attempt) => `source-verification-${attempt}`;
const executeDefault = (command, args, options) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: maxMetadata,
    ...options,
  });
  assert(!result.error && result.status === 0, "Evidence command failed");
  return result.stdout;
};
const positiveId = (value) => {
  assert(/^[1-9][0-9]{0,15}$/.test(String(value)));
  assert(Number.isSafeInteger(Number(value)));
  return Number(value);
};
const git = (root, execute, ...args) =>
  execute("git", args, { cwd: root }).trim();

function checkout(root, source, execute) {
  assert(revision.test(source));
  assert.equal(git(root, execute, "rev-parse", "HEAD"), source);
  assert.equal(
    git(root, execute, "status", "--porcelain", "--untracked-files=all"),
    "",
  );
  return localCommit(root, source, execute);
}

function localCommit(root, source, execute) {
  assert(revision.test(source));
  const [tree, parents = ""] = git(
    root,
    execute,
    "show",
    "--no-patch",
    "--format=%T%n%P",
    source,
    "--",
  ).split("\n");
  assert(revision.test(tree));
  const values = parents.split(" ").filter(Boolean);
  assert(values.length <= 2 && values.every((entry) => revision.test(entry)));
  return { tree, parents: values };
}

/** Capture after a successful runLane, or before preparation when considering reuse. */
export function captureLaneEvidence(
  root,
  { plan, lane: laneId, environment = process.env, execute = executeDefault },
) {
  try {
    validatePlan(plan);
    const lane = plan.lanes.find(({ id }) => id === laneId);
    assert(lane && families.includes(laneId));
    assert.equal(
      lane.host,
      process.platform === "darwin" ? "macos" : process.platform,
    );
    assert(["darwin", "linux"].includes(process.platform));
    assert(["arm64", "x64"].includes(process.arch));
    assert(environment.SITUATE_NATIVE_VM_CONFIG === undefined);
    if (
      laneId === "macos-native" &&
      environment.SITUATE_NATIVE_EXECUTOR !== "local"
    )
      assert(
        !existsSync(
          join(
            environment.HOME ?? homedir(),
            ".config/situate/native-test-vm.json",
          ),
        ),
      );
    assert(
      !environment.SITUATE_NATIVE_EXECUTOR ||
        environment.SITUATE_NATIVE_EXECUTOR === "local",
    );
    const source = checkout(root, plan.source, execute);
    let ociDigest = null;
    if (process.platform === "linux") {
      assert(
        environment.SITUATE_TOOL_CONTAINER === "1" && existsSync("/.dockerenv"),
      );
      const lock = JSON.parse(
        git(root, execute, "show", `${plan.source}:tools/ci-image.lock.json`),
      );
      assert(
        /^ghcr\.io\/getsituate\/situate-ci-linux@sha256:[a-f0-9]{64}$/.test(
          lock.image,
        ),
      );
      assert.equal(environment.SITUATE_CI_IMAGE, lock.image);
      ociDigest = lock.image.split("@")[1];
    }
    if (process.platform === "darwin")
      assert(environment.SITUATE_TOOL_CONTAINER !== "1");
    const host = {
      platform: process.platform,
      arch: process.arch,
      ImageOS: environment.ImageOS,
      ImageVersion: environment.ImageVersion,
      ociDigest,
    };
    for (const value of [host.ImageOS, host.ImageVersion])
      assert(
        typeof value === "string" &&
          /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value) &&
          !/^(unknown|latest|none|unset)$/i.test(value),
      );
    const runtime = ordinaryEnvironment(environment);
    const behaviorKeys = [
      "LANG",
      "LC_ALL",
      "TERM",
      "CARGO_NET_OFFLINE",
      "RUSTUP_TOOLCHAIN",
      "CARGO_INCREMENTAL",
      "CARGO_PROFILE_DEV_DEBUG",
      "CARGO_PROFILE_TEST_DEBUG",
      "LIBGL_ALWAYS_SOFTWARE",
      "WEBKIT_DISABLE_DMABUF_RENDERER",
      "SITUATE_NATIVE_EXECUTOR",
      "SITUATE_COMPILER_CACHE",
      "SITUATE_TOOL_BUILD_SLOTS",
      "LD_PRELOAD",
    ];
    const behavior = Object.fromEntries(
      behaviorKeys.map((key) => [key, runtime[key] ?? null]),
    );
    const probe = (command, args, cwd = root) => {
      const value = execute(command, args, {
        cwd,
        env: { ...runtime, RUSTUP_AUTO_INSTALL: "0" },
      }).trim();
      assert(value.length > 0 && value.length <= 8192);
      return value;
    };
    const pins = JSON.parse(
      git(root, execute, "show", `${plan.source}:package.json`),
    ).volta;
    assert(
      pins?.node === process.versions.node && typeof pins.npm === "string",
    );
    const tools = {
      node: process.versions.node,
      npm: probe("npm", ["--version"]),
      pins,
      parallelism: availableParallelism(),
    };
    assert.equal(tools.npm, pins.npm);
    if (["rust", "macos-code", "macos-native"].includes(laneId)) {
      tools.rustPin = git(
        root,
        execute,
        "show",
        `${plan.source}:client/rust-toolchain.toml`,
      );
      const channel = tools.rustPin.match(
        /^\s*channel\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m,
      )?.[1];
      assert(channel, "An exact Rust release pin is required");
      const cwd = join(root, "client");
      const rustc = probe("rustup", ["which", "rustc"], cwd);
      const cargo = probe("rustup", ["which", "cargo"], cwd);
      assert(isAbsolute(rustc) && isAbsolute(cargo));
      tools.rustc = probe(rustc, ["--version", "--verbose"], cwd);
      assert.equal(tools.rustc.match(/^release: ([^\r\n]+)$/m)?.[1], channel);
      tools.cargo = probe(cargo, ["--version"], cwd);
      assert(/^cargo \d+\.\d+\.\d+\b/.test(tools.cargo));
    }
    if (process.platform === "darwin") {
      tools.xcode = probe("xcodebuild", ["-version"]);
      tools.sdk = probe("xcrun", ["--sdk", "macosx", "--show-sdk-version"]);
    }
    const files = git(
      root,
      execute,
      "ls-tree",
      "-r",
      "--name-only",
      plan.source,
      "--",
    ).split("\n");
    const inventory = suiteInventory(files, process.platform);
    const normalized = (value) =>
      value === process.execPath
        ? "$NODE"
        : isAbsolute(value)
          ? (() => {
              const path = relative(resolve(root), value);
              assert(path && !path.startsWith("..") && !isAbsolute(path));
              return `$ROOT/${path}`;
            })()
          : value;
    const contract = {
      schemaVersion: 1,
      toolsDigest: digest({
        tree: source.tree,
        tools,
        behavior,
        host,
        profile: "supported",
        jobs: 1,
      }),
      suites: lane.suites.map((id) => {
        const suite = inventory.find((entry) => entry.id === id);
        assert(suite);
        assert(!isAbsolute(suite.cwd) && !suite.cwd.split("/").includes(".."));
        return {
          id,
          commandDigest: digest({
            ...suite,
            covers: undefined,
            command: normalized(suite.command),
            args: suite.args.map(normalized),
            timeoutSeconds: lane.timeoutSeconds ?? 600,
            features: {
              execution:
                lane.execution ??
                (lane.host === "macos" ? "native" : "container"),
            },
          }),
        };
      }),
    };
    checkout(root, plan.source, execute);
    return {
      host,
      contract,
      checkout: { before: "clean", after: "clean", cleanup: "complete" },
    };
  } catch {
    return null;
  }
}

async function boundedBody(response, limit) {
  const length = response.headers.get("content-length");
  if (length !== null) assert(/^\d+$/.test(length) && Number(length) <= limit);
  assert(response.body);
  const bytes = Buffer.alloc(limit);
  let size = 0;
  for await (const chunk of response.body) {
    assert(
      size + chunk.length <= limit,
      "Evidence response exceeds size limit",
    );
    bytes.set(chunk, size);
    size += chunk.length;
  }
  return bytes.subarray(0, size);
}

/** Only repository-relative GET endpoints; authorization never follows a redirect. */
export function createSourceVerificationApi({
  token,
  fetchImpl = fetch,
  signal = AbortSignal.timeout(60_000),
} = {}) {
  return async (endpoint, { raw = false, maxBytes = maxMetadata } = {}) => {
    const association =
      typeof endpoint === "string" &&
      !/\s/.test(endpoint) &&
      /^\/commits\/[a-f0-9]{40}\/pulls\?per_page=100$/.test(endpoint);
    assert(
      typeof endpoint === "string" &&
        (/^\/(actions|git|contents)\//.test(endpoint) || association) &&
        !endpoint.includes("..") &&
        !/[\\#]/.test(endpoint),
    );
    assert(
      Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= maxMetadata,
    );
    const url = new URL(
      `https://api.github.com/repos/${repository}${endpoint}`,
    );
    assert.equal(url.origin, "https://api.github.com");
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "situate-source-verification",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    let response = await fetchImpl(url, {
      method: "GET",
      headers,
      redirect: "manual",
      signal,
    });
    if (
      response.status === 302 &&
      raw &&
      /^\/actions\/artifacts\/[1-9][0-9]*\/zip$/.test(endpoint)
    ) {
      const location = new URL(response.headers.get("location"));
      assert(
        location.protocol === "https:" &&
          !location.username &&
          !location.password &&
          !location.port,
      );
      assert(/^[a-z0-9-]+\.blob\.core\.windows\.net$/.test(location.hostname));
      await response.body?.cancel();
      response = await fetchImpl(location, {
        method: "GET",
        headers: { Accept: "application/octet-stream" },
        redirect: "error",
        signal,
      });
    }
    assert.equal(response.status, 200, "Evidence API request failed");
    if (association)
      assert(
        !response.headers.get("link"),
        "Truncated pull request associations",
      );
    const bytes = await boundedBody(response, maxBytes);
    return raw ? bytes : JSON.parse(bytes.toString("utf8"));
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** The supported small Actions ZIP format has one regular evidence.json member. */
export function readSourceVerificationArchiveMember(bytes) {
  assert(
    Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= maxArchive,
  );
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 4), 0);
  assert.equal(bytes.readUInt16LE(end + 6), 0);
  assert.equal(bytes.readUInt16LE(end + 8), 1);
  assert.equal(bytes.readUInt16LE(end + 10), 1);
  assert.equal(bytes.readUInt16LE(end + 20), 0);
  const central = bytes.readUInt32LE(end + 16);
  assert(central > 0 && central + bytes.readUInt32LE(end + 12) === end);
  assert.equal(bytes.readUInt32LE(central), 0x02014b50);
  const flags = bytes.readUInt16LE(central + 8);
  assert.equal(flags & ~0x0808, 0);
  const method = bytes.readUInt16LE(central + 10);
  assert([0, 8].includes(method));
  const crc = bytes.readUInt32LE(central + 16);
  const compressed = bytes.readUInt32LE(central + 20);
  const size = bytes.readUInt32LE(central + 24);
  assert(
    size > 0 && size <= MAX_SOURCE_EVIDENCE_BYTES && compressed <= maxArchive,
  );
  const nameLength = bytes.readUInt16LE(central + 28);
  const extraLength = bytes.readUInt16LE(central + 30);
  assert.equal(bytes.readUInt16LE(central + 32), 0);
  assert.equal(bytes.readUInt16LE(central + 34), 0);
  assert.equal(bytes.readUInt32LE(central + 42), 0);
  const mode = (bytes.readUInt32LE(central + 38) >>> 16) & 0o170000;
  assert(mode === 0 || mode === 0o100000);
  assert.equal((bytes.readUInt32LE(central + 38) >>> 16) & 0o111, 0);
  assert.equal(bytes.readUInt32LE(central + 38) & 0x10, 0);
  assert.equal(central + 46 + nameLength + extraLength, end);
  const name = bytes.subarray(central + 46, central + 46 + nameLength);
  assert.equal(name.toString("utf8"), "evidence.json");
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.equal(bytes.readUInt16LE(6), flags);
  assert.equal(bytes.readUInt16LE(8), method);
  assert.equal(bytes.readUInt16LE(26), nameLength);
  assert(bytes.subarray(30, 30 + nameLength).equals(name));
  const start = 30 + nameLength + bytes.readUInt16LE(28);
  const payloadEnd = start + compressed;
  assert(payloadEnd <= central);
  if (flags & 8) {
    let descriptor = payloadEnd;
    if (bytes.readUInt32LE(descriptor) === 0x08074b50) descriptor += 4;
    assert.equal(descriptor + 12, central);
    assert.equal(bytes.readUInt32LE(descriptor), crc);
    assert.equal(bytes.readUInt32LE(descriptor + 4), compressed);
    assert.equal(bytes.readUInt32LE(descriptor + 8), size);
  } else {
    assert.equal(payloadEnd, central);
    assert.equal(bytes.readUInt32LE(14), crc);
    assert.equal(bytes.readUInt32LE(18), compressed);
    assert.equal(bytes.readUInt32LE(22), size);
  }
  const compressedBytes = bytes.subarray(start, payloadEnd);
  const value =
    method === 0
      ? compressedBytes
      : inflateRawSync(compressedBytes, {
          maxOutputLength: MAX_SOURCE_EVIDENCE_BYTES,
        });
  assert.equal(value.length, size);
  assert.equal(crc32(value), crc);
  return {
    evidence: validateSourceVerificationEvidence(value.toString("utf8")),
    jsonBytes: Buffer.from(value),
  };
}

export function readSourceVerificationArchive(bytes) {
  return readSourceVerificationArchiveMember(bytes).evidence;
}

function controller(environment) {
  assert.equal(environment.GITHUB_REPOSITORY, repository);
  assert.equal(environment.GITHUB_REPOSITORY_ID, String(repositoryId));
}

async function producerMetadata(api, runId, attempt, completed) {
  positiveId(runId);
  positiveId(attempt);
  const workflow = await api(`/actions/workflows/${workflowId}`);
  assert(
    workflow.id === workflowId &&
      workflow.path === workflowPath &&
      workflow.state === "active",
  );
  const run = await api(`/actions/runs/${runId}/attempts/${attempt}`);
  assert(run.id === Number(runId) && run.run_attempt === Number(attempt));
  assert(
    run.workflow_id === workflowId &&
      run.path === workflowPath &&
      run.event === "pull_request",
  );
  assert(
    run.repository?.id === repositoryId &&
      run.repository.full_name === repository,
  );
  assert(
    run.head_repository?.id === repositoryId &&
      run.head_repository.full_name === repository,
  );
  if (completed)
    assert(run.status === "completed" && run.conclusion === "success");
  else assert(run.status === "in_progress" && run.conclusion === null);
  assert(Array.isArray(run.pull_requests));
  let pull;
  if (completed && run.pull_requests.length === 0) {
    // GitHub may clear a completed run's PR snapshot after the pull request merges.
    assert(revision.test(run.head_sha));
    const associated = await api(`/commits/${run.head_sha}/pulls?per_page=100`);
    assert(Array.isArray(associated) && associated.length === 1);
    pull = associated[0];
    assert(
      pull.state === "closed" &&
        (pull.merged === undefined || pull.merged === true) &&
        typeof pull.merged_at === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(
          pull.merged_at,
        ) &&
        Number.isFinite(Date.parse(pull.merged_at)) &&
        typeof pull.merge_commit_sha === "string" &&
        pull.merge_commit_sha.length === 40 &&
        revision.test(pull.merge_commit_sha),
    );
  } else {
    assert.equal(run.pull_requests.length, 1);
    pull = run.pull_requests[0];
  }
  positiveId(pull.number);
  assert(
    pull.base?.repo?.id === repositoryId &&
      pull.head?.repo?.id === repositoryId,
  );
  assert(
    pull.base.ref === "main" &&
      revision.test(pull.base.sha) &&
      revision.test(pull.head.sha),
  );
  assert.equal(run.head_sha, pull.head.sha);
  const response = await api(
    `/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,
  );
  assert(
    Array.isArray(response.jobs) &&
      response.total_count === response.jobs.length &&
      response.jobs.length <= 100,
  );
  const jobs = response.jobs;
  assert(
    jobs.every(
      (job) =>
        job.run_id === run.id &&
        job.run_attempt === run.run_attempt &&
        Number.isSafeInteger(job.id),
    ),
  );
  const aggregates = jobs.filter(({ name }) => name === "PR verification");
  assert.equal(aggregates.length, 1);
  const aggregate = aggregates[0];
  if (completed)
    assert(
      aggregate.status === "completed" && aggregate.conclusion === "success",
    );
  else
    assert(aggregate.status === "in_progress" && aggregate.conclusion === null);
  return { run, pull, jobs, aggregate };
}

function laneJob(jobs, lane) {
  const matches = jobs.filter(({ name }) => name === lane);
  assert.equal(matches.length, 1);
  const job = matches[0];
  assert(job.status === "completed" && job.conclusion === "success");
  return String(positiveId(job.id));
}

async function commit(root, sha, api, execute) {
  assert(revision.test(sha));
  try {
    return localCommit(root, sha, execute);
  } catch {
    const value = await api(`/git/commits/${sha}`);
    assert(value.sha === sha && revision.test(value.tree?.sha));
    assert(
      Array.isArray(value.parents) &&
        value.parents.length <= 2 &&
        value.parents.every((entry) => revision.test(entry.sha)),
    );
    return {
      tree: value.tree.sha,
      parents: value.parents.map((entry) => entry.sha),
    };
  }
}

async function definition(root, sha, api, execute) {
  try {
    return digest(
      execute("git", ["show", `${sha}:${workflowPath}`], { cwd: root }),
    );
  } catch {
    const value = await api(`/contents/${workflowPath}?ref=${sha}`);
    assert(
      value.type === "file" &&
        value.path === workflowPath &&
        value.encoding === "base64" &&
        value.size <= MAX_SOURCE_EVIDENCE_BYTES,
    );
    const bytes = Buffer.from(value.content, "base64");
    assert.equal(bytes.length, value.size);
    return digest(bytes);
  }
}

function origin(metadata, workflowDefinitionDigest) {
  const { run, pull, aggregate } = metadata;
  return {
    repository,
    repositoryId: String(repositoryId),
    workflowId: String(workflowId),
    workflowPath,
    runId: String(run.id),
    runAttempt: String(run.run_attempt),
    aggregateJobId: String(aggregate.id),
    workflowDefinitionDigest,
    baseSHA: pull.base.sha,
    headSHA: pull.head.sha,
  };
}

export async function publishSourceVerificationEvidence(
  root,
  {
    plan,
    receipts,
    needs,
    environment = process.env,
    api = createSourceVerificationApi({ token: environment.GITHUB_TOKEN }),
    execute = executeDefault,
  },
) {
  try {
    controller(environment);
    assert(
      environment.GITHUB_EVENT_NAME === "pull_request" &&
        environment.GITHUB_JOB === "required",
    );
    assert.equal(environment.GITHUB_SHA, plan.source);
    const sanitized = sanitizeSourceVerificationReceipts(plan, receipts);
    assert.equal(needs.plan?.result, "success");
    const metadata = await producerMetadata(
      api,
      environment.GITHUB_RUN_ID,
      environment.GITHUB_RUN_ATTEMPT,
      false,
    );
    const checked = checkout(root, plan.source, execute);
    assert.deepEqual(
      checked.parents,
      plan.source === metadata.pull.head.sha
        ? checked.parents
        : [metadata.pull.base.sha, metadata.pull.head.sha],
    );
    const lanes = [];
    for (const lane of plan.lanes) {
      assert.equal(needs[lane.id]?.result, "success");
      const jobId = laneJob(metadata.jobs, lane.id);
      const raw = needs[lane.id]?.outputs?.evidence;
      if (!raw) continue;
      assert(
        typeof raw === "string" &&
          Buffer.byteLength(raw) <= MAX_SOURCE_EVIDENCE_BYTES,
      );
      const capture = JSON.parse(raw);
      assert.deepEqual(Object.keys(capture).sort(), [
        "checkout",
        "contract",
        "host",
      ]);
      lanes.push({ lane: lane.id, jobId, ...capture });
    }
    const evidence = createSourceVerificationEvidence({
      origin: origin(
        metadata,
        await definition(root, plan.source, api, execute),
      ),
      testedSHA: plan.source,
      tree: checked.tree,
      plan,
      aggregate: aggregateReceipts(plan, sanitized),
      receipts: sanitized,
      lanes,
    });
    const temporary = environment.RUNNER_TEMP;
    assert(
      isAbsolute(temporary) && realpathSync(temporary) === resolve(temporary),
    );
    const stat = lstatSync(temporary);
    assert(
      stat.isDirectory() &&
        stat.uid === process.getuid() &&
        (stat.mode & 0o022) === 0,
    );
    const directory = join(temporary, artifactName(metadata.run.run_attempt));
    mkdirSync(directory, { mode: 0o700 });
    const path = join(directory, "evidence.json");
    writeFileSync(path, JSON.stringify(evidence), { mode: 0o600, flag: "wx" });
    return path;
  } catch {
    return null;
  }
}

export async function selectActionsSourceEvidence(
  root,
  {
    plan,
    lane,
    environment = process.env,
    api = createSourceVerificationApi({ token: environment.GITHUB_TOKEN }),
    execute = executeDefault,
    capture = captureLaneEvidence,
    verifyAttestation = verifySourceVerificationAttestation,
  },
) {
  const miss = (reason) => ({ action: "execute", reason });
  try {
    controller(environment);
    assert(
      environment.CI === "true" &&
        environment.GITHUB_ACTIONS === "true" &&
        environment.RUNNER_ENVIRONMENT === "github-hosted",
      "Source reuse requires the allocated hosted runner",
    );
    assert(
      environment.GITHUB_EVENT_NAME === "push" &&
        environment.GITHUB_REF === "refs/heads/main",
    );
    assert.equal(environment.GITHUB_REF_PROTECTED, "true");
    assert.equal(
      environment.GITHUB_WORKFLOW_REF,
      "getsituate/situate/.github/workflows/release-macos.yml@refs/heads/main",
    );
    assert.equal(environment.GITHUB_SHA, plan.source);
    const measured = capture(root, { plan, lane, environment, execute });
    if (!measured) return miss("unresolved-target");
    const checked = checkout(root, plan.source, execute);
    const source = { sha: plan.source, tree: checked.tree, clean: true };
    const reviewedWorkflowDigest = await definition(
      root,
      plan.source,
      api,
      execute,
    );
    const response = await api(
      `/actions/workflows/${workflowId}/runs?event=pull_request&status=completed&per_page=${MAX_SOURCE_EVIDENCE_CANDIDATES}`,
    );
    assert(
      Array.isArray(response.workflow_runs) &&
        response.workflow_runs.length <= MAX_SOURCE_EVIDENCE_CANDIDATES,
    );
    for (const listed of response.workflow_runs) {
      try {
        if (listed.conclusion !== "success") continue;
        const metadata = await producerMetadata(
          api,
          positiveId(listed.id),
          positiveId(listed.run_attempt),
          true,
        );
        const response = await api(
          `/actions/runs/${metadata.run.id}/artifacts?per_page=100`,
        );
        assert(
          Array.isArray(response.artifacts) &&
            response.total_count === response.artifacts.length &&
            response.artifacts.length <= 100,
        );
        const matches = response.artifacts.filter(
          ({ name }) => name === artifactName(metadata.run.run_attempt),
        );
        assert.equal(matches.length, 1);
        const artifact = matches[0];
        assert(
          artifact.expired === false &&
            Number.isInteger(artifact.size_in_bytes) &&
            artifact.size_in_bytes > 0 &&
            artifact.size_in_bytes <= maxArchive,
        );
        positiveId(artifact.id);
        assert(
          artifact.workflow_run?.id === metadata.run.id &&
            artifact.workflow_run.repository_id === repositoryId &&
            artifact.workflow_run.head_repository_id === repositoryId &&
            artifact.workflow_run.head_sha === metadata.run.head_sha,
        );
        const bytes = await api(`/actions/artifacts/${artifact.id}/zip`, {
          raw: true,
          maxBytes: maxArchive,
        });
        assert(Buffer.isBuffer(bytes) && bytes.length <= maxArchive);
        if (artifact.digest !== undefined && artifact.digest !== null)
          assert.equal(artifact.digest, `sha256:${digest(bytes)}`);
        const { evidence, jsonBytes } =
          readSourceVerificationArchiveMember(bytes);
        const proof = await verifyAttestation(jsonBytes, {
          runId: metadata.run.id,
          runAttempt: metadata.run.run_attempt,
          pullNumber: metadata.pull.number,
          environment,
        });
        assert(
          proof &&
            revision.test(proof.checkedSHA) &&
            revision.test(proof.workflowSHA),
        );
        assert.equal(proof.runId, String(metadata.run.id));
        assert.equal(proof.runAttempt, String(metadata.run.run_attempt));
        assert.equal(proof.subjectDigest, digest(jsonBytes));
        assert.equal(evidence.testedSHA, proof.checkedSHA);
        assert.notEqual(proof.checkedSHA, metadata.pull.head.sha);
        const checkedProducer = await commit(
          root,
          proof.checkedSHA,
          api,
          execute,
        );
        assert.deepEqual(checkedProducer.parents, [
          metadata.pull.base.sha,
          metadata.pull.head.sha,
        ]);
        const executedWorkflowDigest = await definition(
          root,
          proof.workflowSHA,
          api,
          execute,
        );
        assert.equal(executedWorkflowDigest, reviewedWorkflowDigest);
        const observedOrigin = origin(metadata, executedWorkflowDigest);
        const observation = {
          origin: observedOrigin,
          trusted: true,
          event: metadata.run.event,
          status: metadata.run.status,
          conclusion: metadata.run.conclusion,
          aggregateConclusion: metadata.aggregate.conclusion,
          headRepositoryId: String(metadata.run.head_repository.id),
          checkedSHA: proof.checkedSHA,
          checkedParents: checkedProducer.parents,
          tree: checkedProducer.tree,
          jobs: evidence.lanes.map(({ lane }) => ({
            lane,
            jobId: laneJob(metadata.jobs, lane),
            conclusion: "success",
          })),
        };
        const result = selectSourceVerificationEvidence({
          candidates: [{ evidence, observation }],
          plan,
          lane,
          host: measured.host,
          contract: measured.contract,
          source,
          reviewedWorkflowDigest,
        });
        if (result.action === "reuse") {
          assert.deepEqual(checkout(root, plan.source, execute), checked);
          return {
            ...result,
            observation,
            host: measured.host,
            contract: measured.contract,
            source,
            reviewedWorkflowDigest,
          };
        }
      } catch {
        // A rejected candidate is not coverage; another bounded candidate may match.
      }
    }
    return miss("no-matching-evidence");
  } catch {
    return miss("evidence-unavailable");
  }
}
