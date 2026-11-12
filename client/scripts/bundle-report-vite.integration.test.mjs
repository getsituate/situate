import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import { bundleReport, checkBudget } from "./bundle-report.mjs";

const client = dirname(dirname(fileURLToPath(import.meta.url)));
const app = join(client, "app");
const configFile = join(app, "vite.config.ts");

test("the product build retains its app entry and measures shipped native renderers", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-product-bundle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await build({
    configFile,
    root: app,
    logLevel: "silent",
    build: { outDir: directory, emptyOutDir: true },
  });
  const manifest = JSON.parse(
    await readFile(join(directory, ".vite/manifest.json"), "utf8"),
  );
  assert.deepEqual(
    Object.keys(manifest).filter((key) => manifest[key].isEntry),
    ["index.html"],
  );
  const html = await readFile(join(directory, "index.html"), "utf8");
  assert.ok(html.includes(manifest["index.html"].file));
  assert.ok(!(await readdir(directory)).includes("executor.html"));
  const native = await readFile(join(directory, "executor-supervisor.js"));
  assert.ok(native.toString().includes("__SITUATE_EXECUTOR__"));
  const preview = await readFile(
    join(directory, "plugin-check-renderer.js"),
    "utf8",
  );
  assert.ok(preview.includes("plugin_preview_ack"));
  assert.ok(preview.includes("--situate-paper"));
  assert.ok(!preview.includes("process.env"));
  const report = await bundleReport(directory);
  const supervisor = report.chunks.find(
    ({ file }) => file === "executor-supervisor.js",
  );
  assert.deepEqual(supervisor, {
    file: "executor-supervisor.js",
    initial: false,
    bytes: native.length,
    gzipBytes: gzipSync(native).length,
  });
  const shipped = (await readdir(directory, { recursive: true }))
    .filter((file) => file.endsWith(".js"))
    .sort();
  assert.deepEqual(
    report.chunks.map(({ file }) => file),
    shipped,
  );
  const sizes = await Promise.all(
    shipped.map((file) => readFile(join(directory, file))),
  );
  assert.equal(
    report.allJavaScript.bytes,
    sizes.reduce((sum, bytes) => sum + bytes.length, 0),
  );
  assert.doesNotThrow(() => checkBudget(report));
  await rm(join(directory, "plugin-check-renderer.js"));
  await assert.rejects(bundleReport(directory), /plugin-check-renderer\.js/u);
  await writeFile(join(directory, "plugin-check-renderer.js"), preview);
  await rm(join(directory, "executor-supervisor.js"));
  await assert.rejects(bundleReport(directory), /executor-supervisor\.js/u);
}, 60_000);

test("real multi-page Vite builds preserve distinct entry bootstraps", async (t) => {
  const fixture = await mkdtemp(join(app, ".bundle-entry-test-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await writeFile(
    join(fixture, "index.html"),
    '<script type="module" src="./app.js"></script>',
  );
  await writeFile(
    join(fixture, "executor.html"),
    '<script type="module" src="./executor.js"></script>',
  );
  await writeFile(
    join(fixture, "app.js"),
    'globalThis.APP_ENTRY_MARKER = "app-only";',
  );
  await writeFile(
    join(fixture, "executor.js"),
    'globalThis.EXECUTOR_ENTRY_MARKER = "executor-only";',
  );
  const directory = join(fixture, "dist");
  await build({
    configFile,
    root: fixture,
    logLevel: "silent",
    build: {
      outDir: directory,
      rolldownOptions: {
        input: {
          app: join(fixture, "index.html"),
          executor: join(fixture, "executor.html"),
        },
      },
    },
  });
  const manifest = JSON.parse(
    await readFile(join(directory, ".vite/manifest.json"), "utf8"),
  );
  const entries = Object.values(manifest).filter((chunk) => chunk.isEntry);
  assert.equal(entries.length, 2);
  const appEntry = entries.find((chunk) => chunk.src === "index.html");
  const executorEntry = entries.find((chunk) => chunk.src === "executor.html");
  assert.ok(appEntry);
  assert.ok(executorEntry);
  assert.notEqual(appEntry.file, executorEntry.file);
  const appCode = await readFile(resolve(directory, appEntry.file), "utf8");
  const executorCode = await readFile(
    resolve(directory, executorEntry.file),
    "utf8",
  );
  assert.ok(appCode.includes("APP_ENTRY_MARKER"));
  assert.ok(!appCode.includes("EXECUTOR_ENTRY_MARKER"));
  assert.ok(executorCode.includes("EXECUTOR_ENTRY_MARKER"));
  assert.ok(!executorCode.includes("APP_ENTRY_MARKER"));
  const report = await bundleReport(directory);
  for (const entry of entries)
    assert.equal(
      report.chunks.find((chunk) => chunk.file === entry.file).initial,
      true,
    );
}, 30_000);
