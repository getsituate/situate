import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  replaceControlCharacters,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { stripVTControlCharacters } from "node:util";

function showPreflight(
  ctx: ExtensionCommandContext,
  node: string,
  mode: "check" | "open",
) {
  return ctx.ui.custom<{
    message: string;
    level: "info" | "warning" | "error";
  }>((tui, theme, keybindings, done) => {
    const lines: string[] = [];
    let gate: string | undefined;
    let pr: string | undefined;
    let cancelled = false;
    let failure: string | undefined;
    const child = spawn(node, ["tools/sonar-preflight.mjs", mode], {
      cwd: ctx.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const input of [child.stdout, child.stderr]) {
      createInterface({ input, crlfDelay: Infinity }).on("line", (raw) => {
        const line = replaceControlCharacters(
          stripVTControlCharacters(raw),
        ).trim();
        if (!line) return;
        gate = line.match(/QUALITY GATE STATUS: FAILED.*/)?.[0] ?? gate;
        pr =
          line.match(
            /^https:\/\/github\.com\/getsituate\/situate\/pull\/\d+$/,
          )?.[0] ?? pr;
        lines.push(line.slice(0, 2000));
        if (lines.length > 10) lines.shift();
        tui.requestRender();
      });
    }
    child.once("error", (error) => {
      failure = error.message;
    });
    child.once("close", (code) => {
      if (cancelled) {
        done({
          message:
            mode === "open"
              ? "Preflight stopped. Check GitHub if a push or PR was already in progress."
              : "SonarCloud preflight cancelled. A submitted analysis may still finish on SonarCloud.",
          level: "warning",
        });
      } else if (code === 0) {
        done({
          message: pr
            ? `Pull request: ${pr}`
            : "SonarCloud quality gate passed.",
          level: "info",
        });
      } else {
        done({
          message:
            gate ??
            `SonarCloud preflight failed: ${failure ?? lines.at(-1) ?? `exit ${code}`}`,
          level: "error",
        });
      }
    });
    return {
      render(width) {
        return [
          theme.fg("accent", "SonarCloud preflight"),
          ...(lines.length ? lines : ["Starting…"]),
          theme.fg("dim", cancelled ? "Stopping…" : "Esc to cancel"),
        ].map((line) => truncateToWidth(line, width));
      },
      handleInput(data) {
        if (cancelled || !keybindings.matches(data, "tui.select.cancel"))
          return;
        cancelled = true;
        child.kill("SIGTERM");
        tui.requestRender();
      },
      invalidate() {},
    };
  });
}

const commitRequest =
  "Prepare the current feature branch for /pr-check. Review staged, unstaged, and untracked changes, then create one local commit for the intended changes following the repository guidelines. Do not change branches, rewrite existing commits, include secrets or unrelated files, push, open a PR, or run the scan yourself. If the intended scope is unclear, or the worktree cannot be made clean without including unrelated changes or discarding work, stop and explain what needs a decision. Pi will run the check after the commit.";

export default function sonarPreflight(pi: ExtensionAPI) {
  let pending:
    | {
        cwd: string;
        branch: string;
        head: string;
        phase: "requested" | "committing" | "ready";
      }
    | undefined;
  pi.on("session_shutdown", () => {
    pending = undefined;
  });
  pi.on("before_agent_start", (event, ctx) => {
    if (
      pending?.phase === "requested" &&
      pending.cwd === ctx.cwd &&
      event.messageType === "user" &&
      event.prompt === commitRequest
    )
      pending.phase = "committing";
  });
  pi.on("agent_settled", (event, ctx) => {
    if (pending?.phase !== "committing" || pending.cwd !== ctx.cwd) return;
    if (event.aborted) {
      pending = undefined;
      ctx.ui.notify(
        "Commit request cancelled. SonarCloud did not run.",
        "warning",
      );
      return;
    }
    pending.phase = "ready";
    pi.sendUserMessage("/pr-check", { expandPromptTemplates: true });
  });
  for (const mode of ["check", "open"] as const) {
    const publish = mode === "open";
    pi.registerCommand(`pr-${mode}`, {
      description: publish
        ? "Run SonarCloud preflight, then push and open a PR against main"
        : "Check this branch against main in SonarCloud without pushing",
      handler: async (args, ctx) => {
        if (args.trim()) {
          ctx.ui.notify(`Usage: /pr-${mode}`, "warning");
          return;
        }
        if (ctx.mode !== "tui") {
          ctx.ui.notify(
            "SonarCloud preflight requires the Pi terminal UI.",
            "error",
          );
          return;
        }
        if (
          pending &&
          (publish || pending.phase !== "ready" || pending.cwd !== ctx.cwd)
        ) {
          ctx.ui.notify(
            "A commit request for SonarCloud is already pending.",
            "warning",
          );
          return;
        }
        const resume = pending;
        pending = undefined;
        if (!publish) {
          async function git(...args: string[]) {
            const result = await pi.exec("git", args, {
              cwd: ctx.cwd,
              timeout: 5000,
            });
            if (result.code !== 0 || result.truncated)
              throw new Error(`Could not read the Git ${args[0]} result.`);
            return result.stdout.trim();
          }
          try {
            const dirty = await git(
              "status",
              "--porcelain",
              "--untracked-files=all",
            );
            if (resume) {
              if (
                dirty ||
                (await git("branch", "--show-current")) !== resume.branch ||
                (await git("log", "-1", "--format=%P")) !== resume.head
              ) {
                ctx.ui.notify(
                  "SonarCloud did not run. Expected one new commit on the original branch and a clean worktree.",
                  "warning",
                );
                return;
              }
            } else if (dirty) {
              if (!ctx.isIdle() || !ctx.model) {
                ctx.ui.notify(
                  "Select a model and wait for Pi to finish before requesting a commit.",
                  "warning",
                );
                return;
              }
              const branch = await git("branch", "--show-current");
              if (!branch || branch === "main") {
                ctx.ui.notify(
                  "Switch to a feature branch before committing for the preflight.",
                  "warning",
                );
                return;
              }
              const head = await git("rev-parse", "HEAD");
              if (
                await ctx.ui.confirm(
                  "Commit and run SonarCloud analysis?",
                  "Ask Pi to make one local commit for the current changes, then send the committed source to public SonarCloud. Nothing will be pushed to GitHub.",
                )
              ) {
                pending = { cwd: ctx.cwd, head, branch, phase: "requested" };
                pi.sendUserMessage(commitRequest);
              }
              return;
            }
          } catch (error) {
            pending = undefined;
            ctx.ui.notify(
              error instanceof Error ? error.message : String(error),
              "error",
            );
            return;
          }
        }
        if (
          !resume &&
          !(await ctx.ui.confirm(
            publish
              ? "Check and open pull request?"
              : "Run SonarCloud analysis?",
            publish
              ? "Send the committed source to public SonarCloud. If the gate passes, push this branch to getsituate/situate and open a PR against main."
              : "Send the committed source to public SonarCloud. Nothing will be pushed to GitHub.",
          ))
        )
          return;
        // Signal the runner directly; the Volta wrapper can outlive or orphan its child.
        const runtime = await pi.exec("volta", ["which", "node"], {
          cwd: ctx.cwd,
          timeout: 5000,
        });
        const node = runtime.stdout.trim();
        if (runtime.code !== 0 || !isAbsolute(node)) {
          ctx.ui.notify(
            "Volta could not resolve the project's Node.js executable.",
            "error",
          );
          return;
        }
        const { message, level } = await showPreflight(ctx, node, mode);
        ctx.ui.notify(message, level);
      },
    });
  }
}
