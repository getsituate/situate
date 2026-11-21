# Commit conventions

Use a short, specific English subject. A Conventional Commit prefix is optional:

```text
fix(chat): Preserve drafts when switching workspaces

Switching workspaces could discard an unsent message.
Keep each draft with its original conversation.
```

`Preserve drafts when switching workspaces` is also a valid subject. Keep one coherent change together with its tests and documentation. Add a body, separated by a blank line, when the reason or prior failure is not clear from the subject.

For product changes, describe observable behavior and relevant platform limits. Internal changes need no invented user benefit. Do not include credentials, private observations, personal paths, generated tool signatures or process narration. Release prose and custom changelog trailers are not required.

Describe incompatible public-interface changes explicitly. A commit message does not override the repository's compatibility obligations or select an app version.

For a squash merge, make sure the final subject describes the combined change. GitHub uses the pull request title by default.

## Optional Conventional Commit checks

The standalone validator and hook enforce Conventional Commit syntax for contributors who opt in. PR and release workflows do not run this validator.

Run commands from the repository root with the [Volta toolchain](README.md#install-volta):

```sh
node tools/commit-check.mjs --message-file /tmp/commit-message
node tools/commit-check.mjs --base origin/main --head HEAD
```

The range check examines commits reachable from the head but not the base (`base..head`), rather than a diff or just the last subject. Omitting `--base` examines all reachable history under the adoption rule below. Refs resolve to immutable commit objects before inspection. Full Git history is required; shallow clones fail with no passing result.

The adoption boundary is discovered from commits that first add `tools/commit-policy.mjs` in the requested head's history. Those introduction commits and their descendants are checked. Earlier commits, including commits already on a separate branch before it acquired the policy, are grandfathered even if merged later. Commit dates do not affect this decision. Cherry-picking or squash-merging the policy establishes its introducing commit in the destination history; no hard-coded development-branch hash is needed. Keep this policy path stable. Missing adoption history fails rather than silently passing.

The validator accepts Git-generated merge and revert messages and never prints message contents. It checks syntax, not language or meaning.

## Optional local hook

```sh
node tools/commit-install-hook.mjs
```

Installation is opt-in. It adds only `commit-msg` to the shared Git hooks directory and preserves other hooks, including `post-checkout`. It refuses an existing different hook, a non-executable hook, symlinks or a configured `core.hooksPath`; it never rewrites hook configuration. An identical installed copy is left unchanged. Review updates before manually replacing an older copy. With an existing hook setup, integrate `tools/hooks/commit-msg` manually instead.

The standalone hook locates the validator in the active worktree, so it does not bind other worktrees to the installing checkout. Branches predating the validator are skipped locally. Hooks do not read `.env`, fetch secrets, access a model or contact a remote. They use Node.js from `PATH`; keep Volta's shims first. If you no longer want this check, inspect your Git hooks directory (`git rev-parse --git-path hooks`) and remove `commit-msg` only if it is the hook installed by this command.
