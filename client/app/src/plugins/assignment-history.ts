import { invoke } from "@tauri-apps/api/core";
import type { ToolActivity } from "../components/chat/transcript";
import type {
  AssignmentChange,
  AssignmentRevision,
} from "./assignment-changes";

export interface RecordedChange extends AssignmentChange {
  sourcePluginId?: string;
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function sourceRevision(
  value: unknown,
  pluginId?: string,
): AssignmentRevision | null | undefined {
  if (value === null) return null;
  const reference = object(value);
  if (
    !reference ||
    typeof reference.path !== "string" ||
    !reference.path ||
    typeof reference.revision !== "string" ||
    !/^[a-f0-9]{40}$/.test(reference.revision)
  )
    return;
  return {
    path: pluginId
      ? `.situate/plugins/${pluginId}/code/${reference.path}`
      : reference.path,
    revision: reference.revision,
    status: "loading",
  };
}
export function recordedAssignmentChanges(
  activity: readonly ToolActivity[],
): RecordedChange[] {
  const result: RecordedChange[] = [];
  for (const call of activity) {
    const details = object(object(call.result)?.details);
    if (!details) continue;
    const entries = Array.isArray(details.changes)
      ? details.changes
      : [details.change];
    for (const [index, entry] of entries.entries()) {
      const value = object(entry);
      if (!value) continue;
      const id = `${call.runId}:${call.id}:${index}`;
      if (
        (["edit_plugin_sources", "inspect_plugin", "write", "edit"].includes(
          call.name,
        ) &&
          value.store === "plugin") ||
        (call.name === "shell" && value.store === "workspace")
      ) {
        const pluginId = value.store === "plugin" ? value.pluginId : undefined;
        if (
          value.store === "plugin" &&
          (typeof pluginId !== "string" ||
            !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(pluginId))
        )
          continue;
        const sourceId = typeof pluginId === "string" ? pluginId : undefined;
        const before = sourceRevision(value.before, sourceId),
          after = sourceRevision(value.after, sourceId);
        if (before === undefined || after === undefined || (!before && !after))
          continue;
        if (
          !["added", "modified", "deleted", "renamed"].includes(
            String(value.operation),
          )
        )
          continue;
        result.push({
          id,
          operation: value.operation as AssignmentChange["operation"],
          before,
          after,
          attribution:
            value.attribution === "recorded" ? "recorded" : "uncertain",
          ...(sourceId ? { sourcePluginId: sourceId } : {}),
        });
      } else if (
        ["write", "edit"].includes(call.name) &&
        typeof value.path === "string" &&
        value.path &&
        (value.before === null || typeof value.before === "string") &&
        typeof value.after === "string" &&
        (value.beforeRevision === null ||
          typeof value.beforeRevision === "string") &&
        typeof value.afterRevision === "string" &&
        value.afterRevision
      ) {
        if (
          value.before === value.after ||
          (value.before !== null &&
            (typeof value.beforeRevision !== "string" || !value.beforeRevision))
        )
          continue;
        result.push({
          id,
          operation: value.before === null ? "added" : "modified",
          attribution: "recorded",
          before:
            value.before === null
              ? null
              : {
                  path: value.path,
                  revision: value.beforeRevision as string,
                  status: "available",
                  text: value.before,
                },
          after: {
            path: value.path,
            revision: value.afterRevision,
            status: "available",
            text: value.after,
          },
        });
      }
    }
  }
  return result;
}
export interface ObservedAssignmentHistory {
  id: string;
  runId: string;
  callId: string;
  before?: string;
  after?: string;
  comparisonUnavailable?: boolean;
}
export interface ObservedAssignmentChanges {
  status: "ready" | "error" | "unavailable";
  changes: RecordedChange[];
}
export function observedAssignmentHistories(
  activity: readonly ToolActivity[],
): ObservedAssignmentHistory[] {
  return activity.flatMap<ObservedAssignmentHistory>((call) => {
    const details = object(object(call.result)?.details);
    const outcome = object(details?.outcome);
    if (
      ["edit_plugin_sources", "inspect_plugin", "write", "edit"].includes(
        call.name,
      ) &&
      details &&
      (details.comparisonUnavailable === true ||
        (outcome &&
          ("PartialFailure" in outcome || "SavedHistoryFailed" in outcome)))
    ) {
      return [
        {
          id: `${call.runId}:${call.id}`,
          runId: call.runId,
          callId: call.id,
          comparisonUnavailable: true,
        },
      ];
    }
    if (
      call.name !== "shell" ||
      !details ||
      !Object.hasOwn(details, "beforeHistoryRevision") ||
      Array.isArray(details.changes)
    )
      return [];
    const revision = (value: unknown) =>
      typeof value === "string" && /^[a-f0-9]{40}$/.test(value)
        ? value
        : undefined;
    return [
      {
        id: `${call.runId}:${call.id}`,
        runId: call.runId,
        callId: call.id,
        before: revision(details.beforeHistoryRevision),
        after: revision(details.afterHistoryRevision),
      },
    ];
  });
}
export async function loadObservedHistory(
  scope: string,
  history: ObservedAssignmentHistory,
): Promise<ObservedAssignmentChanges> {
  if (history.comparisonUnavailable || !history.before || !history.after)
    return { status: "unavailable", changes: [] };
  if (history.before === history.after) return { status: "ready", changes: [] };
  try {
    const result = await invoke<{ status: string; changes: unknown[] }>(
      "change_list",
      { scope, before: history.before, after: history.after },
    );
    if (result.status === "unavailable")
      return { status: "unavailable", changes: [] };
    if (result.status !== "ready" || !Array.isArray(result.changes))
      return { status: "error", changes: [] };
    const changes = recordedAssignmentChanges([
      {
        id: history.callId,
        runId: history.runId,
        name: "shell",
        args: {},
        state: "completed",
        result: { details: { changes: result.changes } },
      },
    ]);
    return changes.length === result.changes.length
      ? { status: "ready", changes }
      : { status: "error", changes: [] };
  } catch {
    return { status: "error", changes: [] };
  }
}

export async function loadRecordedChange(
  scope: string,
  change: RecordedChange,
): Promise<RecordedChange> {
  const pluginId = change.sourcePluginId;
  async function load(
    reference: AssignmentRevision | null,
  ): Promise<AssignmentRevision | null> {
    if (!reference || reference.status !== "loading") return reference;
    const prefix = pluginId ? `.situate/plugins/${pluginId}/code/` : "";
    if (pluginId && !reference.path.startsWith(prefix))
      return { ...reference, status: "unavailable" };
    try {
      const value = await invoke<{ status: string; text?: string }>(
        "change_revision",
        {
          scope,
          ...(pluginId ? { pluginId } : {}),
          path: reference.path.slice(prefix.length),
          revision: reference.revision,
        },
      );
      return value.status === "available" && typeof value.text === "string"
        ? { ...reference, status: "available", text: value.text }
        : {
            ...reference,
            status:
              value.status === "unsupported" ? "unsupported" : "unavailable",
          };
    } catch {
      return { ...reference, status: "unavailable" };
    }
  }
  const before = await load(change.before);
  const after = await load(change.after);
  return { ...change, before, after };
}
