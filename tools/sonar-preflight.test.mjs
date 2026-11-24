import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { preflight } from "./sonar-preflight.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "sonar-preflight-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cwd = join(directory, "project");
  const bin = join(directory, "bin");
  const log = join(directory, "calls");
  mkdirSync(cwd);
  mkdirSync(bin);
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", bin);
  git("remote", "add", "origin", "https://github.com/getsituate/situate.git");
  function commit(file, content = file) {
    writeFileSync(join(cwd, file), content);
    git("add", file);
    git("commit", "-m", file);
  }
  commit(".gitignore", ".env\n");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-c", "feature");
  commit("first.txt");
  commit("second.txt");
  writeFileSync(join(cwd, ".env"), "PRIVATE=synthetic\n", { mode: 0o600 });
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    REAL_GIT: execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    CALLS: log,
    SONAR_TOKEN: "test-token",
    SONARQUBE_MCP_TOKEN: "test-mcp-token",
    EXPECTED_HEAD: git("rev-parse", "HEAD"),
    FAKE_GATE: "0",
  };
  function executable(name, script) {
    writeFileSync(join(bin, name), `#!/bin/sh\nset -eu\n${script}\n`, {
      mode: 0o755,
    });
  }
  executable(
    "git",
    `
    [ -z "\${SONAR_TOKEN+x}\${SONARQUBE_MCP_TOKEN+x}" ]
    if [ "$1" = 'fetch' ]; then exit 0; fi
    if [ "$1" = 'push' ]; then printf '%s\\n' "$*" >> "$CALLS"; exit 0; fi
    exec "$REAL_GIT" "$@"
  `,
  );
  executable(
    "volta",
    `
    [ "$*" = 'run node tools/actions-adapter.mjs sonar-coverage' ]
    [ -z "\${SONAR_TOKEN+x}\${SONARQUBE_MCP_TOKEN+x}" ]
    echo coverage >> "$CALLS"
    touch "$RUNNER_TEMP/situate-vue.lcov"
  `,
  );
  executable(
    "sonar-scanner",
    `
    if [ "$1" = '--version' ]; then exit 0; fi
    [ "$SONAR_TOKEN" = 'test-token' ] && [ -z "\${SONARQUBE_MCP_TOKEN+x}" ]
    [ "$SONAR_HOST_URL" = 'https://sonarcloud.io' ]
    [ "$("$REAL_GIT" rev-parse HEAD)" = "$EXPECTED_HEAD" ]
    [ -f first.txt ] && [ -f second.txt ] && [ ! -e .env ]
    printf '%s\\n' "$*" >> "$CALLS"
    for arg; do
      case "$arg" in -Dsonar.javascript.lcov.reportPaths=*) [ -f "\${arg#*=}" ];; esac
    done
    if [ "$FAKE_GATE" = 'wait' ]; then
      (trap 'echo stopped >> "$CALLS"; exit 0' TERM; echo ready >> "$CALLS"; while :; do sleep 1; done) &
      wait
    fi
    exit "$FAKE_GATE"
  `,
  );
  executable("gh", 'printf "%s\\n" "$*" >> "$CALLS"');
  return { cwd, env, git, log };
}

test("checks the entire committed branch with the CI report and does not push", async (t) => {
  const { cwd, env, git, log } = fixture(t);
  await preflight({ cwd, env });
  const calls = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(calls.length, 2);
  assert.equal(calls[0], "coverage");
  assert.match(
    calls[1],
    /-Dsonar\.projectKey=getsituate_situate .* -Dsonar\.branch\.name=preflight\/feature -Dsonar\.branch\.target=main -Dsonar\.qualitygate\.wait=true$/,
  );
  assert.equal(
    git("worktree", "list", "--porcelain").match(/^worktree /gm).length,
    1,
  );
});

test("does not push or open a PR if the scanner exits unsuccessfully", async (t) => {
  const { cwd, env, log } = fixture(t);
  await assert.rejects(
    () => preflight({ cwd, env: { ...env, FAKE_GATE: "1" }, publish: true }),
    /sonar-scanner/,
  );
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2);
});

test("pushes the scanned commit before opening a PR only after a successful scan", async (t) => {
  const { cwd, env, log } = fixture(t);
  await preflight({ cwd, env, publish: true });
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").slice(2), [
    `push --no-follow-tags https://github.com/getsituate/situate.git ${env.EXPECTED_HEAD}:refs/heads/feature`,
    "pr create --repo github.com/getsituate/situate --base main --head feature --fill",
  ]);
});

test("rejects a branch missing changes from main before invoking the scanner", async (t) => {
  const { cwd, env, git, log } = fixture(t);
  git("switch", "main");
  writeFileSync(join(cwd, "main-only.txt"), "new base");
  git("add", "main-only.txt");
  git("commit", "-m", "Advance main");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "feature");
  await assert.rejects(
    () => preflight({ cwd, env }),
    /Integrate current origin\/main/,
  );
  assert.equal(existsSync(log), false);
});

test("aborting a running scan cleans the checkout and never pushes", async (t) => {
  const { cwd, env, git, log } = fixture(t);
  const controller = new AbortController();
  const deadline = AbortSignal.timeout(5000);
  const signal = AbortSignal.any([controller.signal, deadline]);
  const result = assert.rejects(
    preflight({
      cwd,
      env: { ...env, FAKE_GATE: "wait" },
      publish: true,
      signal,
    }),
    { name: "AbortError" },
  );
  while (!existsSync(log) || !readFileSync(log, "utf8").includes("\nready\n")) {
    await setTimeout(20, undefined, { signal: deadline });
  }
  controller.abort();
  await result;
  assert.doesNotMatch(readFileSync(log, "utf8"), /push |pr create/);
  assert.equal(
    git("worktree", "list", "--porcelain").match(/^worktree /gm).length,
    1,
  );
});
