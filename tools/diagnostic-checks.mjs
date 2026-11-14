import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { diagnosticPlan } from "./actions-adapter.mjs";
import { ordinaryEnvironment } from "./pipeline.mjs";
import { prepareContainerLane } from "./pipeline-container-entry.mjs";
import { runPlan } from "./test.mjs";

export async function main([selection, target] = process.argv.slice(2)) {
  const directory = fileURLToPath(new URL("../", import.meta.url));
  const plan = await diagnosticPlan(selection, target);
  if (target === "portable") {
    assert.equal(
      process.platform,
      "linux",
      "Portable diagnostics require Linux",
    );
    assert.equal(
      process.env.SITUATE_TOOL_CONTAINER,
      "1",
      "Use the tool-container launcher",
    );
    prepareContainerLane(directory, plan.suites);
  }
  if (target === "native")
    assert.equal(
      process.platform,
      "darwin",
      "Native diagnostics require macOS",
    );
  return runPlan(plan, {
    directory,
    environment: ordinaryEnvironment(),
    jobs: 1,
    output: process.stderr,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main()
    .then((report) => {
      console.log(JSON.stringify(report));
      if (report.status !== "passed") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
