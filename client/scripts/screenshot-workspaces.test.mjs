import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { screenshotPath } from "./screenshot-workspaces.mjs";

test("workshop capture paths use the chosen directory and stable filenames", () => {
  const output = join(tmpdir(), "workshop captures");
  assert.equal(
    screenshotPath(output, "ios", "first-entry-ai"),
    join(output, "ios-first-entry-ai.png"),
  );
  for (const scene of [
    "",
    "First Entry",
    "folder/scene",
    "scene.png",
    "scene\n",
  ])
    assert.throws(
      () => screenshotPath(output, "ios", scene),
      /Invalid workshop scenario/,
    );
  assert.throws(
    () => screenshotPath(output, "other", "welcome"),
    /Invalid workshop screenshot profile/,
  );
});

test("workshop capture rejects output outside test-results before creating directories", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "situate-workshop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "captures");
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./screenshot-workspaces.mjs", import.meta.url)),
      output,
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 1, result.error?.message);
  assert.match(result.stderr, /Path must stay inside/);
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test(
  "workshop capture paths reject existing symlinks",
  { skip: process.platform === "win32" },
  async (t) => {
    const output = await mkdtemp(join(tmpdir(), "situate-workshop-"));
    t.after(() => rm(output, { recursive: true, force: true }));
    await symlink(join(output, "absent.png"), join(output, "mac-welcome.png"));
    assert.throws(
      () => screenshotPath(output, "mac", "welcome"),
      /must not use a symbolic link/,
    );
  },
);
