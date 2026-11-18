import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
  new URL(
    "../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
    import.meta.url,
  ),
);
const config = fileURLToPath(
  new URL("../app/dependency-cruiser.cjs", import.meta.url),
);

function check(t, backEdge, { linkUI = true } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "situate-imports-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const files = {
    "app/tsconfig.json": '{"compilerOptions":{"module":"ESNext"}}',
    "app/src/Card.vue":
      '<script setup lang="ts">\nconst load = () => import("./loader");\nvoid load;\n</script>',
    "app/src/loader.ts":
      'export { value } from "@situate/ui"; export type Loader = () => void;',
    "app/src/one.test.ts": 'import "./two.test";',
    "app/src/two.test.ts": 'import "./one.test";',
    "packages/ui/package.json":
      '{"name":"@situate/ui","exports":"./src/index.ts"}',
    "packages/ui/src/index.ts": `${backEdge}\nexport const value = 1;`,
  };
  for (const [path, content] of Object.entries(files)) {
    const destination = join(cwd, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  if (linkUI) {
    const link = join(cwd, "node_modules", "@situate", "ui");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(join(cwd, "packages", "ui"), link, "junction");
  }
  const run = spawnSync(
    process.execPath,
    [cli, "--config", config, "app/src", "packages/ui/src"],
    { cwd, encoding: "utf8" },
  );
  assert.ifError(run.error);
  assert.equal(run.signal, null, run.stderr);
  return { status: run.status, output: run.stdout + run.stderr };
}

test("rejects a runtime cycle through a Vue dynamic import and a workspace export", (t) => {
  const { status, output } = check(t, 'import "../../../app/src/Card.vue";');
  assert.equal(status, 1, output);
  assert.match(output, /no-runtime-import-cycles/);
  for (const path of [
    "app/src/Card.vue",
    "app/src/loader.ts",
    "packages/ui/src/index.ts",
  ])
    assert.ok(output.includes(path), output);
});

test("ignores test modules and pure type import back edges", (t) => {
  const { status, output } = check(
    t,
    'import type { Loader } from "../../../app/src/loader"; export type { Loader };',
  );
  assert.equal(status, 0, output);
});

test("rejects an unresolved workspace import", (t) => {
  const { status, output } = check(t, "", { linkUI: false });
  assert.equal(status, 1, output);
  assert.match(output, /resolve-workspace-imports/);
});
