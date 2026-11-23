import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { requireNativeDesktop } from "./native-desktop-session.mjs";
import {
  accessibilityFailureCode,
  checkAccessibilityAction,
} from "./qualification-accessibility.mjs";
import {
  materializeUpgradeWorkspace,
  upgradeNoteAfter,
  verifyUpgradeWorkspace,
} from "./upgrade-workspace-fixture.mjs";
import { upgradeWorkspaceJourney } from "./upgrade-workspace-journey.mjs";

const exec = promisify(execFile);

export async function runUpgradeSmoke(executable, { signal, timeout }) {
  requireNativeDesktop();
  const { SITUATE_SMOKE_ROOT: root, SITUATE_SMOKE_OWNER: owner } = process.env;
  if (!root || !isAbsolute(root) || !owner)
    throw new Error(
      "Legacy workspace check requires an owned smoke directory.",
    );
  const marker = join(root, ".smoke-owner");
  if (
    !(await lstat(marker)).isFile() ||
    (await readFile(marker, "utf8")) !== owner
  )
    throw new Error("Legacy workspace smoke ownership mismatch.");
  const workspace = materializeUpgradeWorkspace(root);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);

  async function launch(mode, run) {
    deadline.throwIfAborted();
    const child = spawn(executable, [], {
      env: { ...process.env, SITUATE_UPGRADE_SMOKE_PHASE: mode },
      stdio: ["ignore", "inherit", "inherit"],
    });
    const exited = new AbortController();
    const closed = new Promise((resolve) => {
      child.once("close", resolve);
    });
    child.once("exit", () => exited.abort(new Error("Workspace app exited")));
    const active = AbortSignal.any([deadline, exited.signal]);
    try {
      await once(child, "spawn");
      const execute = async (command, args) => {
        try {
          const { stdout } = await exec(command, args, {
            signal: active,
            timeout: 30_000,
          });
          return stdout.trim();
        } catch (error) {
          active.throwIfAborted();
          throw new Error("Accessibility command failed", {
            cause: error,
          });
        }
      };
      const resolveWorkspace = (value) =>
        value === "{{upgradeWorkspace}}" ? workspace : value;
      const actions = async (items) => {
        nextAction: for (const original of items) {
          const action = { ...original };
          if (action.type !== undefined)
            action.type = resolveWorkspace(action.type);
          if (action.folderField !== undefined)
            action.folderField = resolveWorkspace(action.folderField);
          const end = Date.now() + 60_000;
          let category = "ax_unavailable";
          try {
            do {
              active.throwIfAborted();
              if (
                await checkAccessibilityAction(child.pid, action, {
                  execute,
                  pending: (error) => {
                    category =
                      error.accessibilityObservation ??
                      accessibilityFailureCode(error);
                  },
                })
              )
                continue nextAction;
              await setTimeout(250, undefined, { signal: active });
            } while (Date.now() < end);
          } catch (error) {
            active.throwIfAborted();
            category = accessibilityFailureCode(error);
          }
          throw new Error(
            `Legacy workspace accessibility check failed: ${category}`,
          );
        }
      };
      await run(
        upgradeWorkspaceJourney({
          actions,
          verify: (note) =>
            verifyUpgradeWorkspace(workspace, note, {
              allowManifestMigration: true,
            }),
          progress: (step) => console.log(`Legacy workspace ${mode}: ${step}`),
        }),
      );
    } finally {
      child.kill("SIGTERM");
      const forceExit = globalThis.setTimeout(
        () => child.kill("SIGKILL"),
        2000,
      );
      try {
        await closed;
      } finally {
        clearTimeout(forceExit);
      }
    }
  }

  await launch("open", async (journey) => {
    await journey.open();
    await journey.author();
  });
  await launch("reopen", (journey) => journey.reopen(upgradeNoteAfter));
}
