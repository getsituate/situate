import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

async function fixture(t) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "requirements-preview-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of [
    "package.json",
    "src",
    "scripts",
    "index.html",
    "vite.config.js",
  ]) {
    await cp(path.join(root, name), path.join(directory, name), {
      recursive: true,
    });
  }
  await cp(path.join(root, "tests/fixtures"), path.join(directory, "data"), {
    recursive: true,
  });
  await symlink(
    path.join(root, "node_modules"),
    path.join(directory, "node_modules"),
  );
  return directory;
}

function launch(t, directory) {
  const child = spawn(
    process.execPath,
    [path.join(directory, "scripts/preview.js")],
    {
      cwd: os.tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const closed = once(child, "close");
  let output = "";
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(
        /Requirements preview: (http:\/\/127\.0\.0\.1:\d+\/)/,
      );
      if (match) resolve(match[1]);
    });
    child.on("error", reject);
    child.on("close", () => resolve(null));
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 15000);
  t.after(async () => {
    child.kill("SIGTERM");
    await closed;
    clearTimeout(deadline);
  });
  return { child, closed, ready, output: () => output };
}

test(
  "preview builds before serving on loopback and closes on cancellation",
  { timeout: 20000 },
  async (t) => {
    const directory = await fixture(t);
    const run = launch(t, directory);
    const url = await run.ready;
    assert.ok(url, run.output());
    const response = await fetch(url);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /assets\/index-.*\.js/);
    assert.doesNotMatch(html, /src\/main.js/);
    run.child.kill("SIGTERM");
    // Vite's SIGTERM handler can exit with the signal's conventional status.
    assert.ok([0, 143].includes((await run.closed)[0]));
    await assert.rejects(fetch(url));
  },
);

test(
  "invalid catalog never announces a ready preview",
  { timeout: 20000 },
  async (t) => {
    const directory = await fixture(t);
    await writeFile(
      path.join(directory, "data/requirements/invalid.md"),
      "No metadata",
    );
    const run = launch(t, directory);
    assert.equal(await run.ready, null);
    assert.equal((await run.closed)[0], 1);
    assert.match(run.output(), /metadata is missing/);
    assert.doesNotMatch(run.output(), /Requirements preview:/);
  },
);
