import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { root } from "./test.mjs";

const quality = readFileSync(
  join(root, ".github/workflows/quality.yml"),
  "utf8",
);
const coverage = readFileSync(
  join(root, ".github/workflows/coverage.yml"),
  "utf8",
);

function job(name) {
  const body = quality.match(
    new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z]+:|$)`),
  )?.[1];
  assert.ok(body, name);
  return body;
}

test("workflow events emit the MVP selection consumed by downstream jobs", () => {
  const script = quality.match(
    / {10}case "\$EVENT"[\s\S]*?node tools\/ci-selection\.mjs[^\n]+/,
  )?.[0];
  assert.ok(script);
  const base = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  for (const [event, mode, draft, full] of [
    ["push", "full", "false", false],
    ["pull_request", "full", "false", false],
    ["pull_request", "full", "true", false],
    ["workflow_dispatch", "full", "false", true],
    ["workflow_dispatch", "quick", "false", false],
  ]) {
    const directory = mkdtempSync(join(tmpdir(), "ci-workflow-"));
    try {
      const output = join(directory, "outputs");
      const env = {
        ...process.env,
        EVENT: event,
        MODE: mode,
        DRAFT: draft,
        BASE_SHA: base,
        GITHUB_OUTPUT: output,
      };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync("bash", ["-euo", "pipefail", "-c", script], {
        cwd: root,
        env,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      const values = Object.fromEntries(
        readFileSync(output, "utf8")
          .trim()
          .split("\n")
          .map((line) => {
            const split = line.indexOf("=");
            return [line.slice(0, split), line.slice(split + 1)];
          }),
      );
      const selection = JSON.parse(values.selection);
      assert.equal(selection.scope, "mvp");
      assert.equal(selection.full, full, `${event}/${mode}/${draft}`);
      assert.equal(values.host, String(full));
      assert.equal(values.windows, undefined);
      assert.deepEqual(JSON.parse(values.linux), full ? ["checks"] : []);
      assert.ok(selection.quick.length > 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("Apple browser diagnostics survive failed browser checks", () => {
  const step = job("host").match(
    / {6}- name: Retain browser diagnostics\n([\s\S]*?)(?= {6}- name:)/,
  )?.[1];
  assert.ok(step);
  assert.match(step, /if: always\(\)/);
  assert.match(step, /uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(step, /name: apple-browser-diagnostics/);
  assert.match(step, /client\/test-results\/browser\//);
  assert.match(step, /retention-days: 7/);
  assert.match(step, /if-no-files-found: ignore/);
  assert.doesNotMatch(step, /workshop|visual/);
});

test("shared Linux jobs retain results and downloads without native build caches", () => {
  const linux = job("linux");
  assert.match(linux, /fail-fast: false/);
  assert.doesNotMatch(linux, /continue-on-error|rust-build-cache/);
  assert.match(
    linux,
    /shard: \$\{\{ fromJSON\(needs.plan.outputs.linux\) \}\}/,
  );
  assert.match(linux, /name: linux-\$\{\{ matrix.shard \}\}-results/);
  assert.equal(
    (linux.match(/uses: \.\/\.github\/actions\/download-cache/g) ?? []).length,
    2,
  );
  assert.equal(
    (linux.match(/group: \$\{\{ matrix.shard \}\}/g) ?? []).length,
    2,
  );
  assert.match(linux, /phase: save/);
  assert.match(linux, /if: always\(\)/);
  assert.doesNotMatch(linux, /Retain visual comparisons|workshop-chromium/);
});

test("Apple checks run alongside quick checks and the aggregate enforces both", () => {
  for (const name of ["linux", "docker"]) {
    const body = job(name);
    assert.match(body, /needs: \[plan, quick\]/);
    assert.match(body, /if: needs.plan.outputs\./);
  }
  const host = job("host");
  assert.match(host, /needs: plan\n/);
  assert.match(host, /if: needs.plan.outputs.host == 'true'/);
  assert.match(host, /npm run test:browser -- --forbid-only/);
  assert.match(host, /cargo test --workspace --locked/);
  assert.match(
    host,
    /DEVELOPER_DIR: \/Applications\/Xcode_26\.0\.1\.app\/Contents\/Developer/,
  );
  assert.match(
    host,
    /swift test --package-path client\/app\/src-tauri\/dictation --disable-automatic-resolution/,
  );
  assert.match(host, /node scripts\/test-native.mjs/);
  assert.doesNotMatch(host, /continue-on-error|needs: \[plan, quick\]/);
  assert.match(
    job("required"),
    /needs: \[plan, quick, linux, docker, host, security\]/,
  );
  assert.match(job("required"), /node tools\/ci-required.mjs/);
  assert.equal(
    (
      quality.match(
        /SITUATE_CI_SELECTION: \$\{\{ needs.plan.outputs.selection \}\}/g,
      ) ?? []
    ).length,
    3,
  );
  assert.match(quality, /ready_for_review, converted_to_draft/);
  assert.doesNotMatch(quality, /^ {2}(windows|coverage|schedule):/m);
  assert.doesNotMatch(
    quality,
    /full-quality-v1|steps.weekly|workflows\/coverage.yml/,
  );
  assert.doesNotMatch(coverage, /^ {2}(pull_request|push|schedule):/m);
  assert.match(coverage, /^ {2}workflow_dispatch:/m);
});
