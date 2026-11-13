import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { cachedQualitySuite } from "./quality-cache.mjs";

const lint = {
  id: "root-lint",
  cwd: ".",
  command: "npm",
  args: ["run", "lint"],
};
const format = { ...lint, id: "root-format", args: ["run", "format:check"] };
const manifest = {
  scripts: {
    lint: "eslint . --max-warnings 0",
    "format:check": "prettier . --check",
  },
};
function put(directory, name, content) {
  const path = join(directory, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "quality-cache-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  put(directory, "package.json", JSON.stringify(manifest));
  for (const name of [
    "eslint.config.mjs",
    "tsconfig.quality.json",
    ".prettierignore",
  ])
    put(directory, name, readFileSync(new URL(`../${name}`, import.meta.url)));
  return directory;
}
function key(suite, directory, environment = {}) {
  const result = cachedQualitySuite(suite, directory, environment);
  assert.notEqual(result, suite, "expected caching to be enabled");
  assert.equal(result.command, process.execPath);
  assert.deepEqual(result.args.slice(1, 4), ["--run", directory, suite.id]);
  return result.args.at(-1);
}

test("preparation preserves plans and does not create caches or install dependencies", (t) => {
  const directory = fixture(t);
  const original = structuredClone([lint, format]);
  for (const suite of [lint, format])
    assert.equal(key(suite, directory), key(suite, directory));
  assert.deepEqual([lint, format], original);
  assert.equal(existsSync(join(directory, "node_modules")), false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(directory, "package.json"))),
    manifest,
  );
});

test("Docker lease paths do not change quality namespaces but semantic environment does", (t) => {
  const directory = fixture(t);
  for (const suite of [lint, format]) {
    const environment = {
      SITUATE_DOCKER_LEASE: "/tmp/lease-one/container.json",
      NODE_ENV: "test",
    };
    const original = key(suite, directory, environment);
    environment.SITUATE_DOCKER_LEASE = "/tmp/lease-two/container.json";
    assert.equal(key(suite, directory, environment), original);
    delete environment.SITUATE_DOCKER_LEASE;
    assert.equal(key(suite, directory, environment), original);
    environment.NODE_ENV = "production";
    assert.notEqual(key(suite, directory, environment), original);
  }
});

test("cross-file TS, Vue and declaration changes invalidate lint but retain Prettier's namespace", (t) => {
  const directory = fixture(t);
  for (const name of [
    "client/other.ts",
    "client/Other.vue",
    "client/generated/ignored.d.ts",
    "client/app/tests/fixtures/README.md",
  ]) {
    put(directory, name, "first");
    const before = [key(lint, directory), key(format, directory)];
    const path = join(directory, name);
    const { atime, mtime } = statSync(path);
    writeFileSync(path, "other");
    utimesSync(path, atime, mtime);
    assert.notEqual(key(lint, directory), before[0], name);
    assert.equal(key(format, directory), before[1], name);
    rmSync(path);
    assert.notEqual(key(lint, directory), before[0], name);
  }
});

test("ordinary documentation edits preserve the lint cache namespace", (t) => {
  const directory = fixture(t);
  const before = key(lint, directory);
  for (const name of ["README.md", "client/README.md", "docs/guide.md"]) {
    put(directory, name, "first");
    assert.equal(key(lint, directory), before);
    put(directory, name, "other");
    assert.equal(key(lint, directory), before);
    rmSync(join(directory, name));
    assert.equal(key(lint, directory), before);
  }
  put(directory, "tsconfig.quality.json", '{"include":["**/*"]}');
  const changedConfig = key(lint, directory);
  put(directory, "README.md", "new input");
  assert.notEqual(key(lint, directory), changedConfig);
});

test("format configuration, ignores and installation receipts invalidate both namespaces", (t) => {
  const directory = fixture(t);
  for (const name of [
    ".prettierrc.json",
    ".prettierrc.json5",
    ".editorconfig",
    ".prettierignore",
    ".gitignore",
    "client/package-lock.json",
    "node_modules/.package-lock.json",
    "node_modules/prettier/package.json",
  ]) {
    put(directory, name, "first");
    const before = [key(lint, directory), key(format, directory)];
    put(directory, name, "other");
    assert.notEqual(key(lint, directory), before[0], name);
    assert.notEqual(key(format, directory), before[1], name);
  }
});

test("typed lint includes tsconfigs and installed declarations regardless of Git ignores", (t) => {
  const directory = fixture(t);
  for (const name of [
    "client/app/tsconfig.json",
    "config/imported-rules.mjs",
    "client/node_modules/types/index.d.ts",
    "node_modules/types/package.json",
  ]) {
    put(directory, name, "first");
    const before = key(lint, directory);
    put(directory, name, "other");
    assert.notEqual(key(lint, directory), before, name);
  }
});

test("canonical exclusions prune large build trees and binaries without falling back", (t) => {
  const directory = fixture(t);
  const before = [key(lint, directory), key(format, directory)];
  for (const name of [
    "client/target/debug/huge",
    "client/dist/huge",
    "client/build/huge",
    "client/app/src-tauri/gen/huge",
    "asset.png",
  ]) {
    put(directory, name, "");
    truncateSync(join(directory, name), 2 * 1024 * 1024 * 1024);
  }
  put(directory, "node_modules/.cache/situate-quality/result", "cached");
  put(directory, ".git/index", "staged state");
  assert.equal(key(lint, directory), before[0]);
  assert.equal(key(format, directory), before[1]);
});

test("changed exclusion configuration cannot hide new sources in formerly ignored directories", (t) => {
  const directory = fixture(t);
  put(directory, "tsconfig.quality.json", '{"include":["client/**/*.ts"]}');
  const before = key(lint, directory);
  put(directory, "client/target/new.d.ts", "declare const value: number;");
  assert.notEqual(key(lint, directory), before);
});

test("changed ESLint exclusions retain uncached checks", (t) => {
  const directory = fixture(t);
  key(lint, directory);
  const config = readFileSync(join(directory, "eslint.config.mjs"), "utf8");
  const changed = config.replace('"**/target/**",', "");
  assert.notEqual(changed, config);
  put(directory, "eslint.config.mjs", changed);
  put(directory, "client/target/new.ts", "const value: number = 1;");
  assert.equal(cachedQualitySuite(lint, directory), lint);
});

test("worktrees and environments have independent fingerprints", (t) => {
  const first = fixture(t);
  const second = fixture(t);
  assert.notEqual(key(lint, first), key(lint, second));
  assert.notEqual(
    key(format, first, { MODE: "a" }),
    key(format, first, { MODE: "b" }),
  );
});

test("unsupported dynamic configs and commands retain uncached checks", (t) => {
  const directory = fixture(t);
  put(directory, "eslint.config.mjs", 'export { default } from "./rules.mjs";');
  assert.equal(cachedQualitySuite(lint, directory), lint);
  put(
    directory,
    "prettier.config.mjs",
    'export { default } from "./options.mjs";',
  );
  assert.equal(cachedQualitySuite(format, directory), format);
  for (const suite of [
    { ...lint, id: "client-types" },
    { ...lint, cwd: "client" },
    { ...lint, command: "cmd.exe" },
  ])
    assert.equal(cachedQualitySuite(suite, directory), suite);
});

test("Prettier plugins remain uncached across configuration formats", (t) => {
  const directory = fixture(t);
  for (const [name, content] of [
    [".prettierrc.json5", "{ plugins: ['./plugin.mjs'] }"],
    [".prettierrc.toml", "plugins = ['./plugin.mjs']"],
    [".prettierrc.yaml", "plugins:\n  - ./plugin.mjs"],
    [".prettierrc.json", '{"plugins":["./plugin.mjs"]}'],
  ]) {
    put(directory, name, content);
    assert.equal(cachedQualitySuite(format, directory), format, name);
    rmSync(join(directory, name));
  }
});

test("ancestor EditorConfig changes invalidate formatting; external configs disable caching", (t) => {
  const parent = fixture(t);
  const directory = join(parent, "workspace");
  put(directory, "package.json", JSON.stringify(manifest));
  put(parent, ".editorconfig", "root = true\n");
  const before = key(format, directory);
  put(parent, ".editorconfig", "root = false\n");
  assert.notEqual(key(format, directory), before);
  put(parent, "prettier.config.mjs", "export default {};\n");
  assert.equal(cachedQualitySuite(format, directory), format);
});
