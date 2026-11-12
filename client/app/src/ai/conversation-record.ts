import { loadConversation, type PortableMessage } from "./conversation";
import { validReference } from "./content-references";
import type { ConversationRuntime } from "./queue-runtime";
export type {
  AttachmentRef,
  PendingInput,
  ToolActivity,
} from "./queue-runtime";

export interface PluginDevelopment {
  readonly version: 2;
  readonly pluginId?: string;
  readonly originConversationId?: string;
}
export const developmentUuidPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
function validDevelopment(value: unknown, id: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).every((key) =>
      ["version", "pluginId", "originConversationId"].includes(key),
    ) &&
    typeof id === "string" &&
    new RegExp(developmentUuidPattern).test(id) &&
    item.version === 2 &&
    (item.pluginId === undefined
      ? true
      : typeof item.pluginId === "string" &&
        /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(item.pluginId) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(item.pluginId)) &&
    (!Object.hasOwn(item, "originConversationId") ||
      (typeof item.originConversationId === "string" &&
        /^[a-z0-9_-]{1,64}$/.test(item.originConversationId) &&
        item.originConversationId !== id))
  );
}

export interface ConversationSummary {
  development?: PluginDevelopment;
  id: string;
  title: string;
  revision: number;
  lastUserMessageAt?: number;
}
export interface ConversationRecord extends ConversationSummary {
  version: 2;
  messages: PortableMessage[];
  draft: string;
  titleInput?: string;
  runtime?: ConversationRuntime;
}
function validateRuntime(runtime: ConversationRuntime): void {
  const validId = (value: unknown) =>
    typeof value === "string" && value.length > 0 && value.length <= 256;
  const attachment = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return (
      validId(item.id) &&
      typeof item.name === "string" &&
      typeof item.mimeType === "string" &&
      Number.isSafeInteger(item.size) &&
      (item.size as number) >= 0
    );
  };
  const references = (value: unknown) =>
    value === undefined ||
    (Array.isArray(value) && value.length <= 32 && value.every(validReference));
  const sequences = new Map<string, number>();
  const eventIds = new Set<string>();
  const valid =
    runtime &&
    typeof runtime === "object" &&
    references(runtime.draftReferences) &&
    Array.isArray(runtime.draftAttachments) &&
    runtime.draftAttachments.every(attachment) &&
    Array.isArray(runtime.pending) &&
    runtime.pending.every(
      (item) =>
        item &&
        validId(item.id) &&
        ["steering", "followUp"].includes(item.kind) &&
        ["pending", "consumed"].includes(item.state) &&
        typeof item.text === "string" &&
        Number.isFinite(item.timestamp) &&
        references(item.references) &&
        Array.isArray(item.attachments) &&
        item.attachments.every(attachment),
    ) &&
    new Set(runtime.pending.map((item) => item.id)).size ===
      runtime.pending.length &&
    Array.isArray(runtime.events) &&
    runtime.events.every((event) => {
      if (
        !event ||
        !validId(event.id) ||
        !validId(event.runId) ||
        !Number.isSafeInteger(event.sequence) ||
        event.sequence <= (sequences.get(event.runId) ?? 0) ||
        typeof event.type !== "string"
      )
        return false;
      const key = JSON.stringify([event.runId, event.id]);
      if (eventIds.has(key)) return false;
      eventIds.add(key);
      sequences.set(event.runId, event.sequence);
      return true;
    }) &&
    Array.isArray(runtime.runs) &&
    runtime.runs.every(
      (run) =>
        run &&
        validId(run.id) &&
        Object.keys(run).every((key) =>
          [
            "id",
            "state",
            "startedAt",
            "endedAt",
            "usage",
            "references",
          ].includes(key),
        ) &&
        references(run.references) &&
        ["running", "completed", "interrupted", "error"].includes(run.state) &&
        Number.isFinite(run.startedAt) &&
        (run.usage === undefined ||
          (Array.isArray(run.usage) &&
            run.usage.every(
              (entry) =>
                entry &&
                Object.keys(entry).every((key) =>
                  ["kind", "usage", "requestId"].includes(key),
                ),
            ))),
    ) &&
    (!runtime.checkpoint ||
      (Number.isSafeInteger(runtime.checkpoint.sourceCount) &&
        runtime.checkpoint.sourceCount >= 0 &&
        typeof runtime.checkpoint.summary === "string" &&
        validId(runtime.checkpoint.runId)));
  if (!valid) throw new Error("native.ai.conversation.versionInvalid");
}
function summary(value: unknown): value is ConversationSummary {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    /^[a-z0-9_-]{1,64}$/.test(record.id) &&
    (!Object.hasOwn(record, "development") ||
      validDevelopment(record.development, record.id)) &&
    typeof record.title === "string" &&
    Number.isSafeInteger(record.revision) &&
    (record.revision as number) >= 0
  );
}
export function readConversationRecord(
  value: unknown,
  id: string,
): ConversationRecord {
  if (!summary(value)) throw new Error("native.ai.conversation.versionInvalid");
  const record = value as ConversationRecord;
  if (
    record.id !== id ||
    record.version !== 2 ||
    typeof record.draft !== "string" ||
    (record.titleInput !== undefined &&
      (typeof record.titleInput !== "string" ||
        record.titleInput.length > 16384)) ||
    Object.keys(record).some(
      (key) =>
        ![
          "version",
          "id",
          "title",
          "titleInput",
          "revision",
          "messages",
          "draft",
          "runtime",
          "development",
        ].includes(key),
    )
  )
    throw new Error("native.ai.conversation.versionInvalid");
  if (record.runtime) validateRuntime(record.runtime);
  return { ...record, messages: loadConversation(record.messages) };
}
export function conversationSummary(
  record: ConversationRecord,
): ConversationSummary {
  const lastUserMessageAt = record.messages.reduce<number | undefined>(
    (latest, message) =>
      message.role === "user"
        ? Math.max(latest ?? -Infinity, message.timestamp)
        : latest,
    undefined,
  );
  return {
    id: record.id,
    title: record.title,
    revision: record.revision,
    ...(lastUserMessageAt !== undefined ? { lastUserMessageAt } : {}),
    ...(record.development ? { development: record.development } : {}),
  };
}

export function compareConversations(
  a: ConversationSummary,
  b: ConversationSummary,
): number {
  return (
    (b.lastUserMessageAt ?? -Infinity) - (a.lastUserMessageAt ?? -Infinity) ||
    a.id.localeCompare(b.id)
  );
}

export function readConversationList(value: unknown): ConversationSummary[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        summary(item) &&
        (item.lastUserMessageAt === undefined ||
          Number.isFinite(item.lastUserMessageAt)) &&
        Object.keys(item).every((key) =>
          [
            "id",
            "title",
            "revision",
            "development",
            "lastUserMessageAt",
          ].includes(key),
        ),
    ) ||
    new Set(value.map((item) => item.id)).size !== value.length
  )
    throw new Error("native.ai.conversation.versionInvalid");
  return value;
}
