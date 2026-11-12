import assert from "node:assert/strict";
import test from "node:test";
import { requireSelected } from "./ci-required.mjs";
import { selectCi, githubOutputs } from "./ci-selection.mjs";
import { root, sourceFiles, suiteInventory } from "./test.mjs";

const inventory = suiteInventory(sourceFiles(root), "linux");
function fixture(mode = "full", files = []) {
  const selection = selectCi({ mode, files }, inventory);
  const outputs = Object.fromEntries(
    githubOutputs(selection)
      .trim()
      .split("\n")
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  return {
    plan: { result: "success", outputs },
    quick: { result: "success" },
    security: { result: "success" },
    linux: { result: selection.checks.length ? "success" : "skipped" },
    docker: { result: selection.docker.length ? "success" : "skipped" },
    host: { result: selection.host ? "success" : "skipped" },
  };
}

test("all selected jobs, including macOS, must succeed; only unselected jobs may skip", () => {
  for (const [mode, files] of [
    ["full", []],
    ["quick", []],
    ["changes", ["client/app/src/Main.vue"]],
    ["changes", ["docs/guide.md"]],
  ]) {
    assert.doesNotThrow(() => requireSelected(fixture(mode, files)));
    for (const name of ["quick", "linux", "docker", "host", "security"]) {
      for (const result of [
        "failure",
        "cancelled",
        "skipped",
        "success",
        undefined,
      ]) {
        const needs = fixture(mode, files);
        if (needs[name].result === result) continue;
        needs[name].result = result;
        assert.throws(() => requireSelected(needs), new RegExp(name));
      }
    }
  }
});

test("missing, failed and inconsistent plans cannot turn skipped jobs green", () => {
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    const needs = fixture();
    needs.plan.result = result;
    assert.throws(() => requireSelected(needs), /selection/);
  }
  for (const change of [
    { selection: "{}" },
    { selection: "not json" },
    { linux: '["native"]' },
    { host: "false" },
    { docker: "false" },
    { full: "false" },
    { selection: undefined },
  ]) {
    const needs = fixture();
    Object.assign(needs.plan.outputs, change);
    assert.throws(() => requireSelected(needs));
  }
  const needs = fixture();
  needs.plan.outputs = { skipped: "true" };
  assert.throws(() => requireSelected(needs));
});

test("deferred shards, empty quick checks, and full plans without macOS fail", () => {
  for (const change of [
    { quick: [] },
    { browser: ["client-browser"] },
    { native: ["client-native"] },
    { scope: "extended" },
    { host: false },
  ]) {
    const needs = fixture();
    const selection = JSON.parse(needs.plan.outputs.selection);
    Object.assign(selection, change);
    needs.plan.outputs.selection = JSON.stringify(selection);
    if (change.host === false) needs.plan.outputs.host = "false";
    assert.throws(() => requireSelected(needs));
  }
});
