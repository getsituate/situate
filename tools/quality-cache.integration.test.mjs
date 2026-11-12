import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cachedQualitySuite } from "./quality-cache.mjs";

const dependencies = realpathSync(
  fileURLToPath(new URL("../node_modules", import.meta.url)),
);

function fixture(t, id, script, command) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "quality-cache-cli-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // Keep scan cost independent of unrelated tools installed in the repository.
  const packages =
    id === "root-lint"
      ? [
          "eslint",
          "@eslint/js",
          "globals",
          "typescript-eslint",
          "typescript",
          "eslint-plugin-vue",
          "vue-eslint-parser",
        ]
      : ["prettier"];
  for (const name of packages) {
    const destination = join(directory, "node_modules", name);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(join(dependencies, name), destination, "dir");
  }
  const binary = id === "root-lint" ? "eslint" : "prettier";
  mkdirSync(join(directory, "node_modules/.bin"), { recursive: true });
  symlinkSync(
    join(dependencies, ".bin", binary),
    join(directory, "node_modules/.bin", binary),
    "file",
  );
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ scripts: { [script]: command } }),
  );
  const cacheDirectory = join(
    directory,
    "node_modules/.cache/situate-quality",
    createHash("sha256").update(directory).digest("hex"),
  );
  t.after(() => rmSync(cacheDirectory, { recursive: true, force: true }));
  const suite = { id, cwd: ".", command: "npm", args: ["run", script] };
  const run = (cached = true) => {
    const selected = cached ? cachedQualitySuite(suite, directory) : suite;
    if (cached) {
      assert.notEqual(
        selected,
        suite,
        "cache should be usable in this fixture",
      );
      assert.equal(selected.command, process.execPath);
    }
    const result = spawnSync(selected.command, selected.args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.error, undefined);
    return {
      code: result.status,
      output: result.stdout + result.stderr,
      cache: cached ? selected.args.at(-1) : null,
    };
  };
  return { directory, run, cacheDirectory };
}

test("warm typed ESLint cache detects a promise introduced only in an imported source", (t) => {
  const { directory, run, cacheDirectory } = fixture(
    t,
    "root-lint",
    "lint",
    "eslint . --max-warnings 0",
  );
  for (const name of [
    "eslint.config.mjs",
    "tsconfig.quality.json",
    ".prettierignore",
  ])
    writeFileSync(
      join(directory, name),
      readFileSync(new URL(`../${name}`, import.meta.url)),
    );
  mkdirSync(join(directory, "client/app/src"), { recursive: true });
  writeFileSync(
    join(directory, "client/app/tsconfig.json"),
    '{"compilerOptions":{"target":"ES2022"}}\n',
  );
  const consumer = 'import { save } from "./service";\nsave();\n';
  writeFileSync(join(directory, "client/app/src/consumer.ts"), consumer);
  writeFileSync(
    join(directory, "client/app/src/service.ts"),
    "export function save(): void {}\n",
  );
  const first = run();
  assert.equal(first.code, 0, first.output);
  const warm = run();
  assert.equal(warm.code, 0, warm.output);
  assert.equal(warm.cache, first.cache);
  writeFileSync(
    join(directory, "client/app/src/service.ts"),
    "export async function save(): Promise<void> {}\n",
  );
  for (const cached of [true, false]) {
    const result = run(cached);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /no-floating-promises/);
    if (cached) assert.notEqual(result.cache, first.cache);
  }
  assert.equal(
    readFileSync(join(directory, "client/app/src/consumer.ts"), "utf8"),
    consumer,
  );
  assert.deepEqual(readdirSync(cacheDirectory).sort(), [
    "root-lint.cache",
    "root-lint.key",
  ]);
});

test("warm Prettier cache detects changed EditorConfig and preserves source", (t) => {
  const { directory, run, cacheDirectory } = fixture(
    t,
    "root-format",
    "format:check",
    "prettier . --check",
  );
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify(
      { scripts: { "format:check": "prettier . --check" } },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(directory, ".editorconfig"),
    "root = true\n[*]\nindent_style = space\nindent_size = 2\n",
  );
  const source = "const value = {\n  nested: {\n    value: 1,\n  },\n};\n";
  writeFileSync(join(directory, "source.js"), source);
  const first = run();
  assert.equal(first.code, 0, first.output);
  const warm = run();
  assert.equal(warm.code, 0, warm.output);
  assert.equal(warm.cache, first.cache);
  writeFileSync(join(directory, "source.js"), source + "const other = 2;\n");
  const edited = run();
  assert.equal(edited.code, 0, edited.output);
  assert.equal(edited.cache, first.cache);
  writeFileSync(join(directory, "source.js"), "const value={nested:1}\n");
  const malformed = run();
  assert.equal(malformed.code, 1, malformed.output);
  assert.equal(malformed.cache, first.cache);
  writeFileSync(join(directory, "source.js"), source);
  writeFileSync(
    join(directory, ".editorconfig"),
    "root = true\n[*]\nindent_style = space\nindent_size = 4\n",
  );
  for (const cached of [true, false]) {
    const result = run(cached);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /source.js/);
    if (cached) assert.notEqual(result.cache, first.cache);
  }
  assert.equal(readFileSync(join(directory, "source.js"), "utf8"), source);
  assert.deepEqual(readdirSync(cacheDirectory).sort(), [
    "root-format.cache",
    "root-format.key",
  ]);
});
