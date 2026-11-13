import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { root } from "./test.mjs";

test(
  "suite entry emits only progress events and saves its final report separately",
  {
    skip:
      process.env.SITUATE_TOOL_CONTAINER !== "1"
        ? "Requires the pinned tool container"
        : false,
  },
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), "situate-entry-protocol-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const plan = join(directory, "plan.json");
    const report = join(directory, "report.json");
    writeFileSync(
      plan,
      JSON.stringify({
        profile: "supported",
        scope: "supported",
        suiteIds: ["root-commits"],
      }),
    );
    const child = spawnSync(
      process.execPath,
      ["tools/pipeline-container-entry.mjs", "suites", plan, report],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 60000,
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const events = child.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.type),
      ["suite", "result"],
    );
    assert.deepEqual(
      events.map((event) => event.id ?? event.result.id),
      ["root-commits", "root-commits"],
    );
    const result = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(result.status, "passed");
    assert.deepEqual(
      result.results.map(({ id, status }) => ({ id, status })),
      [{ id: "root-commits", status: "passed" }],
    );
  },
);
