import type { AgentMessage } from "./contracts";
import { mergeReferences, type ContentReference } from "./content-references";
export type { ContentReference } from "./content-references";

export interface AttachmentRef {
  id: string;
  mimeType: string;
  size: number;
  name: string;
}
export type PendingKind = "steering" | "followUp";
export interface PendingInput {
  id: string;
  kind: PendingKind;
  state: "pending" | "consumed";
  text: string;
  attachments: AttachmentRef[];
  references?: ContentReference[];
  timestamp: number;
}
export interface ToolActivity {
  id: string;
  runId: string;
  name: string;
  messageIndex?: number;
  pluginId?: string;
  pluginName?: string;
  args: unknown;
  state: "intent" | "running" | "completed" | "error" | "interrupted";
  result?: { content: unknown[]; details?: unknown };
  durationMs?: number;
}
export interface RuntimeEvent {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  data: unknown;
}
export interface RunRecord {
  id: string;
  state: "running" | "completed" | "interrupted" | "error";
  startedAt: number;
  endedAt?: number;
  usage?: {
    kind: "main" | "compaction" | "comment" | "title";
    usage: unknown;
    requestId?: string;
  }[];
  references?: ContentReference[];
}
export interface CompactionCheckpoint {
  sourceCount: number;
  summary: string;
  runId: string;
}
export interface ConversationRuntime {
  draftAttachments: AttachmentRef[];
  draftReferences?: ContentReference[];
  pending: PendingInput[];
  events: RuntimeEvent[];
  runs: RunRecord[];
  checkpoint?: CompactionCheckpoint;
}
export const emptyRuntime = (): ConversationRuntime => ({
  draftAttachments: [],
  pending: [],
  events: [],
  runs: [],
});
export function recallInput(
  pending: PendingInput[],
  draft: string,
  attachments: AttachmentRef[],
  references: ContentReference[] = [],
) {
  const ordered = ["steering", "followUp"].flatMap((kind) =>
    pending.filter((item) => item.state === "pending" && item.kind === kind),
  );
  return {
    draft: [...ordered.map((item) => item.text), draft]
      .filter(Boolean)
      .join("\n\n"),
    attachments: [
      ...new Map(
        [...ordered.flatMap((item) => item.attachments), ...attachments].map(
          (item) => [item.id, item],
        ),
      ).values(),
    ],
    references: mergeReferences([
      ...ordered.flatMap((item) => item.references ?? []),
      ...references,
    ]),
    pending: pending.filter((item) => item.state === "consumed"),
  };
}
export function inputMessage(
  input: PendingInput,
  content: AgentMessage["content"] = input.text,
): AgentMessage {
  return { role: "user", content, timestamp: input.timestamp } as AgentMessage;
}
