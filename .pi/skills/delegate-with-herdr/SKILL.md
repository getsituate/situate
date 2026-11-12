---
name: delegate-with-herdr
description: Delegate independent research, review, implementation, or verification tasks to agents through Herdr. Use when splitting repository work across agents or requesting an independent review.
compatibility: Requires Git, Pi, Herdr on PATH, and a parent agent running inside a Herdr-managed pane (HERDR_ENV=1).
---

# Delegate with Herdr

Use Herdr for task delegation in this repository. Keep small, tightly coupled changes in the parent agent; delegate work that has a clear boundary and can be checked independently.

## Load the operational instructions

1. Verify `command -v herdr` and `test "${HERDR_ENV:-}" = 1` before issuing Herdr control commands. If either fails, stop delegation and ask the user to follow [Developer setup](../../../docs/development/README.md). Do not control another session from outside Herdr or install software without permission.
2. Read the user's existing Herdr skill at `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/herdr/SKILL.md`, resolving the environment variables before opening the file. Do not copy it into the repository or modify it.
3. If that skill is unavailable, load the operational guide printed by `herdr --skill`. Use the installed CLI's `--help` and relevant command groups to verify current syntax.

This skill defines the repository's delegation workflow; the Herdr skill defines how to operate panes and agents. Do not register a second skill named `herdr`.

## Scope and isolation

- Use a separate pane for each read-only reviewer, explicitly forbidding file edits and commits.
- Give every agent allowed to modify files its own Git worktree and branch. This workflow authorizes isolated worktrees for delegated edits; never have multiple agents write to the same checkout.
- Check the parent working tree before choosing a base. Uncommitted changes are not automatically available in a new worktree. Do not stash, commit, or discard the user's work merely to start a delegate.
- Assign non-overlapping file ownership. Give each agent the objective, necessary context, allowed paths, constraints, acceptance criteria, and verification commands. Require English repository content and compliance with `AGENTS.md`.
- Keep private notes, credentials, and raw interviews out of delegated repository artifacts. Pass only the context needed for the task.
- Use Pi agents unless the user requests another agent. Do not change provider or model without authorization. Choose the lowest adequate thinking level when the agent supports it.

## Start and coordinate

- Discover the current pane and workspace. Use explicit IDs returned by Herdr, never guessed IDs or the UI-focused pane.
- Preserve the user's focus with `--no-focus`. Read-only work uses a sibling pane; editing work starts in its isolated worktree.
- Start the agent in an available shell pane, select and verify its Pi role as described below, then submit the task through `herdr agent prompt`. Do not assume that creating a pane also starts an agent.
- Ask editing delegates to commit only their assigned changes on their own branches. Ask all delegates to report findings, changed paths, checks performed, and blockers. Do not delegate remote publication.
- Continue independent parent work while delegates run. Do not edit files assigned to an active delegate.
- Use bounded waits and read agent output. A timeout, `idle`, or `done` state is not proof of task success. Inspect the result and working tree. If blocked on approval, consult the user rather than answering automatically. Do not launch duplicate agents after an uncertain start.

## Recover an incomplete review

Use the operational Herdr skill's file fallback only after a bounded terminal read cannot recover the complete result. Do not request a report file in the initial assignment.

- Create a private temporary directory outside the checkout, for example with `mktemp -d "${TMPDIR:-/tmp}/situate-review.XXXXXX"`. Give the delegate one exact report path in that directory.
- Explicitly permit writing only that report file as an exception to the read-only assignment. Repository edits and commits remain forbidden; this exception does not authorize other filesystem changes.
- Request the complete findings, reviewed revision and worktree, relevant uncommitted changes, inspected paths, checks actually executed with outcomes, and unresolved gaps or blockers. Source inspection must not be presented as test execution.
- Ask for a final reply containing only the report path. Read the file directly in bounded windows until complete; a path or settled agent state alone is not a completed handoff.
- Keep reports private and outside publication artifacts. Retain the file until its findings have been incorporated or explicitly dismissed. Remove only the temporary directory created for this handoff after confirming that no useful result will be lost.

## Select the delegate's Pi role

Herdr controls the pane and agent process; the project's [Role Switcher extension](../../extensions/role-switcher/index.ts) controls the role inside Pi. Pass `--role <name>` after Herdr's `--` separator to select the role before the first work assignment. A Herdr agent name such as `reviewer` does not select a Pi role.

### Choose a role and check the checkout

Read the candidate role's `role.json` and `SYSTEM.md` under [`.pi/role-mode/roles`](../../role-mode/roles) in the delegate's checkout. Use its `useWhen` and `avoidWhen` guidance:

| Role               | Delegated work                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `developer`        | Scoped implementation, bug fixes, refactoring, code review, and tests within agreed architecture. |
| `cto`              | Architecture, security, technical trade-offs, delivery, and operational decisions.                |
| `product-designer` | UX discovery, interaction concepts, wireframes, accessibility, and interface reviews.             |
| `ceo`              | Customer problems, product priorities, scope, goals, and requirements.                            |
| `off`              | Work that deliberately needs no project role guidance.                                            |

Start Pi at the repository or worktree root: the extension resolves `.pi/role-mode` from Pi's working directory. Verify that the target checkout contains the extension, role definitions, and referenced skill library; a worktree based on an older commit may not contain them. Do not substitute files from the parent's checkout silently. Project extensions must be enabled and trusted; ask the user if startup is blocked on trust rather than bypassing it.

An explicit `--role` overrides the saved role at process startup and persists the selection in the session. Without it, a new session starts with `off` and a resumed session restores its own role. The flag is not reapplied on reload, tree navigation, or later session changes; `/role <name>` remains available for later role changes. An unknown startup role reports an error, requests shutdown with exit code `2`, and blocks ordinary input rather than falling back to another role. The parent's role is not inherited. Roles add system guidance, skills, and any configured MCP servers, not filesystem isolation or a read-only sandbox. Keep the explicit write restrictions and worktree rules regardless of role.

### Read-only sibling pane

From the parent repository root, choose the split direction using the Herdr skill, then create the pane:

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus
```

Use the returned `.result.pane.pane_id` in place of `<new-pane-id>`. Before starting Pi, configure the **target shell**, not the parent's shell:

```bash
herdr pane run <new-pane-id> 'export VOLTA_HOME="${VOLTA_HOME:-$HOME/.volta}"; export PATH="$VOLTA_HOME/bin:$PATH"; export SITUATE_AUTO_TESTS=0; test "$(command -v node)" = "$VOLTA_HOME/bin/node" && test "$(command -v npm)" = "$VOLTA_HOME/bin/npm" && volta which node && volta which npm && printf "review-shell-ready AUTO=%s CWD=%s\n" "$SITUATE_AUTO_TESTS" "$PWD"'
herdr pane read <new-pane-id> --source recent-unwrapped --lines 80
```

Wait for the printed `review-shell-ready AUTO=0 CWD=...` line and a returned shell prompt. Check that the directory is the intended checkout and Volta resolved the project tools. The echoed command alone is not confirmation. If setup fails, stop and resolve it before starting Pi. Exports in the parent process (including `SITUATE_AUTO_TESTS=0 herdr agent start ...`) do not configure an already-running target shell.

Choose a unique agent name, then start Pi in that prepared pane:

```bash
herdr agent start code-reviewer --kind pi --pane <new-pane-id> -- --role developer
herdr agent read code-reviewer --source recent-unwrapped --lines 80
```

`SITUATE_AUTO_TESTS=0` disables the project's automatic check hook, not explicit test commands or filesystem writes. A review prompt or Pi role does not disable hooks. Keep project trust and Herdr's normal agent startup protocol; do not bypass either. If an existing Pi reviewer started without this environment, stop it normally and prepare its shell before restarting; a later prompt cannot change its startup environment.

Verify role activation as described below before sending the scoped review assignment. Explicitly forbid file edits, commits, and test/build runners in that assignment; the parent owns verification unless it assigns a specific check. Apply the same shell preparation to read-only reviewers in other checkouts. Editing delegates retain their assigned verification policy.

### Editing delegate in a worktree

Choose an unused branch name and a reviewed base containing the required project resources. For example, when `HEAD` is the intended base:

```bash
herdr worktree create --cwd "$PWD" --branch delegate/scoped-fix --base HEAD --no-focus
```

Inspect the creation response for the new workspace and shell pane. If necessary, use `herdr pane list --workspace <returned-workspace-id>` to resolve the pane; never use the parent's pane or infer an ID. Verify that its working directory is the new worktree root, then start Pi there:

```bash
herdr agent start fix-author --kind pi --pane <worktree-pane-id> -- --role developer
herdr agent read fix-author --source recent-unwrapped --lines 80
```

Use another role from the table when appropriate. After verification, send the assignment with owned paths, acceptance criteria, checks, and the instruction to commit only assigned changes on the delegate's branch.

### Verify activation before assigning work

Inspect `herdr agent get <agent-name>` and `herdr agent read <agent-name> --source recent-unwrapped --lines 80` until the agent is ready and the role widget shows the selected role without `pending`. Startup selection loads role resources without an extra `/reload`. Use bounded checks; if the role is unknown, the extension is missing, or startup fails, resolve that problem before submitting work. Never proceed silently with `off` or a different role.

For an already-running agent or an older checkout without the flag, send `/role <name>` as a standalone command before the assignment, then verify the role after its resource reload. A pending switch does not affect the current run. If needed, `/role` alone displays the active and available roles. Do not use `agent prompt --wait` as proof of activation: slash commands can finish without a model turn or a detectable lifecycle transition. Even without `--wait`, Herdr may report `agent_prompt_stalled` after a command succeeds. Inspect the existing agent and role status rather than restarting it or immediately resending the command.

Once verified, submit the actual task separately with `herdr agent prompt <agent-name> "<scoped assignment>"`. Use `--wait --timeout 120000` for a bounded wait when needed, or continue independent parent work and inspect the delegate later.

## Review and integrate

- Review each delegate's diff, provenance, and test results before integrating its commits. Check for secrets, identifying data, unexpected files, and non-English prose.
- Integrate deliberately, for example with a reviewed cherry-pick. Herdr does not automatically merge an agent's branch. Preserve conflicting work and resolve overlaps explicitly; never overwrite the parent's unrelated changes.
- Run relevant checks again after integration. Wait for every delegated task to finish or be explicitly cancelled before presenting the final outcome.
- Clean up only the panes, branches, and worktrees created for this task, after confirming that useful work is integrated or intentionally retained. Inspect untracked and ignored files before removal. Never force-remove unresolved work, close unrelated sessions, or stop the Herdr server.
