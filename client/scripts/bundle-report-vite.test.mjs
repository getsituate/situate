import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigFromFile } from "vite";

const client = dirname(dirname(fileURLToPath(import.meta.url)));

test("browser dependency optimization keeps the Vue compiler without provider SDKs", async () => {
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "development" },
    join(client, "app/vite.config.ts"),
  );
  assert.ok(loaded);
  assert.deepEqual(Object.keys(loaded.config.build.rolldownOptions.input), [
    "app",
  ]);
  const included = loaded.config.optimizeDeps?.include ?? [];
  assert.ok(included.includes("@vue/compiler-dom"));
  assert.ok(
    included.every(
      (entry) => !/@earendil-works\/pi-(?:ai|agent-core)(?:\/|$)/u.test(entry),
    ),
  );
});

test("browser build paths resolve escaped directories without a provider environment shim", async (t) => {
  const directory = await mkdtemp(join(client, "vite config # "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "vite.config.ts");
  await copyFile(join(client, "app/vite.config.ts"), configPath);
  const loaded = await loadConfigFromFile(
    { command: "build", mode: "production" },
    configPath,
  );
  assert.ok(loaded);
  assert.ok(
    loaded.config.server.fs.allow.some((path) => resolve(path) === directory),
  );
  assert.equal(loaded.config.build.license.fileName, "third-party-licenses.md");
  assert.ok(
    !loaded.config.plugins.some(
      (plugin) => plugin?.name === "pi-browser-environment",
    ),
  );
});
