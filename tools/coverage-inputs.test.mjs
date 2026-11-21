import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { measure } from "./coverage.mjs";

const lcov = "SF:src/a.ts\nDA:1,1\nend_of_record\n";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-coverage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, "checkout");
  execFileSync("git", ["init", "--quiet", checkout]);
  for (const file of [
    "tools/test.mjs",
    "tools/example.test.mjs",
    "tools/example.integration.test.mjs",
    "client/scripts/example.test.mjs",
    "client/scripts/example.integration.test.mjs",
    "requirements/tests/example.test.js",
    "requirements/tests/example.integration.test.js",
  ]) {
    mkdirSync(dirname(join(checkout, file)), { recursive: true });
    writeFileSync(
      join(checkout, file),
      file === "tools/test.mjs" ? "--coverage" : "",
    );
  }
  return { root, checkout };
}

test("coverage rejects an aliased output parent before preparing or clearing reports", async (t) => {
  const { root, checkout } = fixture(t);
  const outside = join(root, "outside");
  mkdirSync(join(outside, "coverage"), { recursive: true });
  const retained = join(outside, "coverage", "keep.txt");
  writeFileSync(retained, "keep");
  symlinkSync(outside, join(checkout, "client", "target"), "dir");
  let prepared = false;
  assert.deepEqual(
    await measure(checkout, {
      platform: "darwin",
      prepare: () => {
        prepared = true;
      },
    }),
    { status: "failed" },
  );
  assert.equal(prepared, false);
  assert.equal(readFileSync(retained, "utf8"), "keep");
});

test("coverage consumes bounded regular reports from the checkout", async (t) => {
  const { root, checkout } = fixture(t);
  const outside = join(root, "outside.lcov");
  writeFileSync(outside, lcov);
  const output = join(checkout, "client/target/coverage");
  mkdirSync(output, { recursive: true });
  const retained = join(output, "keep.txt");
  writeFileSync(retained, "keep");
  for (const source of ["ordinary", "oversize", "alias"]) {
    const result = await measure(checkout, {
      platform: "darwin",
      prepare: async () => ({ release() {} }),
      execute: async (suite) => {
        const reports = join(checkout, "client/target/coverage");
        mkdirSync(join(reports, "vue"), { recursive: true });
        writeFileSync(join(reports, "vue/lcov.info"), lcov);
        const rust = join(reports, "rust.lcov");
        if (source === "alias") {
          if (suite.id === "client-rust-coverage") symlinkSync(outside, rust);
        } else {
          writeFileSync(rust, lcov);
          if (source === "oversize") truncateSync(rust, 64 * 1024 * 1024 + 1);
        }
        return { status: "passed" };
      },
    });
    assert.equal(readFileSync(retained, "utf8"), "keep");
    assert.deepEqual(
      result,
      source === "ordinary"
        ? {
            status: "measured",
            vue: { found: 1, hit: 1 },
            rust: { found: 1, hit: 1 },
          }
        : { status: "failed" },
      source,
    );
  }
});
