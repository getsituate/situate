import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(
  new URL("./install-worktree-env-hook.mjs", import.meta.url),
);
const supported = process.platform !== "win32";
const fixture =
  "TEST_OPENAI_API_KEY=synthetic-worktree-test\nOTHER_SECRET=synthetic-other-value\n";

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "situate-worktree-env-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const main = join(root, "main checkout");
  await mkdir(main);
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
  const run = (command, args, cwd = main) =>
    spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 10000 });
  const git = (args, cwd) => {
    const result = run("git", args, cwd);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.replace(/\n$/, "");
  };
  git(["init", "-b", "main"]);
  await writeFile(join(main, ".gitignore"), ".env\n.env.*\n");
  git(["add", ".gitignore"]);
  git(["commit", "-m", "Initialize fixture"]);
  const install = (cwd = main) => run(process.execPath, [installer], cwd);
  const add = (name) => {
    const path = join(root, name);
    git(["worktree", "add", "-b", name.replaceAll(" ", "-"), path]);
    return path;
  };
  const source = join(main, ".env");
  const hook = join(
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    "hooks/post-checkout",
  );
  return { root, main, run, git, install, add, source, hook };
}

test(
  "installed Git hook copies general dotenv data privately from the primary checkout, including when created from a linked worktree",
  { skip: !supported },
  async (t) => {
    const r = await repository(t);
    await writeFile(r.source, fixture, { mode: 0o600 });
    assert.equal(r.install().status, 0);
    assert.equal(r.install().status, 0);
    const first = r.add("first linked");
    const target = join(first, ".env");
    assert.equal(await readFile(target, "utf8"), fixture);
    assert.equal((await lstat(target)).mode & 0o777, 0o600);
    assert.equal((await lstat(target)).nlink, 1);
    assert.equal(r.git(["status", "--porcelain"], first), "");
    assert.equal(r.git(["check-ignore", ".env"], first), ".env");
    await writeFile(target, "OTHER_SECRET=local-override\n");
    r.git(["checkout", "-b", "keep-local"], first);
    assert.equal(
      await readFile(target, "utf8"),
      "OTHER_SECRET=local-override\n",
    );
    const second = join(r.root, "second linked");
    r.git(["worktree", "add", "-b", "second", second], first);
    assert.equal(await readFile(join(second, ".env"), "utf8"), fixture);
    assert.deepEqual(
      (await readdir(second)).filter((name) => name.startsWith(".env.")),
      [],
    );
    assert.equal(r.install(first).status, 0);
  },
);

test(
  "worktree paths retain trailing whitespace",
  { skip: !supported },
  async (t) => {
    const r = await repository(t);
    await writeFile(r.source, fixture, { mode: 0o600 });
    assert.equal(r.install().status, 0);
    const sibling = join(r.root, "trailing");
    await mkdir(sibling);
    r.git(["init"], sibling);
    await writeFile(join(sibling, ".gitignore"), ".env\n.env.*\n");
    const exact = join(r.root, "trailing \n");
    r.git(["worktree", "add", "-b", "whitespace", exact]);
    assert.equal(await readFile(join(exact, ".env"), "utf8"), fixture);
    await assert.rejects(lstat(join(sibling, ".env")), { code: "ENOENT" });
    assert.equal(r.install(exact).status, 0);
  },
);

test(
  "hook installation retains trailing whitespace in a bare Git directory",
  { skip: !supported },
  async (t) => {
    const r = await repository(t);
    const bare = join(r.root, "bare \n");
    r.git(["init", "--bare", bare]);
    assert.equal(r.install(bare).status, 0);
    assert.equal(
      (await lstat(join(bare, "hooks/post-checkout"))).mode & 0o777,
      0o700,
    );
    assert.equal(r.install(bare).status, 0);
  },
);

test(
  "missing source and main-checkout branch changes do not create an environment file",
  { skip: !supported },
  async (t) => {
    const r = await repository(t);
    assert.equal(r.install().status, 0);
    const linked = r.add("without-secrets");
    await assert.rejects(lstat(join(linked, ".env")), { code: "ENOENT" });
    await writeFile(r.source, fixture, { mode: 0o600 });
    r.git(["checkout", "-b", "another-main-branch"]);
    assert.equal(await readFile(r.source, "utf8"), fixture);
  },
);

test(
  "installation preserves unrelated hooks and configured hook directories",
  { skip: !supported },
  async (t) => {
    const r = await repository(t);
    await writeFile(r.hook, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    assert.equal(r.install().status, 1);
    assert.equal(await readFile(r.hook, "utf8"), "#!/bin/sh\nexit 0\n");
    r.git(["config", "core.hooksPath", "custom-hooks"]);
    const result = r.install();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /core.hooksPath/);
    assert.equal(r.git(["config", "--get", "core.hooksPath"]), "custom-hooks");
  },
);

for (const kind of [
  "world-readable",
  "symlink",
  "hardlink",
  "oversized",
  "not-ignored",
  "temporary-not-ignored",
]) {
  test(
    `unsafe ${kind} source is not copied or exposed in diagnostics`,
    { skip: !supported },
    async (t) => {
      const r = await repository(t);
      assert.equal(r.install().status, 0);
      const linked = r.add("guarded");
      await writeFile(r.source, fixture, { mode: 0o600 });
      if (kind === "world-readable") await chmod(r.source, 0o644);
      if (kind === "symlink") {
        await rm(r.source);
        const outside = join(r.root, "private-source");
        await writeFile(outside, fixture, { mode: 0o600 });
        await symlink(outside, r.source);
      }
      if (kind === "hardlink") await link(r.source, join(r.root, "alias"));
      if (kind === "oversized")
        await writeFile(r.source, "x".repeat(2 * 1024 * 1024 + 1));
      if (kind === "not-ignored")
        await writeFile(join(linked, ".gitignore"), "");
      if (kind === "temporary-not-ignored")
        await writeFile(join(linked, ".gitignore"), ".env\n");
      const result = r.run(r.hook, ["old", "new", "1"], linked);
      assert.equal(result.status, 1);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /synthetic-worktree-test|synthetic-other-value|private-source/,
      );
      await assert.rejects(lstat(join(linked, ".env")), { code: "ENOENT" });
      assert.deepEqual(
        (await readdir(linked)).filter((name) => name.startsWith(".env.")),
        [],
      );
    },
  );
}

test(
  "existing destination symlinks are never followed or replaced; file checkouts do not copy",
  { skip: !supported },
  async (t) => {
    const r = await repository(t);
    assert.equal(r.install().status, 0);
    const linked = r.add("existing-link");
    await writeFile(r.source, fixture, { mode: 0o600 });
    const outside = join(r.root, "unrelated");
    await writeFile(outside, "unchanged");
    await symlink(outside, join(linked, ".env"));
    assert.equal(r.run(r.hook, ["old", "new", "1"], linked).status, 0);
    assert.equal((await lstat(join(linked, ".env"))).isSymbolicLink(), true);
    assert.equal(await readFile(outside, "utf8"), "unchanged");
    await rm(join(linked, ".env"));
    assert.equal(r.run(r.hook, ["old", "new", "0"], linked).status, 0);
    await assert.rejects(lstat(join(linked, ".env")), { code: "ENOENT" });
  },
);
