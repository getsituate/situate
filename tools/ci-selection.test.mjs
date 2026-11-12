import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  selectCi,
  changedFiles,
  parseOptions,
  githubOutputs,
} from "./ci-selection.mjs";
import { root, sourceFiles, suiteInventory } from "./test.mjs";
import { shards } from "./ci-shard.mjs";

const inventory = suiteInventory(sourceFiles(root), "linux");
const select = (files, options = {}, suites = inventory) =>
  selectCi({ files, mode: "changes", ...options }, suites);
const ids = (selection) => shards.flatMap((shard) => selection[shard]);

test("default and full select active MVP checks, not deferred product platforms", () => {
  const full = selectCi({}, inventory);
  assert.deepEqual(full, select([], { mode: "full" }));
  assert.equal(full.scope, "mvp");
  assert.equal(full.host, true);
  assert.equal(full.full, true);
  assert.equal(full.windows, undefined);
  assert.ok(full.quick.includes("client-vue"));
  assert.ok(full.quick.includes("workshop-vue"));
  assert.ok(full.quick.includes("client-scripts-unit"));
  assert.ok(!ids(full).includes("root-audit"));
  assert.ok(full.checks.includes("client-format"));
  assert.ok(
    full.checks.includes("root-secrets") || full.quick.includes("root-secrets"),
  );
  for (const shard of [
    "browser",
    "workshop-chromium",
    "workshop-webkit",
    "native",
  ])
    assert.deepEqual(full[shard], []);
  for (const id of [
    "client-core",
    "client-host",
    "client-clippy",
    "root-kotlin",
    "dev-tui-unit",
  ])
    assert.ok(!ids(full).includes(id), id);
  assert.equal(new Set(ids(full)).size, ids(full).length);
});

test("migration changes retain package checks in full and changed Linux CI selections", () => {
  for (const selection of [
    selectCi({}, inventory),
    select(["client/crates/situate-migrations/src/runner.rs"]),
    select([
      "client/crates/situate-migrations/tests/fixtures/m0001/before/opaque.json",
    ]),
  ]) {
    assert.ok(selection.checks.includes("client-migrations"));
    assert.equal(selection.host, true);
  }
  assert.ok(
    !ids(select(["client/app/src/App.vue"])).includes("client-migrations"),
  );
});

test("app, shared, native, configuration and unknown changes require macOS", () => {
  for (const file of [
    "client/app/src/Main.vue",
    "client/app/tests/browser/files.spec.ts",
    "client/packages/ui/src/Button.vue",
    "client/packages/localization/src/en.json",
    "client/app/src/ai/transport-contract.json",
    "client/crates/core/src/lib.rs",
    "client/src-tauri/src/lib.rs",
    "client/native/ios/Access.swift",
    "client/scripts/build.mjs",
    "client/package-lock.json",
    "client/app/vite.config.ts",
    "unknown/file",
    "tools/ci-selection.mjs",
    ".github/workflows/quality.yml",
  ]) {
    const result = select([file]);
    assert.equal(result.host, true, file);
    assert.deepEqual(result.browser, []);
    assert.deepEqual(result.native, []);
    assert.ok(result.quick.includes("client-vue"));
    assert.ok(result.quick.includes("client-scripts-unit"));
  }
  assert.equal(select(["unknown/file"]).full, true);
});

test("documentation, workshop, requirements and Pi changes retain shared checks without macOS", () => {
  for (const file of [
    "docs/guide.md",
    "README.md",
    "client/README.md",
    "client/workshop/src/Editor.vue",
    "requirements/data/goals.yaml",
    ".pi/extensions/example.ts",
  ]) {
    const result = select([file]);
    assert.equal(result.host, false, file);
    assert.equal(result.full, false, file);
    assert.deepEqual(result.browser, []);
    assert.deepEqual(result["workshop-chromium"], []);
    assert.deepEqual(result["workshop-webkit"], []);
  }
  assert.ok(
    select(["requirements/data/goals.yaml"]).checks.includes(
      "requirements-catalog",
    ),
  );
  assert.ok(select(["docs/guide.md"]).checks.includes("design-contracts"));
  assert.ok(select([".pi/extensions/example.ts"]).checks.includes("pi-unit"));
  assert.deepEqual(ids(select([])), select([]).quick);
});

test("unknown suites widen selection but cannot reactivate Linux browsers", () => {
  const result = select(["docs/guide.md"], {}, [
    ...inventory,
    { id: "new-browser", kind: "browser" },
    { id: "new-unit", kind: "unit" },
  ]);
  assert.equal(result.full, true);
  assert.equal(result.host, true);
  assert.ok(result.checks.includes("new-unit"));
  assert.deepEqual(result.browser, []);
});

test("explicit quick runs retain secret and static checks without dependency audits", () => {
  for (const options of [{ mode: "full", draft: true }, { mode: "quick" }]) {
    const result = select(["unknown/file"], options);
    assert.deepEqual(ids(result), result.quick);
    assert.equal(result.host, false);
    assert.equal(result.full, false);
    assert.ok(!ids(result).includes("root-audit"));
    for (const id of ["client-vue", "client-scripts-unit", "root-secrets"])
      assert.ok(result.quick.includes(id));
  }
});

test("dependency and unknown changes do not select vulnerability audits", () => {
  for (const draft of [false, true]) {
    for (const file of [
      "package-lock.json",
      "client/Cargo.lock",
      "unknown/file",
    ]) {
      const result = select([file], { draft });
      assert.ok(!ids(result).includes("root-audit"), file);
      assert.ok(ids(result).includes("root-secrets"), file);
    }
  }
});

test("draft changes run affected fast checks without builds or Apple jobs", () => {
  const result = select(["unknown/file"], { draft: true });
  assert.equal(result.host, false);
  assert.equal(result.full, false);
  assert.deepEqual(result.docker, []);
  for (const id of ids(result)) {
    const suite = inventory.find((entry) => entry.id === id);
    assert.ok(["unit", "check"].includes(suite.kind), id);
  }
  assert.ok(result.quick.includes("client-vue"));
  assert.ok(result.quick.includes("root-secrets"));
  assert.ok(result.checks.includes("pi-unit"));
  assert.ok(!result.checks.includes("requirements-build"));
});

test("document changes select only formatting, safety and their document consumers", () => {
  for (const draft of [false, true]) {
    for (const file of [
      "docs/architecture/concept.adoc",
      "design/concepts/navigation.md",
      "client/docs/guide.md",
      "README.md",
    ]) {
      const result = select([file], { draft });
      assert.deepEqual(
        ids(result),
        ["root-format", "root-secrets", "design-contracts"],
        file,
      );
      assert.equal(result.host, false, file);
      assert.equal(result.full, false, file);
      assert.deepEqual(result.docker, [], file);
    }
    const catalog = select(["requirements/data/goals/GOAL-9999.md"], { draft });
    assert.deepEqual(ids(catalog), [
      "root-format",
      "root-secrets",
      "requirements-unit",
      "requirements-catalog",
      "design-contracts",
    ]);
    assert.equal(catalog.host, false);
  }
});

test("functional Markdown and mixed document/code changes retain their consumers", () => {
  for (const [file, id] of [
    ["client/app/src/prompts/README.md", "client-vue"],
    ["client/app/tests/fixtures/README.md", "client-vue"],
    [".pi/role-mode/roles/developer/SYSTEM.md", "pi-unit"],
    ["design/brand/docs/motion.md", "design-unit"],
  ])
    assert.ok(ids(select([file])).includes(id), file);
  const mixed = select([
    "docs/architecture/concept.adoc",
    "client/app/src/Main.vue",
  ]);
  assert.equal(mixed.host, true);
  assert.ok(mixed.quick.includes("client-vue"));
  assert.ok(mixed.checks.includes("design-contracts"));
  assert.equal(select(["new-area/input.md"]).full, true);
});

test("malformed input and CLI options fail", () => {
  for (const options of [
    { mode: "other" },
    { files: "docs/a" },
    { files: [null] },
    { files: ["a\0b"] },
    { draft: "true" },
  ])
    assert.throws(() => selectCi(options, inventory));
  for (const args of [
    ["--mode", "changes"],
    ["--mode", "other"],
    ["--unit"],
    ["--draft=false"],
    ["--mode", "full", "--base", "a".repeat(40)],
  ])
    assert.throws(() => parseOptions(args));
  assert.equal(parseOptions([]).mode, "full");
  assert.equal(parseOptions(["--mode", "quick"]).mode, "quick");
  assert.throws(() => changedFiles("HEAD"), /full commit SHA/);
  assert.throws(() => changedFiles("f".repeat(40)));
});

test("merge-base diff includes deletions and both rename ends, not local changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "ci-selection-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init");
    git("config", "user.email", "ci@example.invalid");
    git("config", "user.name", "CI Fixture");
    mkdirSync(join(directory, "docs"));
    writeFileSync(join(directory, "docs/old name.md"), "old");
    writeFileSync(join(directory, "deleted.rs"), "delete");
    git("add", ".");
    git("commit", "-m", "Initial fixture");
    const base = git("rev-parse", "HEAD");
    git("checkout", "-b", "topic");
    renameSync(
      join(directory, "docs/old name.md"),
      join(directory, "docs/new\nname.md"),
    );
    rmSync(join(directory, "deleted.rs"));
    git("add", ".");
    git("commit", "-m", "Rename and delete");
    const head = git("rev-parse", "HEAD");
    git("checkout", "--detach", base);
    writeFileSync(join(directory, "base-only"), "base");
    git("add", ".");
    git("commit", "-m", "Advance base");
    const advanced = git("rev-parse", "HEAD");
    git("checkout", "--detach", head);
    writeFileSync(join(directory, "local-only"), "local");
    assert.deepEqual(changedFiles(advanced, directory), [
      "deleted.rs",
      "docs/new\nname.md",
      "docs/old name.md",
    ]);
    assert.equal(select(changedFiles(advanced, directory)).full, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI writes machine-readable GitHub outputs and rejects unresolved bases", () => {
  const directory = mkdtempSync(join(tmpdir(), "ci-output-"));
  const output = join(directory, "output");
  const env = { ...process.env, GITHUB_OUTPUT: output };
  delete env.NODE_TEST_CONTEXT;
  try {
    const run = (...args) =>
      spawnSync(process.execPath, ["tools/ci-selection.mjs", ...args], {
        cwd: root,
        env,
        encoding: "utf8",
      });
    const quick = run("--mode", "quick", "--output");
    assert.equal(quick.status, 0, quick.stderr);
    const result = JSON.parse(quick.stdout);
    assert.equal(readFileSync(output, "utf8"), githubOutputs(result));
    assert.match(
      readFileSync(output, "utf8"),
      /linux=\[\]\ndocker=false\nhost=false\nfull=false\nquick=true\n/,
    );
    assert.match(
      githubOutputs(select([], { mode: "full" })),
      /linux=\["checks"\]/,
    );
    const base = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const scoped = run("--mode", "quick", "--base", base);
    assert.equal(scoped.status, 0, scoped.stderr);
    assert.deepEqual(JSON.parse(scoped.stdout).quick, ["root-secrets"]);
    assert.deepEqual(JSON.parse(scoped.stdout).checks, []);
    for (const mode of ["changes", "quick"]) {
      const invalid = run("--mode", mode, "--base", "f".repeat(40));
      assert.equal(invalid.status, 2);
      assert.equal(invalid.stdout, "");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
