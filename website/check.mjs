import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "./site.mjs";
import { readImageLock } from "../tools/ci-image.mjs";

export async function checkWebsite([mode = "check", input, ...extra] = []) {
  assert(
    extra.length === 0 &&
      (input ? mode === "prepared" : ["check", "update"].includes(mode)),
    "Use website check, website update, or website prepared <directory>.",
  );
  assert(
    mode !== "update" || process.env.WEBSITE_BASELINE_UPDATE === "1",
    "Update website baselines through the local tool-container launcher.",
  );
  assert(
    process.platform === "linux" &&
      process.arch === "x64" &&
      process.env.SITUATE_CI_IMAGE === readImageLock(process.cwd()).image,
    "Use python3 tools/pipeline-container.py website check|update.",
  );
  const temporary = await mkdtemp(join(tmpdir(), "situate-website-build-"));
  try {
    const directory = input
      ? resolve(input)
      : await build(temporary, { analyticsToken: "" });
    const environment = {
      ...process.env,
      WEBSITE_BUILD: directory,
      WEBSITE_VISUAL_REPORT: resolve("test-results/website-visual"),
      WEBSITE_BROWSER_CHANNEL: "",
    };
    function run(args) {
      const result = spawnSync(process.execPath, args, {
        env: environment,
        stdio: "inherit",
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, "Website checks failed");
    }
    await rm(environment.WEBSITE_VISUAL_REPORT, {
      recursive: true,
      force: true,
    });
    run([
      "client/node_modules/@playwright/test/cli.js",
      "test",
      "--config",
      "website/visual.config.mjs",
      `--update-snapshots=${mode === "update" ? "all" : "none"}`,
    ]);
    if (mode !== "update") run(["website/browser.test.mjs"]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await checkWebsite(process.argv.slice(2));
