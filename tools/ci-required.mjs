import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { linuxShards, shards } from "./ci-shard.mjs";

export function requireSelected(results) {
  if (results.plan?.result !== "success")
    throw new Error("CI selection did not succeed.");
  const outputs = results.plan.outputs;
  const selection = JSON.parse(outputs?.selection);
  const linux = JSON.parse(outputs.linux);
  if (selection.scope !== "mvp")
    throw new Error("CI selection must use MVP scope.");
  for (const shard of shards)
    if (!Array.isArray(selection[shard]))
      throw new Error(`CI selection is missing ${shard}.`);
  if (!selection.quick.length)
    throw new Error("Quick checks must not be empty.");
  for (const shard of [
    "browser",
    "workshop-chromium",
    "workshop-webkit",
    "native",
  ])
    if (selection[shard].length)
      throw new Error(`Deferred CI shard selected: ${shard}.`);
  const selectedLinux = linuxShards.filter(
    (shard) => selection[shard].length > 0,
  );
  if (JSON.stringify(linux) !== JSON.stringify(selectedLinux))
    throw new Error("Linux matrix does not match the CI selection.");
  for (const name of ["host", "full"])
    if (
      typeof selection[name] !== "boolean" ||
      outputs[name] !== String(selection[name])
    )
      throw new Error(`CI selection has inconsistent ${name} status.`);
  if (selection.full && !selection.host)
    throw new Error("Full MVP checks require the Apple host.");
  if (outputs.docker !== String(selection.docker.length > 0))
    throw new Error("Docker job does not match the CI selection.");
  const expected = {
    quick: true,
    linux: linux.length > 0,
    docker: selection.docker.length > 0,
    host: selection.host,
    security: true,
  };
  const failed = [];
  for (const [name, selected] of Object.entries(expected)) {
    const wanted = selected ? "success" : "skipped";
    if (results[name]?.result !== wanted) failed.push(`${name} (${wanted})`);
  }
  if (failed.length)
    throw new Error(
      `Required job outcomes were not met: ${failed.join(", ")}.`,
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    requireSelected(JSON.parse(process.env.RESULTS));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
