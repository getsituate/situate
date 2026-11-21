#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { availableParallelism, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { cargoCacheSampler } from "./release-build-cache.mjs";

const args = process.argv.slice(2);
const targetIndex = args.lastIndexOf("--target");
const target = targetIndex < 0 ? null : args[targetIndex + 1];
const finishCacheSample = cargoCacheSampler(process.env);
const started = performance.now();
const result = spawnSync("cargo", args, { stdio: "inherit" });
const elapsedSeconds = Math.round(performance.now() - started) / 1000;
const cache = finishCacheSample();
console.log(
  JSON.stringify({
    phase: "release-cargo",
    target,
    elapsedSeconds,
    exitCode: result.status,
    signal: result.signal,
    availableCpus: availableParallelism(),
    memoryBytes: totalmem(),
    cache,
  }),
);
if (result.error) console.error("Could not start Cargo.");
process.exitCode = result.status ?? 1;
