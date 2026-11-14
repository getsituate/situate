import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  createSuiteCacheExecutor,
  describeSuiteCacheResult,
} from "./suite-cache.mjs";
import { cacheConfigurations } from "./fixtures/suite-cache.mjs";
import { suiteAffectedFiles } from "./test-inputs.mjs";

async function fixture(t, id = "client-types") {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "suite-cache-test-")),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "repo");
  const cacheDirectory = join(parent, "cache");
  const bin = join(parent, "bin");
  const home = join(parent, "home");
  for (const path of [directory, cacheDirectory, bin, home])
    await mkdir(path, { mode: 0o700 });
  const put = async (file, data = "initial") => {
    const path = resolve(directory, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return path;
  };
  await put("client/app/src/input.ts");
  await put("client/package.json", "{}");
  await put("client/node_modules/dependency/index.js");
  await put(".gitignore", "node_modules/\nignored\n");
  execFileSync("git", ["init", "-q", directory]);
  const git = (...args) => execFileSync("git", ["-C", directory, ...args]);
  git("add", ".");
  const environment = { PATH: `${bin}:/usr/bin:/bin`, HOME: home };
  for (const name of [
    "node",
    "npm",
    "npx",
    "cargo",
    "rustc",
    "rustfmt",
    "cc",
    "c++",
    "ar",
    "ld",
    "clang",
    "clang++",
  ]) {
    const path = join(parent, "tools", name, "bin", name);
    await put(path, "tool identity");
    await put(join(bin, name), "#!/bin/sh\nexit 0\n");
    await chmod(join(bin, name), 0o700);
  }
  for (const name of ["volta", "rustup"]) {
    await put(
      join(bin, name),
      `#!/bin/sh\nprintf '%s\\n' '${parent}/tools/'"$2"'/bin/'"$2"\n`,
    );
    await chmod(join(bin, name), 0o700);
  }
  await put(
    join(bin, "xcrun"),
    `#!/bin/sh\nif [ "$1" = '--show-sdk-path' ]; then printf '%s\\n' '${parent}/sdk'; else printf '%s\\n' '${parent}/tools/'"$2"'/bin/'"$2"; fi\n`,
  );
  await chmod(join(bin, "xcrun"), 0o700);
  const suite =
    id === "client-core"
      ? {
          id,
          cwd: "client",
          command: "cargo",
          args: ["test", "-p", "situate-core", "--locked"],
        }
      : {
          id,
          cwd: id.startsWith("workshop-") ? "client/workshop" : "client/app",
          command: process.execPath,
          args: id.endsWith("-vue")
            ? ["../node_modules/vitest/vitest.mjs", "run", "--allowOnly=false"]
            : ["../node_modules/vue-tsc/bin/vue-tsc.js", "--noEmit"],
        };
  await mkdir(join(directory, suite.cwd), { recursive: true });
  if (id !== "client-core")
    await put(
      `${suite.cwd}/tsconfig.json`,
      cacheConfigurations[`${suite.cwd}/tsconfig.json`],
    );
  if (id.endsWith("-vue"))
    for (const path of [
      `${suite.cwd}/vitest.config.ts`,
      "client/scripts/ui-boundary.mjs",
    ])
      await put(path, cacheConfigurations[path]);
  let cargoMetadata;
  const setCargoMetadata = async (metadata) => {
    cargoMetadata = metadata;
    await put(join(parent, "metadata.json"), JSON.stringify(metadata));
  };
  if (id === "client-core") {
    await setCargoMetadata({
      version: 1,
      workspace_root: join(directory, "client"),
      workspace_members: ["core"],
      packages: [
        {
          id: "core",
          name: "situate-core",
          source: null,
          manifest_path: join(
            directory,
            "client/crates/situate-core/Cargo.toml",
          ),
          dependencies: [
            {
              name: "fixture",
              source: "registry+https://github.com/rust-lang/crates.io-index",
              registry: null,
            },
          ],
          targets: [
            {
              kind: ["lib"],
              src_path: join(
                directory,
                "client/crates/situate-core/src/lib.rs",
              ),
            },
          ],
        },
        {
          id: "fixture",
          name: "fixture",
          version: "1.0.0",
          source: "registry+https://github.com/rust-lang/crates.io-index",
        },
      ],
      resolve: {
        nodes: [
          { id: "core", dependencies: ["fixture"] },
          { id: "fixture", dependencies: [] },
        ],
      },
    });
    await put(
      join(bin, "cargo"),
      `#!${process.execPath}\nimport {readFileSync} from 'node:fs';\nif (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['metadata', '--format-version', '1', '--locked', '--offline'])) process.exit(1);\nconsole.log(readFileSync(${JSON.stringify(join(parent, "metadata.json"))}, 'utf8'));\n`,
    );
    await chmod(join(bin, "cargo"), 0o700);
    for (const path of [
      "client/Cargo.toml",
      "client/crates/situate-core/Cargo.toml",
    ])
      await put(path, cacheConfigurations[path]);
    await put(
      "client/Cargo.lock",
      '[[package]]\nname = "fixture"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n',
    );
    await put(join(home, ".cargo/registry/src/registry/fixture-1.0.0/lib.rs"));
  }
  let calls = 0;
  let behavior = async () => ({ status: "passed", exitCode: 0, durationMs: 1 });
  let selector = (_suite, files) =>
    files.filter(
      (file) => file.startsWith("client/") && !file.includes("node_modules/"),
    );
  const settings = {
    directory,
    cacheDirectory,
    affectedFiles: (...args) => selector(...args),
    execute: async (...args) => {
      calls++;
      return behavior(...args);
    },
  };
  const executor = createSuiteCacheExecutor(settings);
  return {
    parent,
    directory,
    cacheDirectory,
    home,
    bin,
    put,
    git,
    suite,
    environment,
    settings,
    setCargoMetadata,
    get cargoMetadata() {
      return structuredClone(cargoMetadata);
    },
    get calls() {
      return calls;
    },
    set behavior(value) {
      behavior = value;
    },
    set selector(value) {
      selector = value;
    },
    run: (options = {}) => executor(suite, { environment, ...options }),
  };
}

function cacheDetails(result) {
  const { status, inspectionDurationMs, ...details } = result.cache;
  assert.ok(["hit", "miss", "unavailable", "ineligible"].includes(status));
  assert.equal(status === "hit", result.reused);
  assert.ok(Number.isFinite(inspectionDurationMs) && inspectionDurationMs >= 0);
  return details;
}

test("reuses success across executors, with private digest-only state", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run()).reused, false);
  assert.equal((await f.run()).reused, true);
  assert.equal(
    (
      await createSuiteCacheExecutor(f.settings)(f.suite, {
        environment: f.environment,
      })
    ).reused,
    true,
  );
  assert.equal(f.calls, 1);
  for (const name of await readdir(f.cacheDirectory)) {
    const path = join(f.cacheDirectory, name);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.match(await readFile(path, "utf8"), /^\{"key":"[a-f0-9]{64}"\}$/);
  }
});

test("Docker lease changes reuse successes without suppressing execution environment", async (t) => {
  const f = await fixture(t);
  const observed = [];
  f.behavior = async (_suite, options) => {
    observed.push(options.environment.SITUATE_DOCKER_LEASE);
    return { status: "passed", exitCode: 0, durationMs: 1 };
  };
  f.environment.SITUATE_DOCKER_LEASE = "/tmp/lease-one/container.json";
  assert.equal((await f.run()).reused, false);
  f.environment.SITUATE_DOCKER_LEASE = "/tmp/lease-two/container.json";
  assert.equal((await f.run()).reused, true);
  f.environment.NODE_ENV = "production";
  assert.equal((await f.run()).reused, false);
  assert.deepEqual(observed, [
    "/tmp/lease-one/container.json",
    "/tmp/lease-two/container.json",
  ]);
  delete f.environment.SITUATE_DOCKER_LEASE;
  assert.equal((await f.run()).reused, true);
});

test("dirty client inputs remain reusable when only docs and planner reasons change", async (t) => {
  const f = await fixture(t);
  f.selector = suiteAffectedFiles;
  await f.put("client/app/src/input.ts", "dirty input");
  f.suite.reasons = ["client/app/src/input.ts"];
  await f.run();
  await f.put("docs/guide.md", "Updated documentation");
  await f.put("client/README.md", "Updated client documentation");
  f.suite.reasons = ["client/app/src/input.ts", "docs/guide.md"];
  f.suite.covers = ["additional selection provenance"];
  const started = performance.now();
  assert.equal((await f.run()).reused, true);
  t.diagnostic(
    `Warm fixture reuse: ${Math.round(performance.now() - started)} ms`,
  );
  assert.equal(f.calls, 1);
});

test("workshop Vue and types use the same bounded dependency checks", async (t) => {
  for (const id of ["workshop-vue", "workshop-types"]) {
    const f = await fixture(t, id);
    await f.run();
    assert.equal((await f.run()).reused, true);
    await f.put("client/workshop/src/input.ts", "changed");
    assert.equal((await f.run()).reused, false);
  }
});

test("oversized or special source inputs fail open and clear previous successes", async (t) => {
  const f = await fixture(t);
  await f.run();
  const handle = await import("node:fs/promises").then(({ open }) =>
    open(join(f.directory, "client/app/src/input.ts"), "w"),
  );
  try {
    await handle.truncate(129 * 1024 * 1024);
  } finally {
    await handle.close();
  }
  assert.equal((await f.run()).reused, false);
  assert.deepEqual(await readdir(f.cacheDirectory), []);
});

test("content keys ignore staging, HEAD, timestamps, unrelated and ignored files", async (t) => {
  const f = await fixture(t);
  await f.run();
  await f.put("other.txt");
  await f.put("ignored");
  f.git("add", ".");
  f.git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "Fixture",
  );
  await utimes(join(f.directory, "client/app/src/input.ts"), 1, 1);
  assert.equal((await f.run()).reused, true);
});

test("additions, deletion, renames and same-size content edits rerun", async (t) => {
  const f = await fixture(t);
  await f.run();
  for (const change of [
    () => f.put("client/app/src/added.ts"),
    () =>
      rename(
        join(f.directory, "client/app/src/added.ts"),
        join(f.directory, "client/app/src/renamed.ts"),
      ),
    () => rm(join(f.directory, "client/app/src/renamed.ts")),
    () => f.put("client/app/src/input.ts", "changed"),
  ]) {
    await change();
    assert.equal((await f.run()).reused, false);
    assert.equal((await f.run()).reused, true);
  }
});

test("source edit and restore during execution cannot bless success", async (t) => {
  const f = await fixture(t);
  f.behavior = async () => {
    await f.put("client/app/src/input.ts", "changed");
    await f.put("client/app/src/input.ts", "initial");
    return { status: "passed" };
  };
  await f.run();
  await f.run();
  assert.equal(f.calls, 2);
  assert.deepEqual(await readdir(f.cacheDirectory), []);
});

test("in-place dependencies and toolchain identities invalidate; generated caches do not", async (t) => {
  const f = await fixture(t);
  await f.run();
  for (const path of [
    "client/node_modules/dependency/index.js",
    join(f.parent, "tools/node/bin/node"),
    join(f.parent, "tools/npm/lib/module.js"),
  ]) {
    await f.put(path, "modified");
    assert.equal((await f.run()).reused, false);
    assert.equal((await f.run()).reused, true);
  }
  await f.put("client/node_modules/.vite/result", "generated");
  await f.put("client/node_modules/.cache/result", "generated");
  assert.equal((await f.run()).reused, true);
});

test("nested and ancestor dependency overrides invalidate successful suites", async (t) => {
  const f = await fixture(t);
  await f.run();
  for (const path of [
    "client/app/node_modules/dependency/index.js",
    "client/app/src/node_modules/dependency/index.js",
    "node_modules/dependency/index.js",
  ]) {
    await f.put(path, "new resolution target");
    assert.equal((await f.run()).reused, false);
    assert.equal((await f.run()).reused, true);
    await f.put(path, "changed override");
    assert.equal((await f.run()).reused, false);
  }
});

test("workspace package symlinks inspect source without recursing into build output", async (t) => {
  const f = await fixture(t);
  await f.put("client/packages/local/package.json", "{}");
  await f.put("client/packages/local/src/index.ts");
  await f.put("client/packages/local/README.md", "Documentation");
  f.selector = (_suite, files) =>
    files.filter((file) => file.startsWith("client/") && !file.endsWith(".md"));
  await f.put(".gitignore", "node_modules/\ndist/\n");
  await symlink(
    "../packages/local",
    join(f.directory, "client/node_modules/local"),
  );
  await f.run();
  await f.put("client/packages/local/dist/output.js");
  await f.put("client/packages/local/README.md", "Updated documentation");
  assert.equal((await f.run()).reused, true);
  await f.put("client/packages/local/src/index.ts", "changed");
  assert.equal((await f.run()).reused, false);
  await f.put(
    "client/packages/local/src/fixtures/README.md",
    "Runtime fixture",
  );
  assert.equal((await f.run()).reused, false);
  await f.put(
    "client/packages/local/src/fixtures/README.md",
    "Changed fixture",
  );
  assert.equal((await f.run()).reused, false);
});

test("environment and dependency changes during execution prevent recording", async (t) => {
  for (const mutate of [
    async (f) => {
      f.environment.FLAG = "new";
    },
    (f) => f.put("client/node_modules/dependency/index.js", "new"),
  ]) {
    const f = await fixture(t);
    f.behavior = async () => {
      await mutate(f);
      return { status: "passed" };
    };
    await f.run();
    assert.deepEqual(await readdir(f.cacheDirectory), []);
  }
});

test("failed inspection discards previous success even when inputs later recover", async (t) => {
  const f = await fixture(t);
  await f.run();
  f.selector = () => {
    throw new Error("inspection failed");
  };
  assert.equal((await f.run()).reused, false);
  assert.deepEqual(await readdir(f.cacheDirectory), []);
  f.selector = (_suite, files) =>
    files.filter((file) => file.startsWith("client/"));
  assert.equal((await f.run()).reused, false);
});

test("failure, cancellation and thrown errors never preserve success", async (t) => {
  for (const outcome of ["failed", "cancelled", "throw", "abort"]) {
    const f = await fixture(t);
    await f.run();
    await f.put("client/app/src/input.ts", "new");
    const controller = new AbortController();
    f.behavior = async () => {
      if (outcome === "throw") throw new Error("execution failed");
      if (outcome === "abort") controller.abort();
      return { status: outcome === "abort" ? "passed" : outcome };
    };
    if (outcome === "throw") await assert.rejects(f.run(), /execution failed/);
    else await f.run({ signal: controller.signal });
    assert.deepEqual(await readdir(f.cacheDirectory), []);
    f.behavior = async () => ({ status: "passed" });
    assert.equal((await f.run()).reused, false);
  }
});

test("custom TypeScript configuration cannot reuse results with unbounded inputs", async (t) => {
  const f = await fixture(t);
  await f.run();
  assert.equal((await f.run()).reused, true);
  await f.put(
    "client/app/tsconfig.json",
    '{"include":["../../../external/**/*.ts"]}',
  );
  await f.run();
  await f.run();
  assert.equal(f.calls, 3);
  assert.deepEqual(await readdir(f.cacheDirectory), []);
});

test("unknown suites and arbitrary executable configuration execute every time", async (t) => {
  const f = await fixture(t, "client-vue");
  await f.run();
  assert.equal((await f.run()).reused, true);
  await f.put("client/app/vitest.config.ts", "export default {};");
  await f.run();
  await f.run();
  assert.equal(f.calls, 3);
  f.suite.id = "history-contract";
  await f.run();
  await f.run();
  assert.equal(f.calls, 5);
});

test(
  "Rust resolves tools in suite cwd and fingerprints registry dependencies and receipts",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = await fixture(t, "client-core");
    await f.put(
      join(f.bin, "rustup"),
      `#!/bin/sh\n[ "$PWD" = '${f.directory}/client' ] || exit 1\nprintf '%s\\n' '${f.parent}/tools/'"$2"'/bin/'"$2"\n`,
    );
    await f.run();
    assert.equal((await f.run()).reused, true);
    for (const path of [
      join(f.home, ".cargo/registry/src/registry/fixture-1.0.0/lib.rs"),
      join(f.parent, "tools/rustc/lib/rustlib/components"),
      join(f.parent, "tools/clang/bin/clang"),
      join(f.parent, "sdk/SDKSettings.json"),
    ]) {
      await f.put(path, "changed");
      assert.equal((await f.run()).reused, false);
      assert.equal((await f.run()).reused, true);
    }
  },
);

test(
  "Cargo manifest and lockfile updates invalidate reusable results once",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = await fixture(t, "client-core");
    await f.run();
    assert.equal((await f.run()).reused, true);
    for (const [path, update] of [
      [
        "client/crates/situate-core/Cargo.toml",
        (text) =>
          text.replace(
            /^(fixture = \{ version = ")(\d+)/m,
            (_match, prefix, major) => `${prefix}${Number(major) + 1}`,
          ),
      ],
      [
        "client/Cargo.toml",
        (text) =>
          text.replace(
            /^(version = ")(\d+)/m,
            (_match, prefix, major) => `${prefix}${Number(major) + 1}`,
          ),
      ],
      [
        "client/Cargo.lock",
        (text) =>
          text.replace(
            /^(version = ")(\d+)/m,
            (_match, prefix, major) => `${prefix}${Number(major) + 1}`,
          ),
      ],
    ]) {
      const original = await readFile(join(f.directory, path), "utf8");
      const changed = update(original);
      assert.notEqual(changed, original);
      await f.put(path, changed);
      assert.equal((await f.run()).reused, false, path);
      assert.equal((await f.run()).reused, true, path);
    }
  },
);

test(
  "unbounded Cargo metadata never reuses successful results",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = await fixture(t, "client-core");
    const baseline = f.cargoMetadata;
    for (const change of [
      (m) => {
        m.packages[0].dependencies[0].source =
          "git+https://example.invalid/dependency";
      },
      (m) => {
        m.packages[0].dependencies[0].registry =
          "https://example.invalid/index";
      },
      (m) => {
        m.packages[0].dependencies[0].path = "/external";
      },
      (m) => {
        m.packages[1].source = null;
      },
      (m) => {
        m.packages[1].source = "git+https://example.invalid/transitive";
      },
      (m) => {
        m.resolve.nodes[0].dependencies = ["missing"];
      },
      (m) => {
        m.packages[0].targets[0].kind = ["custom-build"];
      },
      (m) => {
        m.packages[0].targets[0].src_path = "/external/lib.rs";
      },
      (m) => {
        m.workspace_root = "/external";
      },
      (m) => {
        m.workspace_members = [];
      },
      (m) => {
        m.packages = [];
      },
      (m) => {
        m.resolve = null;
      },
    ]) {
      await f.setCargoMetadata(baseline);
      await f.run();
      assert.equal((await f.run()).reused, true);
      const changed = structuredClone(baseline);
      change(changed);
      await f.setCargoMetadata(changed);
      assert.equal((await f.run()).reused, false);
      assert.equal((await f.run()).reused, false);
      assert.deepEqual(await readdir(f.cacheDirectory), []);
    }
  },
);

test(
  "custom Cargo path dependencies and build scripts cannot reuse results",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = await fixture(t, "client-core");
    await f.run();
    assert.equal((await f.run()).reused, true);
    const manifest = await readFile(
      join(f.directory, "client/crates/situate-core/Cargo.toml"),
      "utf8",
    );
    await f.put(
      "client/crates/situate-core/Cargo.toml",
      manifest +
        '\n[build-dependencies]\nexternal = { path = "../../../../external" }\n',
    );
    const metadata = f.cargoMetadata;
    const external = f.cargoMetadata;
    external.packages[0].dependencies.push({
      name: "external",
      source: null,
      path: resolve(f.directory, "../external"),
    });
    await f.setCargoMetadata(external);
    await f.run();
    await f.run();
    assert.equal(f.calls, 3);
    assert.deepEqual(await readdir(f.cacheDirectory), []);
    await f.setCargoMetadata(metadata);
    await f.put("client/crates/situate-core/Cargo.toml", manifest);
    await f.put("client/crates/situate-core/build.rs", "fn main() {}\n");
    await f.run();
    await f.run();
    assert.equal(f.calls, 5);
    assert.deepEqual(await readdir(f.cacheDirectory), []);
  },
);

test("unsafe cache directories and record symlinks never write outside the approved directory", async (t) => {
  const f = await fixture(t);
  await f.run();
  const [name] = await readdir(f.cacheDirectory);
  const external = await f.put(join(f.parent, "external"), "untouched");
  await rm(join(f.cacheDirectory, name));
  await symlink(external, join(f.cacheDirectory, name));
  assert.equal((await f.run()).reused, false);
  assert.equal(await readFile(external, "utf8"), "untouched");
  await chmod(f.cacheDirectory, 0o755);
  assert.equal((await f.run()).reused, false);
  await rm(f.cacheDirectory, { recursive: true });
  await symlink(f.directory, f.cacheDirectory);
  await f.run();
  assert.equal(await readFile(external, "utf8"), "untouched");
});

test("cache rejection diagnostics distinguish unqualified inputs from successful reuse", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run()).cache.status, "miss");
  assert.equal((await f.run()).cache.status, "hit");
  await f.put("client/app/tsconfig.json", "{}");
  const result = await f.run();
  assert.equal(result.cache.status, "unavailable");
  assert.equal(result.cache.reason, "unsupported-configuration");
  assert.ok(result.cache.inspectionDurationMs >= 0);
});

test(
  "native include and library search paths are fingerprinted without ignoring their contents",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = await fixture(t, "client-core");
    const include = join(f.parent, "include");
    const lib = join(f.parent, "lib");
    await f.put(join(include, "fixture.h"));
    await f.put(join(lib, "fixture.a"));
    f.environment.CPPFLAGS = "-I" + include;
    f.environment.LDFLAGS = "-L" + lib;
    await f.run();
    assert.equal((await f.run()).reused, true);
    await f.put(join(lib, "fixture.a"), "changed");
    assert.equal((await f.run()).reused, false);
    assert.equal((await f.run()).reused, true);
    f.environment.LDFLAGS = "-Wl,unknown";
    assert.equal((await f.run()).cache.reason, "native-configuration");
  },
);
test("accepted configuration edits rerun once and then reuse", async (t) => {
  for (const id of [
    "client-types",
    "client-vue",
    ...(process.platform === "darwin" ? ["client-core"] : []),
  ]) {
    const f = await fixture(t, id);
    await f.run();
    assert.equal((await f.run()).reused, true);
    const path =
      id === "client-core"
        ? "client/crates/situate-core/Cargo.toml"
        : `${f.suite.cwd}/${id.endsWith("-vue") ? "vitest.config.ts" : "tsconfig.json"}`;
    const changed = cacheConfigurations[path]
      .replace('version = "1.0"', 'version = "2.0"')
      .replace("clearMocks: true", "clearMocks: false")
      .replace('"strict":true', '"strict":false');
    await f.put(path, changed);
    const result = await f.run();
    assert.equal(result.reused, false);
    assert.deepEqual(cacheDetails(result), {
      reason: "inputs-changed",
      recorded: true,
    });
    assert.equal((await f.run()).reused, true);
    assert.equal(f.calls, 2);
  }
});

test("unsupported configuration clears success, explains normal execution, and can recover", async (t) => {
  const f = await fixture(t);
  await f.run();
  await f.put(
    "client/app/tsconfig.json",
    '{"include":["../../outside/**/*.ts"]}',
  );
  for (let count = 0; count < 2; count++) {
    const result = await f.run();
    assert.equal(result.status, "passed");
    assert.equal(result.reused, false);
    assert.deepEqual(cacheDetails(result), {
      reason: "unsupported-configuration",
      configuration: "client/app/tsconfig.json",
      recorded: false,
    });
    assert.match(
      describeSuiteCacheResult(result),
      /configuration is outside.*client\/app\/tsconfig\.json/,
    );
    assert.deepEqual(await readdir(f.cacheDirectory), []);
  }
  await f.put(
    "client/app/tsconfig.json",
    cacheConfigurations["client/app/tsconfig.json"],
  );
  assert.equal((await f.run()).cache.recorded, true);
  assert.equal((await f.run()).reused, true);
  assert.equal(f.calls, 4);
});

test("configuration validation inspects the same bytes as the content fingerprint", async (t) => {
  const f = await fixture(t);
  f.selector = async (_suite, files) => {
    await f.put(
      "client/app/tsconfig.json",
      '{"include":["../../outside/**/*.ts"]}',
    );
    return files.filter((file) => file.startsWith("client/"));
  };
  const result = await f.run();
  assert.equal(result.cache.reason, "unsupported-configuration");
  assert.equal(result.cache.recorded, false);
  assert.deepEqual(await readdir(f.cacheDirectory), []);
});

test("internal configuration symlinks still validate their target contents", async (t) => {
  const f = await fixture(t);
  await f.put(
    "client/app/config.json",
    cacheConfigurations["client/app/tsconfig.json"],
  );
  await rm(join(f.directory, "client/app/tsconfig.json"));
  await symlink("config.json", join(f.directory, "client/app/tsconfig.json"));
  await f.run();
  assert.equal((await f.run()).reused, true);
  await f.put(
    "client/app/config.json",
    '{"include":["../../outside/**/*.ts"]}',
  );
  const result = await f.run();
  assert.equal(result.cache.reason, "unsupported-configuration");
  assert.equal(result.cache.recorded, false);
});

test("diagnostics distinguish cold, reused, invalid and unrecorded results without leaking inputs", async (t) => {
  const f = await fixture(t);
  f.environment.PRIVATE_VALUE = "private-cache-test-sentinel";
  const first = await f.run();
  assert.deepEqual(cacheDetails(first), {
    reason: "no-success",
    recorded: true,
  });
  assert.match(
    describeSuiteCacheResult(first),
    /cache not used: no previous successful result/,
  );
  const reused = await f.run();
  assert.deepEqual(cacheDetails(reused), { reason: "unchanged-inputs" });
  assert.equal(describeSuiteCacheResult(reused), "");
  const [record] = await readdir(f.cacheDirectory);
  await f.put(
    join(f.cacheDirectory, record),
    '{"key":"private-cache-test-sentinel"}',
  );
  assert.deepEqual(cacheDetails(await f.run()), {
    reason: "invalid-record",
    recorded: true,
  });
  await f.put("client/app/src/input.ts", "new");
  f.behavior = async () => {
    await f.put("client/app/src/input.ts", "changed during execution");
    return { status: "passed" };
  };
  const unstable = await f.run();
  assert.deepEqual(cacheDetails(unstable), {
    reason: "inputs-changed",
    recorded: false,
    recordingReason: { reason: "inputs-changed" },
  });
  assert.match(
    describeSuiteCacheResult(unstable),
    /result not stored: inputs changed/,
  );
  f.selector = () => {
    throw new Error("private-cache-test-sentinel /private/location");
  };
  const unavailable = await f.run();
  assert.deepEqual(cacheDetails(unavailable), {
    reason: "inspection-unavailable",
    recorded: false,
  });
  for (const result of [first, reused, unstable, unavailable]) {
    assert.doesNotMatch(
      JSON.stringify(result),
      /private-cache-test-sentinel|\/private\/location/,
    );
    assert.doesNotMatch(
      describeSuiteCacheResult(result),
      /private-cache-test-sentinel|\/private\/location/,
    );
  }
  assert.deepEqual(await readdir(f.cacheDirectory), []);
});

test("post-execution inspection failure is reported without storing success", async (t) => {
  const f = await fixture(t);
  f.behavior = async () => {
    f.selector = () => {
      throw new Error("private inspection error");
    };
    return { status: "passed" };
  };
  const result = await f.run();
  assert.deepEqual(cacheDetails(result), {
    reason: "no-success",
    recorded: false,
    recordingReason: { reason: "inspection-unavailable" },
  });
  assert.doesNotMatch(JSON.stringify(result), /private inspection error/);
  assert.deepEqual(await readdir(f.cacheDirectory), []);
});

test("selected setup files establish reuse and invalidate it when edited", async (t) => {
  const f = await fixture(t, "client-vue");
  const setup = "client/app/src/setup.ts";
  await f.put(setup, "initial setup");
  await f.put(
    "client/app/vitest.config.ts",
    cacheConfigurations["client/app/vitest.config.ts"].replace(
      "clearMocks: true",
      'clearMocks: true, setupFiles: ["./src/setup.ts"]',
    ),
  );
  assert.equal((await f.run()).cache.recorded, true);
  assert.equal((await f.run()).reused, true);
  await f.put(setup, "changed setup");
  assert.deepEqual(cacheDetails(await f.run()), {
    reason: "inputs-changed",
    recorded: true,
  });
  assert.equal((await f.run()).reused, true);
  assert.equal(f.calls, 2);
});

test("inventoried setup files excluded by the selector cannot reuse results", async (t) => {
  const f = await fixture(t, "client-vue");
  const setup = "client/app/src/setup.ts";
  await f.put(setup, "synthetic setup");
  await f.put(
    "client/app/vitest.config.ts",
    cacheConfigurations["client/app/vitest.config.ts"].replace(
      "clearMocks: true",
      'clearMocks: true, setupFiles: ["./src/setup.ts"]',
    ),
  );
  await f.run();
  assert.equal((await f.run()).reused, true);
  f.selector = (_suite, files) =>
    files.filter((file) => file.startsWith("client/") && file !== setup);
  for (let count = 0; count < 2; count++) {
    const result = await f.run();
    assert.equal(result.cache.reason, "unsupported-configuration");
    assert.equal(result.cache.recorded, false);
  }
  assert.equal(f.calls, 3);
  assert.deepEqual(await readdir(f.cacheDirectory), []);
});

test("ignored setup files cannot establish a reusable success", async (t) => {
  const f = await fixture(t, "client-vue");
  await f.run();
  await f.put(".gitignore", "node_modules/\nignored-setup.ts\n");
  await f.put("client/app/src/ignored-setup.ts", "synthetic setup");
  await f.put(
    "client/app/vitest.config.ts",
    cacheConfigurations["client/app/vitest.config.ts"].replace(
      "clearMocks: true",
      'clearMocks: true, setupFiles: ["./src/ignored-setup.ts"]',
    ),
  );
  for (let count = 0; count < 2; count++) {
    const result = await f.run();
    assert.equal(result.cache.reason, "unsupported-configuration");
    assert.equal(result.cache.recorded, false);
  }
  assert.equal(f.calls, 3);
  assert.deepEqual(await readdir(f.cacheDirectory), []);
});

test(
  "workspace member manifests must be inventoried and physically contained",
  { skip: process.platform !== "darwin" },
  async (t) => {
    for (const mode of ["ignored", "escaping-link"]) {
      const f = await fixture(t, "client-core");
      await f.run();
      const member = "crates/tauri-plugin-provider-platform";
      const local = `client/${member}/Cargo.toml`;
      const value = '[package]\nname = "synthetic-member"\nversion = "0.0.1"\n';
      await f.put(
        "client/Cargo.toml",
        cacheConfigurations["client/Cargo.toml"].replace(
          '"crates/situate-core"',
          `"crates/situate-core", "${member}"`,
        ),
      );
      await f.put(local, value);
      if (mode === "ignored")
        await f.put(
          ".gitignore",
          "node_modules/\ntauri-plugin-provider-platform/\n",
        );
      else {
        f.git("add", local);
        const external = join(f.parent, "outside-member");
        await f.put(join(external, "Cargo.toml"), value);
        await rm(dirname(join(f.directory, local)), { recursive: true });
        await symlink(external, dirname(join(f.directory, local)));
      }
      const result = await f.run();
      assert.equal(result.cache.reason, "unsupported-configuration");
      assert.equal(result.cache.configuration, "client/Cargo.toml");
      assert.equal(result.cache.recorded, false);
      assert.deepEqual(await readdir(f.cacheDirectory), []);
    }
  },
);

test("missing hook policy disables only affected reuse without aborting execution", async (t) => {
  for (const id of ["client-types", "client-vue"]) {
    const f = await fixture(t, id);
    const moduleDirectory = join(f.parent, "isolated-tools");
    for (const name of [
      "suite-cache.mjs",
      "suite-cache-config.mjs",
      "test-inputs.mjs",
    ])
      await f.put(
        join(moduleDirectory, name),
        await readFile(new URL(name, import.meta.url)),
      );
    const { createSuiteCacheExecutor: isolatedExecutor } = await import(
      pathToFileURL(join(moduleDirectory, "suite-cache.mjs")).href
    );
    const run = () =>
      isolatedExecutor(f.settings)(f.suite, { environment: f.environment });
    const first = await run();
    const second = await run();
    if (id === "client-types") {
      assert.equal(first.cache.recorded, true);
      assert.equal(second.reused, true);
    } else {
      assert.equal(first.status, "passed");
      assert.deepEqual(cacheDetails(first), {
        reason: "policy-unavailable",
        recorded: false,
      });
      assert.deepEqual(cacheDetails(second), cacheDetails(first));
      assert.equal(f.calls, 2);
      assert.deepEqual(await readdir(f.cacheDirectory), []);
    }
  }
});

test("migration recovery checks always execute rather than reuse successful suite results", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "migration-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const execute = createSuiteCacheExecutor({
    directory,
    cacheDirectory: join(directory, "cache"),
    affectedFiles: suiteAffectedFiles,
    execute: async () => {
      calls++;
      return { status: "passed" };
    },
  });
  const suite = {
    id: "client-migrations",
    cwd: "client",
    command: "cargo",
    args: ["test", "-p", "situate-migrations", "--locked"],
  };
  for (let count = 0; count < 2; count++) {
    const result = await execute(suite);
    assert.equal(result.status, "passed");
    assert.equal(result.reused, false);
    assert.equal(result.cache.reason, "unsupported-suite");
    assert.equal(result.cache.recorded, false);
  }
  assert.equal(calls, 2);
});

test("incomplete cleanup cannot establish a reusable success", async (t) => {
  const f = await fixture(t);
  f.behavior = async () => ({ status: "passed", cleanupIncomplete: true });
  for (let count = 0; count < 2; count++) {
    const result = await f.run();
    assert.equal(result.reused, false);
    assert.equal(result.cache.recorded, false);
    assert.deepEqual(result.cache.recordingReason, {
      reason: "execution-cleanup-incomplete",
    });
  }
  assert.equal(f.calls, 2);
  assert.deepEqual(await readdir(f.cacheDirectory), []);
});
