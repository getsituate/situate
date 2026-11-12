import { loadConversation, type PortableMessage } from "./conversation";
import type { RunRecord, RuntimeEvent } from "./queue-runtime";

export interface HistoryEntry {
  version: 1;
  id: string;
  parentId: string | null;
  type: string;
  data: unknown;
}
export interface HistoryPage {
  metadata: { id: string; revision: number; selectedEntryId: string | null };
  entries: HistoryEntry[];
  nextBefore: string | null;
  messageOffset: number;
  eventOffset: number;
}
const invalid = () => new Error("native.ai.conversation.versionInvalid");
const identity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;

export function readHistoryPage(value: unknown): HistoryPage {
  if (!value || typeof value !== "object") throw invalid();
  const page = value as HistoryPage;
  if (
    !page.metadata ||
    !identity(page.metadata.id) ||
    !Number.isSafeInteger(page.metadata.revision) ||
    page.metadata.revision < 0 ||
    (page.metadata.selectedEntryId !== null &&
      !identity(page.metadata.selectedEntryId)) ||
    !Array.isArray(page.entries) ||
    (page.nextBefore !== null && !identity(page.nextBefore)) ||
    !Number.isSafeInteger(page.messageOffset) ||
    page.messageOffset < 0 ||
    !Number.isSafeInteger(page.eventOffset) ||
    page.eventOffset < 0
  )
    throw invalid();
  const ids = new Set<string>();
  for (const [index, entry] of page.entries.entries()) {
    if (
      !entry ||
      entry.version !== 1 ||
      !identity(entry.id) ||
      ids.has(entry.id) ||
      (entry.parentId !== null && !identity(entry.parentId)) ||
      typeof entry.type !== "string" ||
      !entry.type ||
      (index > 0 && entry.parentId !== page.entries[index - 1].id)
    )
      throw invalid();
    ids.add(entry.id);
  }
  return page;
}

export function projectHistory(entries: readonly HistoryEntry[]) {
  const messages: PortableMessage[] = [];
  const events: RuntimeEvent[] = [];
  const runs = new Map<string, RunRecord>();
  for (const entry of entries) {
    if (entry.type === "message") {
      if (!entry.data || typeof entry.data !== "object") throw invalid();
      messages.push(
        ...loadConversation([(entry.data as { message: unknown }).message]),
      );
    } else if (entry.type === "event") {
      const event = entry.data as RuntimeEvent;
      if (
        !event ||
        !identity(event.id) ||
        !identity(event.runId) ||
        !Number.isSafeInteger(event.sequence) ||
        event.sequence < 1 ||
        typeof event.type !== "string"
      )
        throw invalid();
      events.push(event);
    } else if (entry.type === "run") {
      const run = entry.data as RunRecord;
      if (
        !run ||
        !identity(run.id) ||
        !["running", "completed", "interrupted", "error"].includes(run.state) ||
        !Number.isFinite(run.startedAt)
      )
        throw invalid();
      runs.set(run.id, run);
    }
  }
  return { messages, events, runs: [...runs.values()] };
}

export function rebaseHistoryEvent(
  event: RuntimeEvent,
  messageOffset: number,
): RuntimeEvent {
  if (
    !event.data ||
    typeof event.data !== "object" ||
    Array.isArray(event.data)
  )
    return event;
  const data = { ...event.data } as Record<string, unknown>;
  for (const key of ["messageIndex", "startMessageCount", "messageCount"]) {
    if (Number.isSafeInteger(data[key]))
      data[key] = Math.max(0, (data[key] as number) - messageOffset);
  }
  return { ...event, data };
}
