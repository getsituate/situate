# Commit conventions

Use an English subject in either form:

```text
fix(chat): Preserve drafts when switching workspaces

Switching workspaces could discard an unsent message.
Keep each draft with its original conversation.
```

`type: summary` is equally valid. Allowed types are `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore` and `revert`. Scopes are optional and have no fixed list. Keep the summary specific and imperative. Keep one coherent change together with its tests and documentation. Add a body, separated by a blank line, when the reason or prior failure is not clear from the subject.

For product changes, describe observable behavior and relevant platform limits. Internal changes need no invented user benefit. Do not include credentials, private observations, personal paths, generated tool signatures or process narration. Release prose and custom changelog trailers are not required.

Mark incompatible public-interface changes with `!` before the colon (`refactor(api)!: Remove the legacy callback`) or a `BREAKING CHANGE:` footer describing the incompatibility. Both may be used. These markers do not authorize a break in the repository's compatibility obligations or automatically select an app version.

## Merge, revert and squash commits

- Ordinary Git-generated merge subjects (`Merge branch ...`, `Merge pull request #...`, and Git's tag, commit and remote-tracking variants) are accepted for actual multi-parent merges. A custom merge subject must follow the convention. The local hook recognizes an in-progress merge through `MERGE_HEAD`.
- Ordinary `git revert` messages are accepted: `Revert "..."` with Git's `This reverts commit <full hash>.` body, including its merge-revert variant. Manually written reverts can instead use `revert(scope): summary`.
- A squash merge creates a new commit: give it a valid Conventional Commit subject and a useful body. Check the final message, not just the original branch's messages. This convention does not prescribe a merge strategy.

## Check messages and branch history

Run commands from the repository root with the [Volta toolchain](README.md#install-volta):

```sh
node tools/commit-check.mjs --message-file /tmp/commit-message
node tools/commit-check.mjs --base origin/main --head HEAD
```

The range check examines commits reachable from the head but not the base (`base..head`), rather than a diff or just the last subject. Omitting `--base` examines all reachable history under the adoption rule below. Refs resolve to immutable commit objects before inspection. Full Git history is required; shallow clones fail with no passing result.

The adoption boundary is discovered from commits that first add `tools/commit-policy.mjs` in the requested head's history. Those introduction commits and their descendants are checked. Earlier commits, including commits already on a separate branch before it acquired the policy, are grandfathered even if merged later. Commit dates do not affect this decision. Cherry-picking or squash-merging the policy establishes its introducing commit in the destination history; no hard-coded development-branch hash is needed. Keep this policy path stable. Missing adoption history fails rather than silently passing.

Quality CI checks the actual pull-request head against the base SHA, never the synthetic test-merge commit. Main-branch pushes check the before/head range, so a final squash message is checked there too. Manual runs without a base check all post-adoption commits. English, explanatory quality, compatibility and confidentiality still require human review; the dependency-free validator checks syntax, not language or meaning. Diagnostics never print message contents.

## Optional local hook

```sh
node tools/commit-install-hook.mjs
```

Installation is opt-in. It adds only `commit-msg` to the shared Git hooks directory and preserves other hooks, including `post-checkout`. It refuses an existing different hook, a non-executable hook, symlinks or a configured `core.hooksPath`; it never rewrites hook configuration. An identical installed copy is left unchanged. Review updates before manually replacing an older copy. With an existing hook setup, integrate `tools/hooks/commit-msg` manually instead.

The standalone hook locates the validator in the active worktree, so it does not bind other worktrees to the installing checkout. Branches predating the validator are skipped locally. Hooks do not read `.env`, fetch secrets, access a model or contact a remote. They use Node.js from `PATH`; keep Volta's shims first. Hooks can be bypassed by Git, so CI remains the branch-history check. Installation does not grant permission to commit or publish.
