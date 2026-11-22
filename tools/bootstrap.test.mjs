import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPlan } from "./test.mjs";
import test from "node:test";
import { main, prerequisites, toolchainProblems } from "./bootstrap.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const websiteDeliveryCommands = [
  "python3 tools/pipeline-bootstrap.py",
  "node tools/wait-for-hosting.mjs",
  "node website/site.mjs --build",
  "python3 tools/pipeline-container.py website prepared website/dist",
  "node tools/wait-for-hosting.mjs --check",
  'python3 infrastructure/production/immutable/website_content.py deploy website/dist "$WEBSITE_SOURCE_REVISION"',
];

test("all npm projects inherit the root Volta pins", () => {
  const { volta } = JSON.parse(read("package.json"));
  assert.match(volta.node, /^\d+\.\d+\.\d+$/);
  assert.match(volta.npm, /^\d+\.\d+\.\d+$/);
  assert.equal(read("client/.node-version").trim(), volta.node);
  assert.equal(
    JSON.parse(read("tools/toolchain.quality.json")).npm.version,
    volta.npm,
  );
  for (const [directory, parent] of [
    ["client", "../package.json"],
    ["requirements", "../package.json"],
    ["client/app", "../../package.json"],
    ["client/workshop", "../../package.json"],
    ["client/packages/ui", "../../../package.json"],
    ["client/packages/localization", "../../../package.json"],
  ]) {
    assert.deepEqual(
      JSON.parse(read(`${directory}/package.json`)).volta,
      { extends: parent },
      directory,
    );
  }
});

function checkWorkflowBootstrap(name, workflow) {
  assert.doesNotMatch(
    workflow,
    /actions\/setup-node|volta-cli\/action|run:.*(?:volta install|curl|npm install)/,
  );
  const jobs = workflow.split(/^jobs:\n/m)[1]?.split(/^ {2}([\w-]+):\n/m);
  assert.ok(jobs?.length > 1, name);
  for (let index = 1; index < jobs.length; index += 2) {
    const id = jobs[index];
    const block = jobs[index + 1];
    const context = `${name}: ${id}`;
    const steps = block.split(/^ {4}steps:\n/m)[1];
    if (name === "release-macos.yml" && id === "publish") {
      assert.equal(steps, undefined, context);
      assert.match(
        block,
        /^ {4}uses: \.\/\.github\/workflows\/publish-macos\.yml$/m,
      );
      continue;
    }
    if (
      (name === "notify-slack.yml" && id === "notify") ||
      (name === "publish-macos.yml" && id === "notify-release")
    ) {
      assert.equal(steps, undefined, context);
      assert.match(
        block,
        /^ {4}uses: \.\/\.github\/workflows\/slack-notify\.yml$/m,
      );
      assert.doesNotMatch(block, /^ {4}runs-on:/m);
      continue;
    }
    assert.ok(steps, context);
    if (name === "slack-notify.yml" && id === "send") {
      // The notifier uses runner-provided tools and must not execute repository code.
      assert.doesNotMatch(
        steps,
        /^ +(?:- )?uses:|\btools\/|\b(?:node|npm|python3|volta)\b/m,
      );
      assert.match(steps, /^ {8}shell: bash$/m);
      continue;
    }
    assert.match(
      steps,
      /^ {6}- uses: actions\/checkout@[a-f0-9]{40}\n/,
      context,
    );
    assert.match(steps, /persist-credentials: false\n/, context);
    const commands = [
      ...steps.matchAll(/^ {6}(?:- run:| {2}run:) (.+)$/gm),
    ].map((match) => match[1]);
    assert.ok(commands.length > 0, context);
    const portable =
      name === "dependency-monitoring.yml" ||
      (name === "diagnostics.yml" && id === "portable") ||
      (["verify.yml", "release-macos.yml"].includes(name) &&
        /^ {4}runs-on: ubuntu-24\.04$/m.test(block) &&
        id !== "docker-integration");
    const metadata =
      (name === "release-macos.yml" && id === "plan") ||
      (name === "verify.yml" && id === "required");
    if (name === "deploy-website.yml" && id === "website") {
      assert.match(block, /^ {4}runs-on: ubuntu-24\.04$/m, context);
      assert.deepEqual(commands, websiteDeliveryCommands, context);
    } else if (name === "release-macos.yml" && id === "hosting-ready") {
      assert.match(block, /^ {4}runs-on: ubuntu-24\.04$/m, context);
      assert.deepEqual(
        commands,
        [
          "python3 tools/pipeline-bootstrap.py",
          "node tools/wait-for-hosting.mjs --release",
        ],
        context,
      );
    } else if (metadata) {
      let bootstrapped = false;
      for (const command of commands) {
        if (command === "python3 tools/pipeline-bootstrap.py") {
          bootstrapped = true;
          continue;
        }
        if (command.startsWith("python3 tools/pipeline-container.py actions "))
          assert.match(
            command,
            /^python3 tools\/pipeline-container\.py actions (?:plan|aggregate)(?: .*)?$/,
            context,
          );
        else {
          assert(bootstrapped, context);
          assert.match(
            command,
            /^node tools\/actions-adapter\.mjs (?:release-selection|source-evidence|source-evidence-check)(?: .*)?$/,
            context,
          );
        }
      }
    } else if (portable) {
      for (const command of commands)
        assert.match(
          command,
          /^python3 tools\/pipeline-container\.py actions [a-z-]+(?: .*)?$/,
          context,
        );
    } else {
      assert.equal(commands[0], "python3 tools/pipeline-bootstrap.py", context);
      assert.ok(commands.length > 1, context);
      for (const command of commands.slice(1))
        assert.match(
          command,
          name === "release-macos.yml" &&
            ["create", "macos-compatibility"].includes(id)
            ? /^node tools\/(?:actions-adapter\.mjs [a-z-]+(?: .*)?|release-build-cache\.mjs (?:prepare|plan|start|report)|wait-for-hosting\.mjs --(?:probe|check))$/
            : ({
                "verify-hosting.yml: offline":
                  /^(?:node tools\/hosting-checks\.mjs|terraform -chdir=infrastructure\/production\/terraform (?:init -backend=false -input=false -lockfile=readonly|validate))$/,
                "deploy-hosting.yml: rehearse":
                  /^node tools\/hosting-checks\.mjs$/,
                "deploy-hosting.yml: hetzner-rehearsal":
                  /^(?:timeout --signal=TERM --kill-after=30s 24m )?python3 -B infrastructure\/production\/immutable\/github-rehearsal\.py(?: cleanup)?$/,
                "deploy-hosting.yml: production":
                  /^node (?:infrastructure\/production\/immutable\/continuous-deploy\.mjs|tools\/wait-for-hosting\.mjs --select)$/,
                "publish-macos.yml: publish":
                  /^node tools\/(?:actions-adapter\.mjs [a-z-]+(?: .*)?|wait-for-hosting\.mjs --probe)$/,
              }[context] ??
                /^node tools\/actions-adapter\.mjs [a-z-]+(?: .*)?$/),
          context,
        );
    }
  }
}

test("CI bootstraps portable jobs in the container and host jobs through the shared adapter", () => {
  const workflows = readdirSync(
    new URL("../.github/workflows/", import.meta.url),
  ).filter((name) => name.endsWith(".yml"));
  assert.ok(workflows.length > 0);
  for (const name of workflows)
    checkWorkflowBootstrap(name, read(`.github/workflows/${name}`));
});

function workflowJob(id, runner, commands) {
  return `jobs:\n  ${id}:\n    runs-on: ${runner}\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n        with:\n          persist-credentials: false\n${commands.map((command) => `      - run: ${command}\n`).join("")}`;
}

test("metadata controllers require bootstrap and cannot execute portable suites on the host", () => {
  const bootstrap = "python3 tools/pipeline-bootstrap.py";
  assert.doesNotThrow(() =>
    checkWorkflowBootstrap(
      "release-macos.yml",
      workflowJob("plan", "ubuntu-24.04", [
        bootstrap,
        "node tools/actions-adapter.mjs release-selection --workflow create",
        "python3 tools/pipeline-container.py actions plan --workflow create",
      ]),
    ),
  );
  assert.throws(() =>
    checkWorkflowBootstrap(
      "release-macos.yml",
      workflowJob("plan", "ubuntu-24.04", [
        bootstrap,
        "node tools/actions-adapter.mjs lane --workflow create --lane rust",
      ]),
    ),
  );
  assert.throws(() =>
    checkWorkflowBootstrap(
      "verify.yml",
      workflowJob("required", "ubuntu-24.04", [
        "node tools/actions-adapter.mjs source-evidence --workflow verify",
      ]),
    ),
  );
});

test("website delivery requires the pinned bootstrap and checks the build before publishing", () => {
  const check = (commands) =>
    checkWorkflowBootstrap(
      "deploy-website.yml",
      workflowJob("website", "ubuntu-24.04", commands),
    );
  const [bootstrap, wait, build, verify, readiness, publish] =
    websiteDeliveryCommands;
  check(websiteDeliveryCommands);
  assert.throws(() => check([wait, build, verify, readiness, publish]));
  assert.throws(() => check([bootstrap, wait, build, readiness, publish]));
  assert.throws(() => check([bootstrap, wait, build, verify, publish]));
  assert.throws(() =>
    check([bootstrap, wait, build, verify, publish, readiness]),
  );
});

test("portable jobs reject host Node setup and unpinned checkout", () => {
  const wrapper =
    "python3 tools/pipeline-container.py actions lane --workflow verify --lane tooling";
  const portable = workflowJob("tooling", "ubuntu-24.04", [wrapper]);
  checkWorkflowBootstrap("verify.yml", portable);
  assert.throws(() =>
    checkWorkflowBootstrap(
      "verify.yml",
      workflowJob("tooling", "ubuntu-24.04", [
        "python3 tools/pipeline-bootstrap.py",
        "node tools/actions-adapter.mjs lane --workflow verify --lane tooling",
      ]),
    ),
  );
  assert.throws(() =>
    checkWorkflowBootstrap(
      "verify.yml",
      portable.replace(`checkout@${"a".repeat(40)}`, "checkout@main"),
    ),
  );
});

test("native and host Docker jobs require bootstrap before the Node adapter", () => {
  for (const [name, id, runner] of [
    ["verify.yml", "macos-native", "macos-latest"],
    ["verify.yml", "docker-integration", "ubuntu-24.04"],
    ["diagnostics.yml", "docker", "ubuntu-24.04"],
  ]) {
    const adapter = "node tools/actions-adapter.mjs setup";
    checkWorkflowBootstrap(
      name,
      workflowJob(id, runner, ["python3 tools/pipeline-bootstrap.py", adapter]),
    );
    assert.throws(() =>
      checkWorkflowBootstrap(name, workflowJob(id, runner, [adapter])),
    );
    assert.throws(() =>
      checkWorkflowBootstrap(
        name,
        workflowJob(id, runner, [
          adapter,
          "python3 tools/pipeline-bootstrap.py",
        ]),
      ),
    );
  }
});

const directory = fileURLToPath(new URL("../", import.meta.url));
const pins = JSON.parse(read("package.json")).volta;
const image = {
  platform: "linux/amd64",
  image: `ghcr.io/getsituate/situate-ci-linux@sha256:${"a".repeat(64)}`,
};
const portable = [
  { id: "root-format", command: "npm", args: ["run", "format:check"] },
  { id: "root-secrets", command: "npm", args: ["run", "quality:secrets"] },
  { id: "root-rust", command: "npm", args: ["run", "quality:rust"] },
  { id: "root-swift", command: "npm", args: ["run", "quality:swift"] },
  { id: "client-format", command: "cargo", args: ["fmt"] },
  {
    id: "client-browser-chromium",
    kind: "browser",
    command: "node",
    args: ["playwright"],
  },
  {
    id: "requirements-browser",
    kind: "browser",
    command: "node",
    args: ["playwright"],
  },
];
const native = [
  { id: "dev-tui-macos", project: "dev-tui", command: "cargo", args: ["test"] },
  {
    id: "client-host-clippy",
    project: "client",
    command: "cargo",
    args: ["clippy", "--workspace"],
  },
  {
    id: "client-native",
    project: "client",
    kind: "native",
    command: "node",
    args: ["scripts/test-native.mjs"],
  },
];

function fixture(platform, suites, overrides = {}) {
  const calls = [];
  const errors = [];
  const messages = [];
  const result = main(overrides.args ?? [], {
    directory,
    platform,
    nodeVersion: pins.node,
    environment: {
      PATH: "/fixture/bin",
      HOME: "/fixture/home",
      SECRET_TOKEN: "must-not-leak",
    },
    readLock: () => image,
    selectSuites: () => suites,
    execute: (command, args, options) => {
      calls.push({ command, args, options });
      assert.equal(options.env.SECRET_TOKEN, undefined);
      assert.equal(options.cwd, directory);
      if (overrides.execute) return overrides.execute(command, args, options);
      return {
        status: 0,
        stdout:
          command === "npm"
            ? pins.npm
            : args[0] === "image"
              ? image.platform
              : args[0] === "component"
                ? "llvm-tools-aarch64-apple-darwin\\n"
                : "",
      };
    },
    log: (message) => messages.push(message),
    error: (message) => errors.push(message),
    ...overrides.options,
  });
  return { result, calls, errors, messages };
}

for (const platform of ["linux", "darwin"]) {
  test(`${platform}: portable tools and browsers belong to the pinned image, not the host`, () => {
    const checks = prerequisites("/checkout", {
      platform,
      suites: portable,
      readLock: () => image,
    });
    assert.deepEqual(
      checks.map(({ command, args }) => [command, args]),
      [
        ["volta", ["--version"]],
        ["git", ["--version"]],
        ["docker", ["--version"]],
        ["docker", ["info"]],
        [
          "docker",
          [
            "image",
            "inspect",
            image.image,
            "--format",
            "{{.Os}}/{{.Architecture}}",
          ],
        ],
      ],
    );
    const run = fixture(platform, portable);
    assert.equal(run.result, 0, run.errors.join("\\n"));
    assert.deepEqual(
      run.calls.map(({ command }) => command),
      ["npm", "volta", "git", "docker", "docker", "docker"],
    );
    assert.equal(run.messages.length, 1);
    for (const call of run.calls)
      assert.ok(
        !call.args.some((arg) =>
          ["pull", "run", "install", "build", "login", "license"].includes(arg),
        ),
      );
  });

  test(`${platform}: missing Docker engine is reported without host tool noise`, () => {
    const run = fixture(platform, portable, {
      execute: (command, args) => ({
        status: command === "docker" && args[0] === "info" ? 1 : 0,
        stdout:
          command === "npm"
            ? pins.npm
            : args[0] === "image"
              ? image.platform
              : "",
      }),
    });
    assert.equal(run.result, 1);
    assert.deepEqual(run.errors, [
      "Missing prerequisite: Docker engine: docker info",
    ]);
    assert.deepEqual(run.messages, []);
  });

  test(`${platform}: quick preflight is dependency-free and does not inspect images`, () => {
    const run = fixture(platform, [...portable, ...native], {
      args: ["--quick"],
      options: {
        readLock: () => {
          throw new Error("Quick checks must not read the image lock");
        },
      },
    });
    assert.equal(run.result, 0, run.errors.join("\\n"));
    assert.deepEqual(
      run.calls.map(({ command }) => command),
      ["npm", "volta", "git"],
    );
  });

  test(`${platform}: absent or wrong-architecture pinned images fail without pulling`, () => {
    for (const status of [0, 1]) {
      const run = fixture(platform, portable, {
        execute: (command, args) => ({
          status: args[0] === "image" ? status : 0,
          stdout:
            command === "npm"
              ? pins.npm
              : args[0] === "image"
                ? "linux/arm64"
                : "",
        }),
      });
      assert.equal(run.result, 1);
      assert.match(run.errors.join("\\n"), /Pinned portable-check image/);
      assert.ok(!run.calls.some(({ args }) => args.includes("pull")));
    }
  });
}

test("multi-architecture preflight inspects the selected native platform explicitly", () => {
  const multi = {
    version: 2,
    platforms: ["linux/amd64", "linux/arm64"],
    image: image.image,
  };
  for (const [arch, expected] of [
    ["x64", "linux/amd64"],
    ["arm64", "linux/arm64"],
  ]) {
    const checks = prerequisites("/checkout", {
      platform: "darwin",
      arch,
      suites: portable,
      readLock: () => multi,
    });
    const check = checks.find(
      ({ name }) => name === "Pinned portable-check image",
    );
    assert.equal(check.expected, expected);
    assert.deepEqual(check.args.slice(0, 4), [
      "image",
      "inspect",
      "--platform",
      expected,
    ]);
    const run = fixture("darwin", portable, {
      options: { arch, readLock: () => multi },
      execute: (command, args) => ({
        status: 0,
        stdout:
          command === "npm" ? pins.npm : args[0] === "image" ? expected : "",
      }),
    });
    assert.equal(run.result, 0, run.errors.join("\n"));
  }
});

test("visual preflight retains AMD64 and mixed selections inspect both architectures", () => {
  const multi = {
    version: 2,
    platforms: ["linux/amd64", "linux/arm64"],
    image: image.image,
  };
  const visual = { id: "client-visual", kind: "browser" };
  for (const [suites, expected] of [
    [[visual], ["linux/amd64"]],
    [
      [...portable, visual],
      ["linux/arm64", "linux/amd64"],
    ],
  ]) {
    const checks = prerequisites("/checkout", {
      platform: "darwin",
      arch: "arm64",
      suites,
      readLock: () => multi,
    });
    assert.deepEqual(
      checks
        .filter(({ name }) => name === "Pinned portable-check image")
        .map(({ expected }) => expected),
      expected,
    );
  }
});

for (const platform of ["linux", "darwin"]) {
  test(`${platform}: host Docker context checks need Buildx but not the portable image`, () => {
    const run = fixture(platform, [{ id: "client-docker-context" }], {
      options: {
        readLock: () => {
          throw new Error(
            "Host Docker integration must not inspect the tool image",
          );
        },
      },
    });
    assert.equal(run.result, 0, run.errors.join("\n"));
    assert.deepEqual(
      run.calls.map(({ command, args }) => [command, args]),
      [
        ["npm", ["--version"]],
        ["volta", ["--version"]],
        ["git", ["--version"]],
        ["docker", ["--version"]],
        ["docker", ["info"]],
        ["docker", ["buildx", "version"]],
      ],
    );
  });

  test(`${platform}: hosting integration needs the engine, not Buildx or the tool image`, () => {
    const run = fixture(platform, [{ id: "design-website-hosting" }], {
      options: {
        readLock: () => {
          throw new Error("Hosting tests must not inspect the tool image");
        },
      },
    });
    assert.equal(run.result, 0, run.errors.join("\n"));
    assert.deepEqual(
      run.calls.map(({ command, args }) => [command, args]),
      [
        ["npm", ["--version"]],
        ["volta", ["--version"]],
        ["git", ["--version"]],
        ["docker", ["--version"]],
        ["docker", ["info"]],
      ],
    );
  });
}

test("Darwin native suites check their actual host tools, not portable linters or browsers", () => {
  const run = fixture("darwin", native);
  assert.equal(run.result, 0, run.errors.join("\\n"));
  assert.deepEqual(
    run.calls.map(({ command, args }) => [command, args]),
    [
      ["npm", ["--version"]],
      ["volta", ["--version"]],
      ["git", ["--version"]],
      ["cargo", ["--version"]],
      ["rustc", ["--version"]],
      ["cargo", ["clippy", "--version"]],
      ["xcodebuild", ["-version"]],
      ["xcrun", ["--find", "clang"]],
      ["swift", ["--version"]],
      ["python3", ["--version"]],
    ],
  );
  assert.ok(
    !run.calls.some(
      ({ command, args }) =>
        command === "docker" || command === "swiftlint" || args.includes("fmt"),
    ),
  );
});

test("the native terminal test does not require Xcode or client dependencies", () => {
  const run = fixture("darwin", [native[0]]);
  assert.equal(run.result, 0);
  assert.deepEqual(
    run.calls.map(({ command }) => command),
    ["npm", "volta", "git", "cargo", "rustc"],
  );
});

test("explicit native selection on Linux does not probe or provision Apple tools", () => {
  const run = fixture("linux", native);
  assert.equal(run.result, 1);
  assert.deepEqual(run.errors, [
    "Missing prerequisite: Selected native suites require macOS.",
  ]);
  assert.deepEqual(
    run.calls.map(({ command }) => command),
    ["npm", "volta", "git"],
  );
});

test("coverage tools are required only for selected native Rust coverage", () => {
  const vue = {
    id: "client-vue-coverage",
    kind: "coverage",
    command: "node",
    args: [],
  };
  const rust = {
    id: "client-rust-coverage",
    project: "client",
    kind: "coverage",
    command: "cargo",
    args: ["llvm-cov", "--workspace"],
  };
  const linux = fixture("linux", [vue], { args: ["--coverage"] });
  assert.equal(linux.result, 0);
  assert.ok(
    !linux.calls.some(
      ({ command }) => command === "cargo" || command === "rustup",
    ),
  );
  const mac = fixture("darwin", [vue, rust], { args: ["--coverage"] });
  assert.equal(mac.result, 0, mac.errors.join("\\n"));
  assert.ok(mac.calls.some(({ args }) => args[0] === "llvm-cov"));
  assert.ok(
    mac.calls.some(
      ({ command, args }) =>
        command === "rustup" && args.includes("--installed"),
    ),
  );
});

test("an invalid image lock is reported without running Docker or fetching replacements", () => {
  const run = fixture("linux", portable, {
    options: {
      readLock: () => {
        throw new Error("Invalid CI image lock.");
      },
    },
  });
  assert.equal(run.result, 1);
  assert.deepEqual(run.errors, [
    "Missing prerequisite: Invalid CI image lock.",
  ]);
  assert.deepEqual(
    run.calls.map(({ command }) => command),
    ["npm"],
  );
});

test("missing native LLVM tools fail only native Rust coverage", () => {
  const suite = {
    id: "client-rust-coverage",
    project: "client",
    command: "cargo",
    args: ["llvm-cov", "--workspace"],
  };
  const run = fixture("darwin", [suite], {
    execute: (command) => ({
      status: 0,
      stdout: command === "npm" ? pins.npm : "",
    }),
  });
  assert.equal(run.result, 1);
  assert.deepEqual(run.errors, [
    "Missing prerequisite: Rust LLVM tools component: rustup component list --installed",
  ]);
});

for (const platform of ["linux", "darwin"]) {
  test(`${platform}: explicit CLI suite selection uses the central plan`, () => {
    const run = fixture(platform, [], {
      args: ["--suite", "root-format"],
      options: {
        selectSuites: (options, location) =>
          createPlan(options, location).suites,
      },
    });
    assert.equal(run.result, 0, run.errors.join("\n"));
    assert.deepEqual(
      run.calls.map(({ command }) => command),
      ["npm", "volta", "git", "docker", "docker", "docker"],
    );
  });
}

test("toolchain preflight rejects mismatched Node and npm versions", () => {
  assert.deepEqual(toolchainProblems(pins, pins.node, pins.npm), []);
  assert.match(toolchainProblems(pins, "0.0.0", pins.npm)[0], /node .*Volta/);
  assert.match(toolchainProblems(pins, pins.node, "0.0.0")[0], /npm .*Volta/);
  assert.match(toolchainProblems(pins, pins.node, undefined)[0], /unavailable/);
});
