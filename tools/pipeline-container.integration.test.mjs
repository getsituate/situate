import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { root, sourceFiles, suiteInventory } from "./test.mjs";
import { imageInputs } from "./ci-image.mjs";

test(
  "suite entry emits only progress events and saves its final report separately",
  {
    skip:
      process.env.SITUATE_TOOL_CONTAINER !== "1"
        ? "Requires the pinned tool container"
        : false,
  },
  (t) => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "situate-entry-protocol-")),
    );
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const repository = join(directory, "repository");
    for (const name of [
      ...imageInputs(root),
      "tools/ci-image.lock.json",
      "client/package-lock.json",
      "requirements/package-lock.json",
      "tools/commit-check.mjs",
      "tools/commit-policy.mjs",
    ]) {
      const destination = join(repository, name);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, name), destination);
    }
    for (const suite of suiteInventory(sourceFiles(root), "linux")) {
      if (!suite.args.includes("--test")) continue;
      const name = suite.args.find((argument) =>
        /\.test\.[cm]?js$/.test(argument),
      );
      if (!name) continue;
      const destination = join(repository, name);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, "");
    }
    for (const args of [
      ["init", "-q"],
      ["config", "user.name", "Synthetic Maintainer"],
      ["config", "user.email", "maintainer@example.invalid"],
      ["add", "."],
      ["commit", "-qm", "test: protocol fixture"],
    ]) {
      const git = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
      assert.equal(git.status, 0, git.stderr);
    }
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
      [
        join(root, "tools/pipeline-container-entry.mjs"),
        "suites",
        plan,
        report,
      ],
      {
        cwd: repository,
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
