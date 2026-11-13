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
const job = (name) =>
  quality.match(
    new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z]+:|$)`),
  )?.[1];

test("Quality runs only active MVP jobs and leaves coverage explicitly manual", () => {
  assert.doesNotMatch(
    quality,
    /^ {2}(schedule|windows|coverage):|weekly|full-quality-v1/m,
  );
  assert.match(quality, /options: \[full, quick\]\n {8}default: full/);
  assert.match(job("required"), /if: always\(\)/);
  assert.match(
    job("required"),
    /needs: \[plan, quick, linux, docker, host, security\]/,
  );
  assert.match(job("required"), /node tools\/ci-required.mjs/);
  assert.match(job("security"), /--shard history/);
  assert.doesNotMatch(
    job("linux"),
    /rust-build-cache|visual|browser-diagnostics/,
  );
  const coverage = readFileSync(
    join(root, ".github/workflows/coverage.yml"),
    "utf8",
  );
  assert.match(coverage, /^ {2}workflow_dispatch:/m);
  assert.doesNotMatch(coverage, /^ {2}(schedule|push|pull_request):/m);
});

test("Rust advisories retain a scheduled and manual audit alongside Dependabot", () => {
  const audit = readFileSync(
    join(root, ".github/workflows/dependency-audit.yml"),
    "utf8",
  );
  assert.match(audit, /^ {2}schedule:/m);
  assert.match(audit, /^ {2}workflow_dispatch:/m);
  assert.doesNotMatch(audit, /^ {2}(pull_request|push):/m);
  assert.match(audit, /exec node tools\/quality\.mjs rust-audit/);
  assert.doesNotMatch(audit, /matrix:|ECOSYSTEM|check=audit|npm/);
  assert.match(audit, /\.\/\.github\/actions\/ci-image/);
  assert.doesNotMatch(quality, /dependency-audit|rust-audit/);
});

test("Dependabot limits routine dependency updates without disabling security updates", () => {
  const config = readFileSync(join(root, ".github/dependabot.yml"), "utf8");
  assert.match(config, /^version: 2/m);
  for (const ecosystem of ["npm", "cargo", "github-actions"])
    assert.ok(config.includes(`package-ecosystem: ${ecosystem}`));
  for (const directory of ["/", "/client", "/requirements", "/tools/dev-tui"])
    assert.ok(config.includes(`- ${directory}\n`));
  assert.equal((config.match(/open-pull-requests-limit: 0/g) ?? []).length, 2);
  assert.doesNotMatch(config, /ignore:/);
  assert.equal((config.match(/applies-to: security-updates/g) ?? []).length, 2);
  assert.equal((config.match(/prefix: "fix\(deps\)"/g) ?? []).length, 2);
  assert.match(config, /open-pull-requests-limit: 5/);
  assert.match(config, /prefix: "ci\(deps\)"/);
});

test("macOS starts after planning and retains product browsers, Rust and Swift checks", () => {
  const host = job("host");
  assert.match(host, /needs: plan\n/);
  assert.doesNotMatch(host, /needs: \[plan, quick\]/);
  assert.match(host, /if: needs.plan.outputs.host == 'true'/);
  assert.match(host, /os: \[macos-15\]/);
  assert.doesNotMatch(host.split("    steps:")[0], /runner\.temp/);
  for (const name of [
    "Native workspace fixture journeys",
    "Native agent fixture journey",
    "Native onboarding fixture journey",
    "Native plugin fixture journey",
  ]) {
    const step = host.match(
      new RegExp(`- name: ${name}\\n([\\s\\S]*?)(?= {6}-)`),
    )?.[1];
    assert.ok(step, name);
    assert.match(
      step,
      /CARGO_HOME: \$\{\{ runner.temp \}\}\/situate-downloads\/cargo/,
    );
  }
  for (const command of [
    "npx playwright install chromium webkit",
    "npm run test:browser -- --forbid-only",
    "cargo test --workspace --locked --no-fail-fast",
    "cargo clippy --workspace --all-targets --locked",
    "node scripts/test-native.mjs",
    "node client/scripts/test-agent-e2e.mjs",
    "node client/scripts/test-agent-e2e.mjs --journey plugins --provider fixture --max-requests 7 --build-timeout 1800",
    "node tools/quality.mjs swift",
    "node client/scripts/test-workspace-access-swift.mjs",
  ])
    assert.ok(host.includes(command), command);
  assert.match(host, /Retain browser diagnostics\n {8}if: always\(\)/);
  assert.match(host, /path: client\/test-results\/browser\//);
  assert.doesNotMatch(
    host,
    /continue-on-error|workshop\/src-tauri|test:visual/,
  );
});

test("push selection uses the preceding revision while initial pushes retain quick checks", () => {
  assert.match(
    quality,
    /BASE_SHA: \$\{\{ github.event.pull_request.base.sha \|\| github.event.before \}\}/,
  );
  const script = quality.match(
    / {10}case "\$EVENT"[\s\S]*?node tools\/ci-selection\.mjs[^\n]+/,
  )?.[0];
  for (const base of ["", "0".repeat(40)]) {
    const directory = mkdtempSync(join(tmpdir(), "initial-ci-push-"));
    try {
      const env = {
        ...process.env,
        EVENT: "push",
        BASE_SHA: base,
        GITHUB_OUTPUT: join(directory, "outputs"),
      };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync("bash", ["-euo", "pipefail", "-c", script], {
        cwd: root,
        env,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      const selection = JSON.parse(result.stdout);
      assert.ok(selection.quick.includes("client-vue"));
      assert.equal(selection.host, false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("workflow event routing selects full MVP only on manual full dispatch", () => {
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
    const directory = mkdtempSync(join(tmpdir(), "mvp-ci-workflow-"));
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
      const selection = JSON.parse(result.stdout);
      assert.equal(selection.scope, "mvp");
      assert.equal(selection.full, full);
      assert.equal(selection.host, full);
      if (event === "workflow_dispatch")
        assert.ok(selection.quick.includes("client-vue"));
      else assert.deepEqual(selection.quick, ["root-secrets"]);
      assert.deepEqual(selection.browser, []);
      assert.deepEqual(selection.native, []);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
