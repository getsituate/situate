import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateCommitMessage } from "./commit-policy.mjs";

const tools = dirname(fileURLToPath(import.meta.url));
const checker = join(tools, "commit-check.mjs");
const installer = join(tools, "commit-install-hook.mjs");

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "situate-commits-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "main checkout");
  await mkdir(cwd);
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (name.startsWith("GIT_")) delete env[name];
  Object.assign(env, {
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  });
  const run = (command, args, directory = cwd, extraEnv = {}) =>
    spawnSync(command, args, {
      cwd: directory,
      env: { ...env, ...extraEnv },
      encoding: "utf8",
      timeout: 15000,
    });
  const git = (args, directory) => {
    const result = run("git", args, directory);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trimEnd();
  };
  git(["init", "-b", "main"]);
  git(["config", "commit.gpgsign", "false"]);
  const commit = (message) => {
    git(["commit", "--allow-empty", "-m", message]);
    return git(["rev-parse", "HEAD"]);
  };
  const legacy = commit("Old non-conventional history");
  const adopt = async (message = "chore: Adopt commit conventions") => {
    await mkdir(join(cwd, "tools"), { recursive: true });
    for (const name of ["commit-policy.mjs", "commit-check.mjs"])
      await copyFile(join(tools, name), join(cwd, "tools", name));
    git(["add", "tools"]);
    return commit(message);
  };
  const check = (base, head = "HEAD") =>
    run(process.execPath, [
      checker,
      ...(base ? ["--base", base] : []),
      "--head",
      head,
    ]);
  return { root, cwd, run, git, commit, legacy, adopt, check };
}

test("accepts allowed types, free optional scopes, breaking markers and useful bodies", () => {
  for (const type of [
    "feat",
    "fix",
    "refactor",
    "perf",
    "docs",
    "test",
    "build",
    "ci",
    "chore",
    "revert",
  ]) {
    for (const scope of ["", "(chat)", "(new.area/mobile)"]) {
      assert.equal(
        validateCommitMessage(`${type}${scope}: Preserve retained data`),
        null,
      );
      assert.equal(
        validateCommitMessage(
          `${type}${scope}!: Change callback\n\nExplain the reason.\n\nBREAKING CHANGE: Use the new callback.`,
        ),
        null,
      );
    }
  }
  assert.equal(
    validateCommitMessage(
      "fix: Preserve drafts\r\n\r\nKeep the original conversation.\r\n",
    ),
    null,
  );
  assert.equal(
    validateCommitMessage(
      "refactor: Change callback\n\nBREAKING-CHANGE: Use the new callback.",
    ),
    null,
  );
});

test("rejects malformed headers, missing summaries and unseparated bodies", () => {
  for (const message of [
    "",
    "Fix drafts",
    "feature: Add drafts",
    "Fix: Preserve drafts",
    "fix(): Preserve drafts",
    "fix: ",
    "fix:Title",
    "fix(chat: Preserve drafts",
    "fix: Preserve drafts\nAn unseparated body",
    "fix: Change callback\n\nBREAKING CHANGE:",
  ]) {
    assert.notEqual(validateCommitMessage(message), null, message);
  }
  assert.notEqual(validateCommitMessage("Merge branch 'topic'"), null);
  assert.equal(
    validateCommitMessage("Merge branch 'topic'", { merge: true }),
    null,
  );
  assert.notEqual(validateCommitMessage('Revert "anything"'), null);
});

test("range checks grandfather existing history and branches without using commit dates", async (t) => {
  const r = await repository(t);
  r.git(["checkout", "-b", "old-topic"]);
  const old = r.commit("Preexisting topic subject");
  r.git(["checkout", "main"]);
  const adoption = await r.adopt();
  r.git(["merge", "--no-ff", "old-topic"]);
  let result = r.check(r.legacy);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 checked, 1 grandfathered, 0 invalid/);
  r.git(["checkout", "old-topic"]);
  r.git(["merge", "--no-ff", "main"]);
  const invalid = r.commit("Invalid new topic message");
  result = r.check(r.legacy);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(invalid));
  assert.doesNotMatch(result.stderr, new RegExp(old));
  assert.doesNotMatch(result.stderr, /Invalid new topic message/);
  assert.equal(r.check(adoption, adoption).status, 0);
});

test("checks every introduced commit, excluding a synthetic merge when actual head is supplied", async (t) => {
  const r = await repository(t);
  const adoption = await r.adopt();
  r.git(["checkout", "-b", "topic"]);
  const invalid = r.commit("Bad middle message");
  const head = r.commit("fix(chat): Preserve drafts");
  const result = r.check(adoption, head);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(invalid));
  assert.equal(r.check(invalid, head).status, 0);
  r.git(["checkout", "main"]);
  r.commit("chore: Change unrelated main state");
  r.git(["merge", "--no-ff", "topic", "-m", "Synthetic CI merge"]);
  assert.doesNotMatch(
    r.check(adoption, head).stderr,
    new RegExp(r.git(["rev-parse", "HEAD"])),
  );
  assert.equal(r.check(adoption).status, 1);
  assert.match(
    r.check(adoption).stderr,
    new RegExp(r.git(["rev-parse", "HEAD"])),
  );
});

test("Quality checks the actual PR head rather than its synthetic checkout", async (t) => {
  const r = await repository(t);
  const adoption = await r.adopt();
  r.git(["checkout", "-b", "topic"]);
  const head = r.commit("fix: Preserve drafts");
  r.git(["checkout", "main"]);
  r.commit("chore: Change main");
  r.git(["merge", "--no-ff", "topic", "-m", "Synthetic CI merge"]);
  const workflow = await readFile(
    join(tools, "../.github/workflows/quality.yml"),
    "utf8",
  );
  const step = workflow.match(
    /- name: Check branch commit messages\n([\s\S]*?)(?= {6}- id: select)/,
  )?.[1];
  assert.ok(step);
  assert.match(
    step,
    /HEAD_SHA: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/,
  );
  assert.match(
    step,
    /BASE_SHA: \$\{\{ github.event.pull_request.base.sha \|\| github.event.before \}\}/,
  );
  const script = step.split("        run: |\n")[1];
  const result = r.run("bash", ["-euo", "pipefail", "-c", script], r.cwd, {
    BASE_SHA: adoption,
    HEAD_SHA: head,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 checked, 0 grandfathered, 0 invalid/);
  for (const base of ["", "0".repeat(40)]) {
    const full = r.run("bash", ["-euo", "pipefail", "-c", script], r.cwd, {
      BASE_SHA: base,
      HEAD_SHA: head,
    });
    assert.equal(full.status, 0, full.stderr);
    assert.match(full.stdout, /2 checked, 1 grandfathered, 0 invalid/);
  }
});

test("a real squash adoption establishes the boundary and validates its own subject", async (t) => {
  const r = await repository(t);
  r.git(["checkout", "-b", "policy-topic"]);
  await r.adopt();
  r.git(["checkout", "main"]);
  r.git(["merge", "--squash", "policy-topic"]);
  const squash = r.commit("Bad squash message");
  let result = r.check(r.legacy);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(squash));
  r.git(["commit", "--amend", "-m", "chore: Adopt commit conventions"]);
  result = r.check();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 checked, 1 grandfathered/);
});

test("accepts Git-generated revert and merge-revert messages", async (t) => {
  const r = await repository(t);
  const adoption = await r.adopt();
  await writeFile(join(r.cwd, "example"), "initial\n");
  r.git(["add", "example"]);
  const change = r.commit("feat: Add example");
  r.git(["revert", "--no-edit", change]);
  r.git(["checkout", "-b", "topic"]);
  await writeFile(join(r.cwd, "topic"), "topic\n");
  r.git(["add", "topic"]);
  r.commit("feat: Add topic");
  r.git(["checkout", "main"]);
  r.git(["merge", "--no-ff", "topic"]);
  r.git(["revert", "--no-edit", "-m", "1", "HEAD"]);
  const result = r.check(adoption);
  assert.equal(result.status, 0, result.stderr);
});

test("fails closed for missing adoption history, invalid refs and shallow clones", async (t) => {
  const r = await repository(t);
  assert.equal(r.check().status, 1);
  await r.adopt();
  assert.equal(r.check("missing-base").status, 1);
  assert.equal(r.check(undefined, "--all").status, 1);
  const shallow = join(r.root, "shallow");
  r.git(["clone", "--depth=1", `file://${r.cwd}`, shallow]);
  const result = r.run(process.execPath, [checker], shallow);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /full Git history/);
});

test("installed hook rejects invalid messages without disclosing contents and follows linked worktrees", async (t) => {
  const r = await repository(t);
  await r.adopt();
  const hooks = join(r.cwd, ".git", "hooks");
  const postCheckout = "#!/bin/sh\nexit 0\n";
  await writeFile(join(hooks, "post-checkout"), postCheckout, { mode: 0o700 });
  assert.equal(r.run(process.execPath, [installer]).status, 0);
  assert.equal(r.run(process.execPath, [installer]).status, 0);
  assert.equal(
    await readFile(join(hooks, "post-checkout"), "utf8"),
    postCheckout,
  );
  await writeFile(
    join(r.cwd, ".env"),
    "SYNTHETIC_SECRET=must-not-be-printed\n",
    { mode: 0o600 },
  );
  const bad = r.run("git", [
    "commit",
    "--allow-empty",
    "-m",
    "private-synthetic-message",
  ]);
  assert.notEqual(bad.status, 0);
  assert.doesNotMatch(
    bad.stdout + bad.stderr,
    /private-synthetic-message|must-not-be-printed/,
  );
  r.commit("fix: Preserve drafts");
  const linked = join(r.root, "linked checkout");
  r.git(["worktree", "add", "-b", "linked", linked]);
  assert.equal(r.run(process.execPath, [installer], linked).status, 0);
  assert.notEqual(
    r.run(
      "git",
      ["commit", "--allow-empty", "-m", "Invalid linked subject"],
      linked,
    ).status,
    0,
  );
  assert.equal(
    r.run(
      "git",
      ["commit", "--allow-empty", "-m", "test: Check linked worktree"],
      linked,
    ).status,
    0,
  );
  r.git(["merge", "--no-ff", "linked"]);
  r.git(["checkout", "--detach", r.legacy], linked);
  assert.equal(
    r.run(
      "git",
      ["commit", "--allow-empty", "-m", "Legacy worktree message"],
      linked,
    ).status,
    0,
  );
});

test("installer preserves existing hooks, configured hooksPath and symlinks", async (t) => {
  const r = await repository(t);
  const hook = join(r.cwd, ".git", "hooks", "commit-msg");
  await writeFile(hook, "#!/bin/sh\nexit 42\n", { mode: 0o700 });
  assert.equal(r.run(process.execPath, [installer]).status, 1);
  assert.equal(await readFile(hook, "utf8"), "#!/bin/sh\nexit 42\n");
  await rm(hook);
  const other = join(r.root, "other-hook");
  await writeFile(other, "unchanged");
  await symlink(other, hook);
  assert.equal(r.run(process.execPath, [installer]).status, 1);
  assert.equal(await readFile(other, "utf8"), "unchanged");
  await rm(hook);
  r.git(["config", "core.hooksPath", "custom-hooks"]);
  assert.equal(r.run(process.execPath, [installer]).status, 1);
  assert.equal(r.git(["config", "--get", "core.hooksPath"]), "custom-hooks");
  r.git(["config", "--unset", "core.hooksPath"]);
  await copyFile(join(tools, "hooks", "commit-msg"), hook);
  await chmod(hook, 0o600);
  assert.equal(r.run(process.execPath, [installer]).status, 1);
});
