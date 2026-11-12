import type { ActiveWorkBlock, WorkBlock } from "../../ai/work-blocks";
import { validReferencePath } from "../../ai/content-references";
import type { RetainedQuestion } from "../../ai/question";
import type { PluginNotice } from "../../ai/plugin-notices";
import type {
  AgentMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolResultMessage,
} from "../../ai/contracts";

export interface ToolActivity {
  id: string;
  runId: string;
  messageIndex?: number;
  pluginId?: string;
  pluginName?: string;
  name: string;
  args: unknown;
  result?: unknown;
  durationMs?: number;
  state: string;
}
export interface ToolView {
  messageIndex?: number;
  pluginId?: string;
  pluginName?: string;
  key: string;
  id: string;
  name: string;
  args?: unknown;
  result?: ToolResultMessage;
  progress?: unknown;
  durationMs?: number;
  state: string;
}
export interface VerifiedChange {
  path: string;
  before: string | null;
  after: string;
  beforeRevision: string | null;
  afterRevision: string;
}
export type TranscriptBlock = (
  | { key: string; kind: "duration"; work: WorkBlock }
  | {
      key: string;
      kind: "message";
      role: "user" | "assistant";
      work?: WorkBlock;
      streaming?: boolean;
      content: (TextContent | ImageContent | ThinkingContent)[];
    }
  | { key: string; kind: "stopped"; outcome?: "cancelled" | "error" }
  | { key: string; kind: "notice"; notice: PluginNotice }
  | { key: string; kind: "question"; question: RetainedQuestion }
  | { key: string; kind: "tools"; calls: ToolView[] }
  | { key: string; kind: "change" | "call"; call: ToolView }
) & { messageIndex?: number };

export function verifiedChange(call: ToolView): VerifiedChange | undefined {
  if (
    !call.result ||
    !call.result.details ||
    typeof call.result.details !== "object"
  )
    return;
  const change: unknown = (call.result.details as Record<string, unknown>)
    .change;
  if (!change || typeof change !== "object") return;
  const value = change as Record<string, unknown>;
  if (
    typeof value.path !== "string" ||
    !value.path ||
    !(value.before === null || typeof value.before === "string") ||
    typeof value.after !== "string" ||
    !(
      value.beforeRevision === null || typeof value.beforeRevision === "string"
    ) ||
    typeof value.afterRevision !== "string" ||
    !value.afterRevision
  )
    return;
  return value as unknown as VerifiedChange;
}
export function importChangeReceipts(
  call: ToolView,
):
  | { files: { path: string; revision: string }[]; history?: string }
  | undefined {
  const details = call.result?.details;
  if (call.name !== "create_batch" || !details || typeof details !== "object")
    return;
  const value = details as Record<string, unknown>;
  if (!Array.isArray(value.files) || value.files.length > 256) return;
  const files: { path: string; revision: string }[] = [];
  for (const file of value.files) {
    if (
      !file ||
      typeof file !== "object" ||
      !validReferencePath(file.path) ||
      typeof file.revision !== "string" ||
      !/^[a-f0-9]{40}$/.test(file.revision)
    )
      return;
    files.push({ path: file.path, revision: file.revision });
  }
  const history =
    typeof value.historyRevision === "string" &&
    /^[a-f0-9]{40}$/.test(value.historyRevision)
      ? value.historyRevision
      : undefined;
  return { files, history };
}
export function transcriptBlocks(
  messages: AgentMessage[],
  activity: ToolActivity[],
  running: boolean,
  notices: readonly PluginNotice[] = [],
  questions: readonly RetainedQuestion[] = [],
  workBlocks: readonly WorkBlock[] = [],
  activeWork?: ActiveWorkBlock,
  messageOffset = 0,
): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  const includedWork = new Set<WorkBlock>();
  function appendWork(work: WorkBlock, messageIndex: number) {
    includedWork.add(work);
    blocks.push({
      key: `work:${work.id}`,
      kind: "duration",
      work,
      messageIndex,
    });
  }
  const pending = new Map<string, ToolView>();
  const chronologicalNotices = [...notices].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  let nextNotice = 0;
  const chronologicalQuestions = questions
    .filter((q) => q.status !== "pending")
    .sort((a, b) => a.timestamp - b.timestamp);
  let nextQuestion = 0;
  function appendNotices(before: number, messageIndex: number) {
    const entries: { timestamp: number; block: TranscriptBlock }[] = [];
    while (
      nextQuestion < chronologicalQuestions.length &&
      chronologicalQuestions[nextQuestion]!.timestamp <= before
    ) {
      const question = chronologicalQuestions[nextQuestion++]!;
      entries.push({
        timestamp: question.timestamp,
        block: {
          key: `question:${question.id}`,
          kind: "question",
          messageIndex,
          question,
        },
      });
    }
    while (
      nextNotice < chronologicalNotices.length &&
      chronologicalNotices[nextNotice]!.timestamp < before
    ) {
      const notice = chronologicalNotices[nextNotice++]!;
      entries.push({
        timestamp: notice.timestamp,
        block: {
          key: `notice:${notice.id}`,
          kind: "notice",
          notice,
          messageIndex,
        },
      });
    }
    entries
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((entry) => blocks.push(entry.block));
  }
  for (const [index, message] of messages.entries()) {
    for (const work of workBlocks.filter((work) => work.messageCount === index))
      appendWork(work, index);
    appendNotices(message.timestamp, index);
    const key = `${index + messageOffset}:${message.timestamp}`;
    if (message.role === "toolResult") {
      const call = [...pending.values()]
        .reverse()
        .find(
          (call) =>
            call.id === message.toolCallId && call.name === message.toolName,
        );
      if (call && call.name === message.toolName) {
        call.result = message;
        call.durationMs = message.durationMs;
        call.state = message.isError ? "failed" : "completed";
        pending.delete(call.key);
      } else
        blocks.push({
          key,
          kind: "tools",
          calls: [
            {
              key,
              id: message.toolCallId,
              messageIndex: index,
              name: message.toolName,
              result: message,
              durationMs: message.durationMs,
              state: message.isError ? "failed" : "completed",
            },
          ],
        });
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content;
    let text: Extract<TranscriptBlock, { kind: "message" }> | undefined;
    for (const [part, block] of content.entries()) {
      if (block.type === "toolCall") {
        text = undefined;
        const origin = activity.find(
          (item) =>
            item.id === block.id &&
            item.name === block.name &&
            item.messageIndex === index,
        );
        const call: ToolView = {
          key: `${key}:${part}`,
          id: block.id,
          messageIndex: index,
          ...(origin?.pluginId && origin.pluginName
            ? { pluginId: origin.pluginId, pluginName: origin.pluginName }
            : {}),
          name: block.name,
          args: block.arguments,
          state:
            running &&
            !(
              message.role === "assistant" && message.stopReason === "aborted"
            ) &&
            (!activeWork || index >= activeWork.startMessageCount)
              ? "running"
              : "interrupted",
        };
        const previous = blocks.at(-1);
        if (previous?.kind === "tools") previous.calls.push(call);
        else blocks.push({ key: call.key, kind: "tools", calls: [call] });
        pending.set(call.key, call);
      } else if (
        (block.type === "text" && block.text.trim()) ||
        block.type === "image" ||
        (block.type === "thinking" && block.thinking.trim())
      ) {
        if (!text) {
          text = {
            key: `${key}:${part}`,
            kind: "message",
            role: message.role,
            messageIndex: index,
            ...(running &&
            message.role === "assistant" &&
            index === messages.length - 1
              ? { streaming: true }
              : {}),
            content: [],
          };
          blocks.push(text);
        }
        text.content.push(block);
      }
    }
    if (message.role === "assistant" && message.stopReason === "aborted")
      blocks.push({
        key: `${key}:stopped`,
        kind: "stopped",
        messageIndex: index,
      });
    if (message.role === "assistant" && message.stopReason === "error")
      blocks.push({
        key: `${key}:error`,
        kind: "stopped",
        outcome: "error",
        messageIndex: index,
      });
  }
  for (const work of workBlocks.filter(
    (work) => work.messageCount === messages.length,
  ))
    appendWork(work, messages.length);
  for (const work of workBlocks)
    if (!includedWork.has(work)) appendWork(work, messages.length);
  appendNotices(Infinity, messages.length);
  for (const call of pending.values()) {
    const progress =
      activity.find(
        (item) =>
          item.id === call.id &&
          item.name === call.name &&
          item.messageIndex === call.messageIndex,
      ) ??
      ([...pending.values()].filter((item) => item.id === call.id).length === 1
        ? activity.find(
            (item) =>
              item.id === call.id &&
              item.name === call.name &&
              item.messageIndex === undefined,
          )
        : undefined);
    if (progress) {
      call.progress = progress.result;
      call.durationMs = progress.durationMs;
      call.state =
        !running && ["running", "started", "pending"].includes(progress.state)
          ? "interrupted"
          : progress.state;
    }
  }
  const grouped: TranscriptBlock[] = [];
  for (const block of blocks) {
    const previous = grouped.at(-1);
    if (
      block.kind === "duration" &&
      previous?.kind === "message" &&
      previous.role === "assistant" &&
      !previous.work
    ) {
      previous.work = block.work;
      continue;
    }
    if (block.kind !== "tools") {
      grouped.push(block);
      continue;
    }
    for (const call of block.calls) {
      if (call.name === "ask_question" && call.state === "completed") continue;
      if (verifiedChange(call) || importChangeReceipts(call)?.files.length)
        grouped.push({
          key: call.key,
          kind: "change",
          call,
          messageIndex: call.messageIndex,
        });
      else if (["write", "edit", "create_batch"].includes(call.name))
        grouped.push({
          key: call.key,
          kind: "call",
          call,
          messageIndex: call.messageIndex,
        });
      else {
        const previous = grouped.at(-1);
        if (previous?.kind === "tools") previous.calls.push(call);
        else grouped.push({ kind: "tools", key: call.key, calls: [call] });
      }
    }
  }
  return grouped;
}
export function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}
