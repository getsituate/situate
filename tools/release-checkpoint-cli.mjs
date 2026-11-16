import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createHostCheckpointStore } from "../infrastructure/releases/checkpoint.mjs";
import { withReleaseSSH } from "./release-environment.mjs";
import { coordinated, runCoordinated } from "./run-coordinated.mjs";

export async function main(
  argv = process.argv.slice(2),
  {
    root = resolve(import.meta.dirname, ".."),
    environment = process.env,
    store,
  } = {},
) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      operation: { type: "string" },
      destination: { type: "string" },
      output: { type: "string" },
    },
  });
  assert.deepEqual(
    positionals,
    ["bootstrap"],
    "Use bootstrap --operation ID --destination SSH_HOST --output FRESH_DIRECTORY",
  );
  assert(
    values.operation && values.destination && values.output,
    "Select the exact operation, private host and fresh output directory",
  );
  const run = (environment) =>
    (
      store ??
      createHostCheckpointStore(
        {
          WEBSITE_DEPLOY_HOST: values.destination,
          WEBSITE_SSH_IDENTITY: environment.WEBSITE_SSH_IDENTITY,
          WEBSITE_SSH_KNOWN_HOSTS: environment.WEBSITE_SSH_KNOWN_HOSTS,
        },
        { environment },
      )
    ).bootstrap({ operationId: values.operation, destination: values.output });
  return store ? run(environment) : withReleaseSSH({ root, environment }, run);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(import.meta.dirname, "..");
  try {
    if (!coordinated(root))
      process.exitCode = await runCoordinated({
        directory: root,
        command: process.execPath,
        args: process.argv.slice(1),
        cleanupGraceMs: 90_000,
      });
    else process.stdout.write(`${JSON.stringify(await main())}\n`);
  } catch {
    process.stderr.write(
      "Checkpoint bootstrap blocked; inspect private storage\n",
    );
    process.exitCode = 1;
  }
}
