import { invoke } from "@tauri-apps/api/core";
import type { Context } from "../diagnostics";
import type { ReportCheckProgress } from "./check-progress";
import { recoveryMode } from "../recovery";
import type { CheckAssertionFailure } from "./executor-check-script";

export interface CheckImage {
  data: string;
  mimeType: "image/png";
}

interface CheckArguments {
  script: string;
  fixtures?: Partial<
    Record<"files" | "config" | "data" | "credentials", Record<string, string>>
  >;
  timeoutMs?: number;
  responses?: Record<string, { status: number; body: string }>;
  processes?: {
    executable: string;
    args?: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
  }[];
}

export interface PackageRevision {
  pluginId: string;
  revision: string;
  incarnation?: string;
}
export interface ChangeTest extends CheckArguments {
  pluginId: string;
}
export interface ChangeCheckArguments {
  changes: { pluginId: string; revision?: string }[];
  checks: ChangeTest[];
}
export interface ChangeActivationOutcome {
  activated: boolean;
  publication: {
    attempt: string;
    status: "published" | "notPublished" | "needsRecheck" | "outcomeUnknown";
  };
  plugins: PackageRevision[];
  followUpError?: string;
}
export interface ChangeCheckOptions {
  scope: string;
  conversation: string;
  runId: string;
  isCurrent: () => boolean;
  diagnostic?: Context;
  onProgress?: ReportCheckProgress;
  onAvailable: (plugins: PackageRevision[]) => Promise<void>;
}
export function createPluginChanges(options: ChangeCheckOptions) {
  const request = <T>(toolCallId: string, request: object) =>
    invoke<T>("plugin_changes_check", {
      scope: options.scope,
      conversation: options.conversation,
      runId: options.runId,
      toolCallId,
      request,
    });
  function current(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!options.isCurrent()) throw new Error("plugins.workspaceUnavailable");
    if (recoveryMode() === undefined)
      throw new Error("native.plugins.recoveryBlocked");
  }
  async function check(
    toolCallId: string,
    args: ChangeCheckArguments,
    signal?: AbortSignal,
  ) {
    current(signal);
    let cancellation: Promise<unknown> | undefined;
    const cancel = () => {
      cancellation ??= request(toolCallId, {
        operation: "cancelPending",
        toolCallId,
      }).catch(() => undefined);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await request<{
        checkId?: string;
        passed: boolean;
        needsChecks?: string[];
        requiredChecks?: string[];
        publish?: PackageRevision[];
        checked?: PackageRevision[];
        results?: {
          pluginId: string;
          passed: boolean;
          assertions: number;
          error?: string;
          assertionsKnown?: false;
          failure?: CheckAssertionFailure;
          observations?: {
            requestId: string;
            operation: string;
            result: Record<string, unknown> | null;
            error: string | null;
            uncertain: boolean;
          }[];
          observationsTruncated?: boolean;
        }[];
        images: CheckImage[];
      }>(toolCallId, { operation: "check", ...args });
      await cancellation;
      if (signal?.aborted) throw new Error("plugins.executionCancelled");
      return result;
    } catch (error) {
      await cancellation;
      if (signal?.aborted)
        throw new Error("plugins.executionCancelled", { cause: error });
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  async function activate(
    toolCallId: string,
    checkId: string,
    signal?: AbortSignal,
  ) {
    current(signal);
    const cancel = () => {
      void request(toolCallId, { operation: "cancel", checkId }).catch(
        () => undefined,
      );
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const outcome = await request<ChangeActivationOutcome>(toolCallId, {
        operation: "activate",
        checkId,
      });
      if (!outcome.activated || !options.isCurrent() || signal?.aborted)
        return outcome;
      try {
        await options.onAvailable(outcome.plugins);
      } catch {
        outcome.followUpError = "plugins.activationFollowUpFailed";
      }
      return outcome;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  async function inspect(
    toolCallId: string,
    args: { checkId?: string; attempt?: string },
    signal?: AbortSignal,
  ) {
    current(signal);
    return request<Record<string, unknown>>(
      toolCallId,
      args.checkId
        ? { operation: "describe", checkId: args.checkId }
        : {
            operation: "status",
            ...(args.attempt ? { attempt: args.attempt } : {}),
          },
    );
  }
  return { check, activate, inspect };
}
