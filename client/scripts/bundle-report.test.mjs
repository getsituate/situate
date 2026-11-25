import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  link,
  copyFile,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { bundleReport, checkBudget } from "./bundle-report.mjs";

test("production builds enforce the JavaScript budget", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../app/package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.scripts.postbuild, "node ../scripts/bundle-report.mjs");
});

test("initial bytes include shared static dependencies once but exclude lazy chunks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-bundle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, ".vite"));
  const providerFile = "assets/provider.js";
  const sharedFile = "assets/shared.js";
  await writeFile(
    join(directory, ".vite/manifest.json"),
    JSON.stringify({
      app: {
        file: "app.js",
        isEntry: true,
        imports: ["shared"],
        dynamicImports: ["provider"],
      },
      shared: { file: sharedFile, imports: ["app"] },
      provider: { file: providerFile, imports: ["shared"] },
    }),
  );
  await writeFile(join(directory, "app.js"), "app");
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, sharedFile), "shared");
  await writeFile(join(directory, providerFile), "provider");
  await writeFile(join(directory, "executor-supervisor.js"), "supervisor");
  await writeFile(join(directory, "plugin-check-renderer.js"), "preview");
  await writeFile(join(directory, "unlisted-worker.js"), "worker");
  const report = await bundleReport(directory);
  assert.deepEqual(report.initialJavaScript, {
    bytes: 9,
    gzipBytes: gzipSync("app").length + gzipSync("shared").length,
  });
  assert.equal(report.allJavaScript.bytes, 40);
  assert.equal(
    report.chunks.find((chunk) => chunk.file === "plugin-check-renderer.js")
      .initial,
    false,
  );
  assert.equal(
    report.chunks.find((chunk) => chunk.file === "executor-supervisor.js")
      .initial,
    false,
  );
  assert.equal(
    report.chunks.find((chunk) => chunk.file === "unlisted-worker.js").bytes,
    6,
  );
  assert.equal(
    report.chunks.find((chunk) => chunk.file === providerFile).initial,
    false,
  );
  assert.deepEqual(checkBudget(report, { bytes: 9, gzipBytes: 100 }), []);
  assert.throws(
    () => checkBudget(report, { bytes: 8, gzipBytes: 100 }),
    /exceeds/,
  );
  assert.match(
    checkBudget(report, { bytes: 100, gzipBytes: 1 })[0],
    /gzip warning threshold/,
  );
});

test("rejects chunk paths outside the build directory", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-bundle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, ".vite"));
  const manifest = join(directory, ".vite/manifest.json");
  for (const [file, reason] of [
    [join("..", "absent.js"), /Build manifest references a missing output/],
    [join("assets", "absent.js"), /Build manifest references a missing output/],
    [join(directory, "absent.js"), /Build artifact paths must be relative/],
  ]) {
    await writeFile(manifest, JSON.stringify({ app: { file, isEntry: true } }));
    await assert.rejects(bundleReport(directory), reason);
  }
});

test("rejects symbolic links for the manifest and chunk files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-bundle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, ".vite"));
  const manifest = join(directory, ".vite/manifest.json");
  await symlink(join(directory, "absent.json"), manifest);
  await assert.rejects(bundleReport(directory), /must not use a symbolic link/);
  await rm(manifest);
  await writeFile(
    manifest,
    JSON.stringify({ app: { file: "app.js", isEntry: true } }),
  );
  await symlink(join(directory, "absent.js"), join(directory, "app.js"));
  await writeFile(join(directory, "executor-supervisor.js"), "worker");
  await writeFile(join(directory, "plugin-check-renderer.js"), "worker");
  await assert.rejects(bundleReport(directory), /must not use a symbolic link/);
});

test("rejects directories and multiply linked build artifacts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-bundle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, ".vite"));
  await writeFile(
    join(directory, ".vite/manifest.json"),
    JSON.stringify({ app: { file: "app.js", isEntry: true } }),
  );
  await writeFile(join(directory, "executor-supervisor.js"), "worker");
  await writeFile(join(directory, "plugin-check-renderer.js"), "worker");
  const entry = join(directory, "app.js");
  await mkdir(entry);
  await assert.rejects(
    bundleReport(directory),
    /single-link regular build artifact: app\.js/,
  );
  await rm(entry, { recursive: true });
  await writeFile(join(directory, "fixture.txt"), "sample");
  await link(join(directory, "fixture.txt"), entry);
  await assert.rejects(
    bundleReport(directory),
    /single-link regular build artifact: app\.js/,
  );
});

test("the raw limit fails while gzip excess only returns a warning", () => {
  const report = (bytes, gzipBytes) => ({
    initialJavaScript: { bytes, gzipBytes },
  });
  assert.deepEqual(checkBudget(report(1_000_000, 140_000)), []);
  assert.throws(
    () => checkBudget(report(1_000_001, 140_000)),
    /uncompressed budget/,
  );
  assert.deepEqual(checkBudget(report(1_000_000, 140_001)), [
    "Initial JavaScript exceeds the gzip warning threshold (140000 bytes): 140001 gzip bytes.",
  ]);
  assert.throws(
    () => checkBudget(report(1_000_001, 140_001)),
    /uncompressed budget/,
  );
});

test("the CLI reports sizes, warns without failure for gzip, and fails for raw excess", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "situate-bundle-cli-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "app", "dist");
  await mkdir(join(directory, ".vite"), { recursive: true });
  await mkdir(join(root, "scripts"));
  for (const file of ["bundle-report.mjs", "ios-project-lock.mjs"])
    await copyFile(
      new URL(`./${file}`, import.meta.url),
      join(root, "scripts", file),
    );
  await writeFile(
    join(directory, ".vite/manifest.json"),
    JSON.stringify({ app: { file: "app.js", isEntry: true } }),
  );
  const script = join(root, "scripts", "bundle-report.mjs");
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

  await writeFile(join(directory, "app.js"), "app");
  await writeFile(join(directory, "executor-supervisor.js"), "supervisor");
  await writeFile(join(directory, "plugin-check-renderer.js"), "preview");
  const healthy = run();
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.equal(healthy.stderr, "");
  assert.equal(JSON.parse(healthy.stdout).initialJavaScript.bytes, 3);

  await writeFile(join(directory, "app.js"), randomBytes(150_000));
  const warning = run();
  assert.equal(warning.status, 0, warning.stderr);
  assert.ok(JSON.parse(warning.stdout).initialJavaScript.gzipBytes > 140_000);
  assert.match(warning.stderr, /gzip warning threshold/);

  await writeFile(join(directory, "app.js"), "x".repeat(1_000_001));
  const failure = run();
  assert.equal(failure.status, 1);
  assert.equal(JSON.parse(failure.stdout).initialJavaScript.bytes, 1_000_001);
  assert.match(failure.stderr, /uncompressed budget/);

  const override = run(join(root, "other"));
  assert.equal(override.status, 1);
  assert.match(override.stderr, /app\/dist/);

  await rm(directory, { recursive: true });
  const missing = run();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ENOENT/);
});

test("missing native renderer fails even when the app entry is valid", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-bundle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, ".vite"));
  await writeFile(
    join(directory, ".vite/manifest.json"),
    JSON.stringify({ app: { file: "app.js", isEntry: true } }),
  );
  await writeFile(join(directory, "app.js"), "app");
  await writeFile(join(directory, "plugin-check-renderer.js"), "preview");
  await assert.rejects(bundleReport(directory), /executor-supervisor\.js/u);
  await writeFile(join(directory, "executor-supervisor.js"), "supervisor");
  await rm(join(directory, "plugin-check-renderer.js"));
  await assert.rejects(bundleReport(directory), /plugin-check-renderer\.js/u);
});

test("missing build and empty manifest fail rather than reporting zero", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-bundle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(bundleReport(directory));
  await mkdir(join(directory, ".vite"));
  await writeFile(join(directory, ".vite/manifest.json"), "{}");
  await assert.rejects(bundleReport(directory), /No entry points/);
});
