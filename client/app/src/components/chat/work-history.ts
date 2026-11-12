import type { AgentMessage } from "../../ai/contracts";
import type { ActiveWorkBlock, WorkBlock } from "../../ai/work-blocks";
import {
  transcriptBlocks,
  type TranscriptBlock,
  type ToolActivity,
  type ToolView,
} from "./transcript";
import type { PluginNotice } from "../../ai/plugin-notices";
import type { RetainedQuestion } from "../../ai/question";

export type ToolCategory = "read" | "web" | "search" | "other";
export type HistoryEntry =
  | Exclude<TranscriptBlock, { kind: "tools" | "stopped" }>
  | { key: string; kind: "failure"; error: unknown; messageIndex?: number }
  | {
      key: string;
      kind: "reasoning";
      text: string;
      streaming?: boolean;
      messageIndex?: number;
    }
  | {
      key: string;
      kind: "tools";
      calls: ToolView[];
      category: ToolCategory;
      messageIndex?: number;
    };
export interface HistoryPeriod {
  key: string;
  kind: "history";
  entries: HistoryEntry[];
  outcome?: WorkBlock["outcome"];
  durationMs?: number;
  active?: ActiveWorkBlock;
}
export type ConversationEntry = HistoryEntry | HistoryPeriod;

export function toolCategory(call: ToolView): ToolCategory {
  if (call.name === "web_fetch") return "web";
  return ["read", "read_revision", "read_image"].includes(call.name)
    ? "read"
    : ["find", "grep", "search_content", "web_search"].includes(call.name)
      ? "search"
      : "other";
}
export function toolCaption(call: ToolView): string {
  const args =
    call.args && typeof call.args === "object"
      ? (call.args as Record<string, unknown>)
      : {};
  const text = (value: unknown) =>
    typeof value === "string" && value.trim()
      ? value.trim().replace(/[\r\n\t]+/g, " ")
      : undefined;
  if (call.name === "web_fetch") {
    try {
      const url = new URL(String(args.url));
      return url.hostname + url.pathname;
    } catch {
      return call.name;
    }
  }
  const path = text(args.path);
  if (
    ["read", "read_revision", "read_image", "write", "edit", "ls"].includes(
      call.name,
    ) &&
    path
  )
    return path;
  if (["find", "grep", "search_content", "web_search"].includes(call.name)) {
    const query = text(args.query);
    if (query) return path ? `${query} · ${path}` : query;
    if (path) return path;
  }
  return call.name;
}
export function isHistoryDetail(entry: HistoryEntry): boolean {
  return entry.kind === "reasoning" || entry.kind === "tools";
}
export function historySections(entries: HistoryEntry[]) {
  const initial = entries[0];
  const split = initial?.kind === "message" && initial.role === "user" ? 1 : 0;
  return {
    before: entries.slice(0, split),
    segments: entries.slice(split).map((entry) => ({
      entry,
      collapsible: isHistoryDetail(entry),
    })),
  };
}
function normalize(
  blocks: TranscriptBlock[],
): (HistoryEntry | Extract<TranscriptBlock, { kind: "stopped" }>)[] {
  const entries: (
    HistoryEntry | Extract<TranscriptBlock, { kind: "stopped" }>
  )[] = [];
  const addCall = (call: ToolView) => {
    const category = toolCategory(call);
    const previous = entries.at(-1);
    if (previous?.kind === "tools" && previous.category === category)
      previous.calls.push(call);
    else
      entries.push({
        key: call.key,
        kind: "tools",
        category,
        calls: [call],
        messageIndex: call.messageIndex,
      });
  };
  for (const block of blocks) {
    if (block.kind === "tools") {
      block.calls.forEach(addCall);
      continue;
    }
    if (block.kind === "call") {
      addCall(block.call);
      continue;
    }
    if (block.kind !== "message") {
      entries.push(block);
      continue;
    }
    let message: Extract<HistoryEntry, { kind: "message" }> | undefined;
    for (const [index, part] of block.content.entries()) {
      if (block.role === "assistant" && part.type === "thinking") {
        message = undefined;
        const text = part.redacted ? "" : part.thinking;
        if (text.trim())
          entries.push({
            kind: "reasoning",
            key: `${block.key}:${index}`,
            text,
            streaming: block.streaming,
            messageIndex: block.messageIndex,
          });
      } else {
        if (!message) {
          message = {
            ...block,
            key: `${block.key}:${index}`,
            work: undefined,
            content: [],
          };
          entries.push(message);
        }
        message.content.push(part);
      }
    }
    if (block.work)
      entries.push({
        key: `work:${block.work.id}`,
        kind: "duration",
        work: block.work,
        messageIndex: block.work.messageCount,
      });
  }
  return entries;
}
export function conversationHistory(
  messages: AgentMessage[],
  activity: ToolActivity[],
  running: boolean,
  notices: readonly PluginNotice[] = [],
  questions: readonly RetainedQuestion[] = [],
  work: readonly WorkBlock[] = [],
  active?: ActiveWorkBlock,
  failure?: unknown,
  messageOffset = 0,
): ConversationEntry[] {
  const entries = normalize(
    transcriptBlocks(
      messages,
      activity,
      running,
      notices,
      questions,
      work,
      active,
      messageOffset,
    ),
  );
  const periods: (HistoryPeriod & { start: number; end: number })[] = [];
  let boundary = 0;
  for (const item of work) {
    const start = item.startMessageCount;
    if (
      start === undefined ||
      !Number.isSafeInteger(start) ||
      start < boundary ||
      !Number.isSafeInteger(item.messageCount) ||
      item.messageCount < start ||
      item.messageCount > messages.length
    )
      continue;
    periods.push({
      key: `work:${item.id}`,
      kind: "history",
      entries: [],
      outcome: item.outcome,
      durationMs: item.durationMs,
      start,
      end: item.messageCount,
    });
    boundary = item.messageCount;
  }
  if (
    active &&
    Number.isSafeInteger(active.startMessageCount) &&
    active.startMessageCount >= boundary &&
    active.startMessageCount <= messages.length
  )
    periods.push({
      key: `work:${active.id}`,
      kind: "history",
      entries: [],
      start: active.startMessageCount,
      end: messages.length,
      active,
    });
  const known = new Set(periods.map((period) => period.key));
  const remaining = entries.filter(
    (entry) => entry.kind !== "duration" || !known.has(entry.key),
  );
  const output: ConversationEntry[] = [];
  const append = (items: typeof entries, period?: HistoryPeriod) => {
    for (const entry of items) {
      if (entry.kind === "stopped") {
        if (
          !period &&
          !work.some(
            (item) =>
              item.messageCount === (entry.messageIndex ?? -2) + 1 &&
              item.outcome === (entry.outcome ?? "cancelled"),
          )
        )
          output.push({
            key: entry.key,
            kind: "history",
            entries: [],
            outcome: entry.outcome ?? "cancelled",
          });
      } else if (period) period.entries.push(entry);
      else if (isHistoryDetail(entry)) {
        const previous = output.at(-1);
        if (
          previous?.kind === "history" &&
          previous.outcome === undefined &&
          !previous.active
        )
          previous.entries.push(entry);
        else
          output.push({
            key: `history:${entry.key}`,
            kind: "history",
            entries: [entry],
          });
      } else output.push(entry);
    }
  };
  let cursor = 0;
  for (const period of periods) {
    append(
      remaining.filter(
        (entry) =>
          (entry.messageIndex ?? messages.length) >= cursor &&
          (entry.messageIndex ?? messages.length) < period.start,
      ),
    );
    append(
      remaining.filter(
        (entry) =>
          (entry.messageIndex ?? messages.length) >= period.start &&
          (entry.messageIndex ?? messages.length) < period.end,
      ),
      period,
    );
    if (failure && period === periods.at(-1) && period.outcome === "error")
      period.entries.push({
        key: `${period.key}:failure`,
        kind: "failure",
        error: failure,
      });
    output.push(period);
    cursor = period.end;
  }
  append(
    remaining.filter(
      (entry) => (entry.messageIndex ?? messages.length) >= cursor,
    ),
  );
  return output;
}
export function elapsedClock(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}:${String(seconds % 60).padStart(2, "0")}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
