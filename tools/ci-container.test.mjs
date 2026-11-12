import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  copyFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  containerArguments,
  inside,
  validateCacheDirectory,
  cleanupOwnedContainer,
  visualDependencyPaths,
} from "./ci-container.mjs";
import { validateLock, inputDigest, checkBrowserPins } from "./ci-image.mjs";

const lock = {
  version: 1,
  platform: "linux/amd64",
  image: `ghcr.io/owner/ci@sha256:${"a".repeat(64)}`,
  inputsSha256: "b".repeat(64),
};
const options = {
  workspace: "/checkout",
  harness: "/checkout",
  source: "/checkout",
  cache: "/cache",
  lock,
  shard: "checks",
  uid: 1001,
  gid: 1001,
  name: "owned",
  token: "nonce",
  rust: "1.98.1",
};

test("image lock requires a registry digest and matching input fingerprint", () => {
  assert.equal(validateLock(lock, lock.inputsSha256), lock);
  for (const change of [
    { image: "ghcr.io/owner/ci:latest" },
    { platform: "linux/arm64" },
    { version: 2 },
    { inputsSha256: "invalid" },
  ])
    assert.throws(() =>
      validateLock({ ...lock, ...change }, lock.inputsSha256),
    );
  assert.throws(() => validateLock(lock, "c".repeat(64)), /inputs changed/);
});

test("ordinary package updates do not invalidate the tool image; browser changes do", () => {
  const directory = mkdtempSync(join(tmpdir(), "situate-image-inputs-"));
  const write = (name, content) =>
    writeFileSync(join(directory, name), content);
  try {
    for (const name of ["client/docker", "requirements", "tools"])
      mkdirSync(join(directory, name), { recursive: true });
    for (const name of [
      "LICENSE",
      "client/docker/Dockerfile",
      "client/docker/Dockerfile.dockerignore",
      "client/.node-version",
      "client/rust-toolchain.toml",
      "tools/toolchain.quality.json",
    ])
      write(name, "input");
    const manifest = { volta: { node: "24.21.0", npm: "11.19.1" } };
    write("package.json", JSON.stringify(manifest));
    const browser = {
      version: "1.0.0",
      resolved:
        "https://registry.npmjs.org/playwright-core/-/playwright-core-1.0.0.tgz",
      integrity: "sha512-example",
    };
    write(
      "client/docker/ci-browsers.json",
      JSON.stringify({ client: browser, requirements: browser }),
    );
    const packages = { "node_modules/playwright-core": browser };
    for (const name of ["client", "requirements"])
      write(`${name}/package-lock.json`, JSON.stringify({ packages }));
    checkBrowserPins(directory);
    const original = inputDigest(directory);
    write(
      "package.json",
      JSON.stringify({ ...manifest, dependencies: { other: "2.0.0" } }),
    );
    assert.equal(inputDigest(directory), original);
    write(
      "package.json",
      JSON.stringify({ volta: { ...manifest.volta, node: "24.22.0" } }),
    );
    assert.notEqual(inputDigest(directory), original);
    write("package.json", JSON.stringify(manifest));
    packages["node_modules/other"] = { version: "2.0.0" };
    write("client/package-lock.json", JSON.stringify({ packages }));
    assert.equal(inputDigest(directory), original);
    checkBrowserPins(directory);
    packages["node_modules/playwright-core"] = { ...browser, version: "2.0.0" };
    write("client/package-lock.json", JSON.stringify({ packages }));
    assert.throws(() => checkBrowserPins(directory), /rebuild/);
    write("client/docker/ci-install.mjs", "new installer");
    assert.notEqual(inputDigest(directory), original);
    const withInstaller = inputDigest(directory);
    write("client/docker/ci-NOTICES.md", "license notices");
    assert.notEqual(inputDigest(directory), withInstaller);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("container execution has no host socket, credentials, privileged mode, or target cache", () => {
  const args = containerArguments({
    ...options,
    environment: {
      GITHUB_TOKEN: "not-forwarded",
      PRIVATE_TOKEN: "not-forwarded",
      HOME: "/private/home",
    },
  });
  const command = args.join(" ");
  for (const forbidden of [
    "docker.sock",
    "--privileged",
    "not-forwarded",
    "/private/home",
    "dst=/workspace/client/target",
  ])
    assert.ok(!command.includes(forbidden));
  assert.ok(command.includes("--user 1001:1001"));
  assert.ok(command.includes("--shm-size=2g"));
  assert.ok(command.includes("CARGO_INCREMENTAL=0"));
  assert.ok(command.includes("CARGO_PROFILE_TEST_DEBUG=line-tables-only"));
  assert.ok(command.includes("exec node tools/ci-shard.mjs"));
  assert.ok(command.includes("} >&2"));
  assert.throws(() => containerArguments({ ...options, uid: 0 }), /non-root/);
  assert.throws(
    () => containerArguments({ ...options, shard: "docker" }),
    /Unknown/,
  );
  assert.throws(
    () => containerArguments({ ...options, rust: "stable" }),
    /exact Rust/,
  );
  assert.throws(() => inside("/checkout", "/outside"), /inside/);
});

test("quick containers forward selection as data, without shell interpolation", () => {
  const selection = JSON.stringify({ quick: ["$(touch /tmp/not-a-command)"] });
  const args = containerArguments({
    ...options,
    shard: "quick",
    environment: { SITUATE_CI_SELECTION: selection, GITHUB_TOKEN: "secret" },
  });
  assert.ok(args.includes(`SITUATE_CI_SELECTION=${selection}`));
  const script = args[args.indexOf("-c") + 1];
  assert.match(script, /npm ci;/);
  assert.doesNotMatch(script, /cargo.*fetch/);
  const checks = containerArguments({ ...options, shard: "checks" });
  const checkScript = checks[checks.indexOf("-c") + 1];
  assert.match(checkScript, /\(cd client && cargo fetch --locked\);/);
  assert.doesNotMatch(checkScript, /cargo deny fetch/);
  assert.doesNotMatch(script, /touch \/tmp|secret/);
  const history = containerArguments({
    ...options,
    shard: "history",
    environment: { SITUATE_CI_SELECTION: selection },
  });
  assert.ok(!history.some((arg) => arg.startsWith("SITUATE_CI_SELECTION=")));
});

test(
  "checks prepare a cold Cargo cache and stop when fetching fails",
  {
    skip: process.platform === "win32",
  },
  () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "situate-cargo-prepare-")),
    );
    const bin = join(directory, "bin");
    const cache = join(directory, "cargo");
    const log = join(directory, "calls");
    try {
      mkdirSync(bin);
      mkdirSync(join(directory, "client"));
      for (const command of ["git", "df", "npm"])
        writeFileSync(join(bin, command), "#!/bin/sh\nexit 0\n", {
          mode: 0o755,
        });
      writeFileSync(
        join(bin, "cargo"),
        '#!/bin/sh\nprintf "%s\\n" "$PWD|$*" >> "$CALL_LOG"\nif test "$FETCH_EXIT" != 0; then exit "$FETCH_EXIT"; fi\nmkdir -p "$CARGO_HOME"\ntouch "$CARGO_HOME/ready"\n',
        { mode: 0o755 },
      );
      writeFileSync(
        join(bin, "node"),
        '#!/bin/sh\ntest -f "$CARGO_HOME/ready" || exit 1\nprintf "runner\\n" >> "$CALL_LOG"\n',
        { mode: 0o755 },
      );
      const args = containerArguments(options);
      const script = args[args.indexOf("-c") + 1];
      for (const status of [0, 37]) {
        rmSync(cache, { recursive: true, force: true });
        rmSync(log, { force: true });
        const result = spawnSync(
          "/bin/bash",
          [
            "-eu",
            "-o",
            "pipefail",
            "-c",
            `source() { :; }\n${script}`,
            "ci",
            "checks",
          ],
          {
            cwd: directory,
            encoding: "utf8",
            timeout: 10000,
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              HOME: join(directory, "home"),
              CARGO_HOME: cache,
              npm_config_cache: join(directory, "npm"),
              CALL_LOG: log,
              FETCH_EXIT: String(status),
            },
          },
        );
        assert.ifError(result.error);
        assert.equal(result.status, status, result.stderr);
        assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
          `${join(directory, "client")}|fetch --locked`,
          ...(status === 0 ? ["runner"] : []),
        ]);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("workshop containers preserve browser preparation and runner limits", () => {
  const selection = JSON.stringify({
    "workshop-chromium": ["workshop-chromium"],
    "workshop-webkit": ["workshop-webkit"],
  });
  const browser = containerArguments({
    ...options,
    shard: "browser",
    environment: { SITUATE_CI_SELECTION: selection },
  });
  for (const shard of ["workshop-chromium", "workshop-webkit"]) {
    const args = containerArguments({
      ...options,
      shard,
      environment: { SITUATE_CI_SELECTION: selection },
    });
    assert.deepEqual(args.slice(0, -1), browser.slice(0, -1));
    assert.equal(args.at(-1), shard);
    assert.ok(args.includes(`SITUATE_CI_SELECTION=${selection}`));
    assert.ok(args.includes(lock.image));
    const script = args[args.indexOf("-c") + 1];
    assert.match(script, /npm ci --prefix client;/);
    assert.match(script, /install chromium webkit;/);
    assert.match(
      script,
      /exec node tools\/ci-shard.mjs --shard "\$1" --timeout 1800 --json/,
    );
    assert.doesNotMatch(script, /--workers|--retries|--grep|--project/);
  }
});

test("visual containers support worktree files, isolate dependencies, and preserve filter arguments", () => {
  const args = containerArguments({
    ...options,
    shard: "visual",
    visual: "update",
    project: "mobile",
    grep: "create|files; $(touch /tmp/never)",
    dependencyPaths: [
      "client/node_modules",
      "client/app/node_modules",
      "client/packages/ui/node_modules",
    ],
  });
  assert.ok(args.includes("SITUATE_CI_IMAGE=" + lock.image));
  for (const path of ["client", "client/app", "client/packages/ui"])
    assert.ok(args.includes(`/workspace/${path}/node_modules:exec,mode=1777`));
  assert.ok(args.includes("type=bind,src=/checkout,dst=/workspace"));
  assert.deepEqual(args.slice(-3), [
    "--update-snapshots=changed",
    "--project",
    "mobile",
  ]);
  assert.ok(
    args.includes("SITUATE_VISUAL_GREP=create|files; $(touch /tmp/never)"),
  );
  assert.ok(!args.includes("--grep"));
  const script = args[args.indexOf("-c") + 1];
  assert.match(script, /npm ci --prefix client/);
  assert.match(script, /playwright.visual.config.ts "\$@"/);
  assert.doesNotMatch(script, /touch \/tmp|ci-shard|git ls-files/);
  for (const changes of [
    { visual: "delete" },
    { project: "unknown" },
    { visual: "update", environment: { CI: "true" } },
  ])
    assert.throws(() =>
      containerArguments({
        ...options,
        shard: "visual",
        visual: "check",
        ...changes,
      }),
    );
});

test("visual dependency mounts follow workspace declarations, including new packages", () => {
  const directory = mkdtempSync(join(tmpdir(), "situate-visual-workspaces-"));
  try {
    for (const name of [
      "app",
      "workshop",
      "packages/ui",
      "packages/new-package",
      "packages/not-a-package",
    ])
      mkdirSync(join(directory, "client", name), { recursive: true });
    writeFileSync(
      join(directory, "client/package.json"),
      JSON.stringify({ workspaces: ["app", "workshop", "packages/*"] }),
    );
    for (const name of [
      "app",
      "workshop",
      "packages/ui",
      "packages/new-package",
    ])
      writeFileSync(join(directory, "client", name, "package.json"), "{}");
    assert.deepEqual(
      visualDependencyPaths(directory).sort(),
      [
        "client/node_modules",
        "client/app/node_modules",
        "client/workshop/node_modules",
        "client/packages/ui/node_modules",
        "client/packages/new-package/node_modules",
      ].sort(),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dedicated cache validation rejects shared directories and unrelated contents", () => {
  const directory = mkdtempSync(join(tmpdir(), "situate-cache-"));
  try {
    validateCacheDirectory(
      directory,
      join(directory, "..", "checkout"),
      join(directory, "..", "home"),
    );
    assert.throws(
      () => validateCacheDirectory(directory, join(directory, "checkout")),
      /dedicated/,
    );
    assert.throws(
      () => validateCacheDirectory(directory, join(directory, "..")),
      /dedicated/,
    );
    assert.throws(
      () => validateCacheDirectory(directory, "/checkout", directory),
      /dedicated/,
    );
    writeFileSync(join(directory, "unrelated"), "fixture");
    assert.throws(
      () => validateCacheDirectory(directory, "/checkout", "/home"),
      /unrelated/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("coverage keeps both checkouts and scalar metadata without forwarding write credentials", () => {
  const args = containerArguments({
    ...options,
    shard: "coverage",
    harness: "/checkout/harness",
    source: "/checkout/source",
    environment: {
      GITHUB_RUN_ID: "42",
      HEAD_SHA: "a".repeat(40),
      SIDE: "head",
      GITHUB_TOKEN: "not-forwarded",
      GITHUB_STEP_SUMMARY: "/runner/summary",
      PREPARATION_STATUS: "success",
    },
  });
  const command = args.join(" ");
  assert.ok(command.includes("GITHUB_RUN_ID=42"));
  assert.ok(command.includes("/workspace/source"));
  assert.ok(command.includes("/workspace/harness"));
  assert.ok(command.includes("src=/checkout/harness,dst=/workspace/harness"));
  assert.ok(command.includes("src=/checkout/source,dst=/workspace/source"));
  assert.ok(
    command.includes("src=/checkout/report.json,dst=/workspace/report.json"),
  );
  assert.ok(!command.includes("src=/checkout,dst=/workspace"));
  assert.ok(command.includes("dst=/ci-step-summary"));
  assert.ok(!command.includes("not-forwarded"));
  assert.ok(!command.includes("CARGO_PROFILE_TEST_DEBUG"));
  assert.ok(command.includes("export PREPARATION_STATUS=failure"));
});

test("container cleanup is bounded and only removes the verified owner", () => {
  const calls = [];
  const run = (command, args, options) => {
    calls.push(args);
    assert.equal(command, "docker");
    assert.equal(options.timeout, 3000);
    return { status: 0, stdout: "nonce\n" };
  };
  assert.equal(cleanupOwnedContainer("owned", "nonce", run), null);
  assert.deepEqual(calls[1], ["rm", "--force", "owned"]);
  calls.length = 0;
  assert.match(
    cleanupOwnedContainer("owned", "different", run).message,
    /different owner/,
  );
  assert.equal(calls.length, 1);
  assert.equal(
    cleanupOwnedContainer("owned", "nonce", () => ({
      status: 1,
      stderr: "No such container",
    })),
    null,
  );
  assert.match(
    cleanupOwnedContainer("owned", "nonce", () => ({
      error: new Error("timeout"),
    })).message,
    /ownership/,
  );
});

test("workflow partition, immutable image use, and shared-cache write policy remain explicit", () => {
  const read = (path) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const quality = read(".github/workflows/quality.yml");
  assert.match(
    quality,
    /shard: \$\{\{ fromJSON\(needs.plan.outputs.linux\) \}\}/,
  );
  assert.match(
    quality,
    /needs: \[plan, quick, linux, docker, host, security\]/,
  );
  assert.match(quality, /--shard docker/);
  assert.equal(
    quality.match(/revision: \$\{\{ steps\.cache\.outputs\.revision \}\}/g)
      ?.length,
    3,
  );
  assert.doesNotMatch(quality, /\*\*\/package-lock\.json/);
  assert.doesNotMatch(quality, /apt-get|cargo install/);
  assert.match(quality, /client\/test-results\/browser\//);
  assert.doesNotMatch(quality, /visual-report|visual-comparisons/);
  const coverage = read(".github/workflows/coverage.yml");
  assert.match(coverage, /ci-container\.mjs --coverage source/);
  assert.match(coverage, /if test ! -s report\.json/);
  assert.match(coverage, /available == 'true' && 'failure' \|\| job.status/);
  assert.doesNotMatch(coverage, /apt-get|cargo install/);
  const cache = read(".github/actions/download-cache/action.yml");
  assert.match(
    cache,
    /contains\(fromJSON\('\["push","schedule","workflow_dispatch"\]'\), github.event_name\) && github.ref == 'refs\/heads\/main'/,
  );
  assert.doesNotMatch(cache, /\/target|node_modules|\.docker|rustup/);
  assert.match(cache, /cargo\/registry\/cache/);
  const image = read(".github/actions/ci-image/action.yml");
  assert.match(image, /readImageLock/);
  assert.doesNotMatch(image, /packages: write|docker push/);
});

test("image preparation reclaims only unused SDKs on GitHub-hosted Linux", () => {
  const image = readFileSync(
    new URL("../.github/actions/ci-image/action.yml", import.meta.url),
    "utf8",
  );
  const cleanup = image.match(
    / {4}- name: Free unused hosted runner SDKs\r?\n([\s\S]*?)(?= {4}- )/,
  )?.[1];
  assert.ok(cleanup);
  assert.match(
    cleanup,
    / {6}if: runner\.environment == 'github-hosted' && runner\.os == 'Linux'/,
  );
  const paths = cleanup.match(/ {8}sudo rm -rf -- ([^\r\n]+)/)?.[1].split(" ");
  assert.deepEqual(paths, [
    "/usr/local/lib/android",
    "/usr/share/dotnet",
    "/opt/ghc",
    "/opt/hostedtoolcache/CodeQL",
  ]);
  assert.ok(image.indexOf(cleanup) < image.indexOf('docker pull "$CI_IMAGE"'));
});

test("Apple quality remains required without Windows jobs", () => {
  const quality = readFileSync(
    new URL("../.github/workflows/quality.yml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(quality, /continue-on-error|windows-2025|^ {2}windows:/m);
  assert.match(quality, /os: \[macos-15\]/);
  assert.match(
    quality,
    /needs: \[plan, quick, linux, docker, host, security\]/,
  );
  assert.match(quality, /node tools\/ci-required\.mjs/);
});

test(
  "cancellation forces owned cleanup when the Docker client ignores signals",
  { skip: process.platform === "win32", timeout: 10000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "situate-container-cancel-"));
    const project = join(directory, "project");
    const cache = join(directory, "cache");
    const state = join(directory, "state");
    let child;
    try {
      for (const path of [
        "tools",
        "client/docker",
        "requirements",
        ".git",
        "bin",
      ])
        mkdirSync(join(project, path), { recursive: true });
      mkdirSync(cache);
      for (const name of [
        "ci-container.mjs",
        "ci-image.mjs",
        "ci-shard.mjs",
        "test.mjs",
        "test-scope.mjs",
        "test-budget.mjs",
        "quick-source.mjs",
        "test-inputs.mjs",
        "quality-cache.mjs",
        "cargo-environment.mjs",
        "compiler-cache.mjs",
        "run-coordinated.mjs",
        "worktree-supervisor.py",
      ])
        copyFileSync(
          new URL(name, import.meta.url),
          join(project, "tools", name),
        );
      for (const name of [
        "LICENSE",
        "client/docker/Dockerfile",
        "client/docker/Dockerfile.dockerignore",
        "client/.node-version",
        "tools/toolchain.quality.json",
      ])
        writeFileSync(join(project, name), "fixture");
      writeFileSync(
        join(project, "package.json"),
        JSON.stringify({ volta: { node: "24.21.0", npm: "11.19.1" } }),
      );
      writeFileSync(
        join(project, "client/rust-toolchain.toml"),
        'channel = "1.98.1"',
      );
      const browser = {
        version: "1",
        resolved: "fixture",
        integrity: "fixture",
      };
      writeFileSync(
        join(project, "client/docker/ci-browsers.json"),
        JSON.stringify({ client: browser, requirements: browser }),
      );
      for (const name of ["client", "requirements"])
        writeFileSync(
          join(project, name, "package-lock.json"),
          JSON.stringify({
            packages: { "node_modules/playwright-core": browser },
          }),
        );
      writeFileSync(
        join(project, "tools/ci-image.lock.json"),
        JSON.stringify({ ...lock, inputsSha256: inputDigest(project) }),
      );
      writeFileSync(
        join(project, "bin/docker"),
        `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const state = process.env.CONTAINER_FIXTURE_STATE;
if (args[0] === "run") {
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => {});
  fs.writeFileSync(state, args[args.indexOf("--label") + 1].split("=")[1]);
  setInterval(() => {}, 1000);
} else if (args[0] === "inspect" && fs.existsSync(state)) {
  console.log(fs.readFileSync(state, "utf8"));
} else if (args[0] === "rm") {
  fs.unlinkSync(state);
  fs.writeFileSync(state + ".removed", "yes");
} else {
  console.error("No such container");
  process.exitCode = 1;
}
`,
        { mode: 0o755 },
      );
      const environment = {
        ...process.env,
        CI_CACHE_DIR: cache,
        CONTAINER_FIXTURE_STATE: state,
        PATH: `${join(project, "bin")}:${process.env.PATH}`,
      };
      delete environment.NODE_TEST_CONTEXT;
      child = spawn(
        process.execPath,
        ["tools/ci-container.mjs", "--shard", "checks"],
        { cwd: project, env: environment, stdio: "pipe" },
      );
      child.stdout.resume();
      child.stderr.resume();
      const exited = once(child, "exit");
      const deadline = Date.now() + 3000;
      while (
        !existsSync(state) &&
        Date.now() < deadline &&
        child.exitCode === null
      )
        await delay(10);
      assert.ok(existsSync(state), "Docker fixture started");
      child.kill("SIGINT");
      const [code] = await exited;
      assert.equal(code, 130);
      assert.ok(existsSync(state + ".removed"));
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
