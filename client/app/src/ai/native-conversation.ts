import { Channel, invoke } from "@tauri-apps/api/core";
import type { AssistantMessage } from "./contracts";
import { readPartialMessage } from "./conversation";
import {
  readConversationRecord,
  type ConversationRecord,
} from "./conversation-record";
import type {
  AttachmentRef,
  PendingKind,
  ContentReference,
} from "./queue-runtime";
import type { ConversationQuestion, QuestionResponse } from "./question";
import { readHistoryPage, type HistoryPage } from "./conversation-history";

export interface ConversationInput {
  text: string;
  attachments: AttachmentRef[];
  references: ContentReference[];
}
export type ConversationAction = { version: 1 } & (
  | { type: "draft"; expected: ConversationInput; input: ConversationInput }
  | { type: "submit"; input: ConversationInput; timestamp: number }
  | {
      type: "enqueue";
      kind: PendingKind;
      input: ConversationInput;
      timestamp: number;
    }
  | { type: "recall" }
  | { type: "cancel"; runId: string }
  | { type: "retryPersistence" }
  | { type: "renameTitle"; expected: string; title: string }
  | { type: "presentQuestion"; question: ConversationQuestion }
  | {
      type: "answerQuestion";
      response: QuestionResponse;
      input: ConversationInput;
      timestamp: number;
    }
  | { type: "retryQuestionAction"; questionId: string }
  | { type: "supersedeQuestion"; questionId: string }
  | {
      type: "notifyPluginAvailable";
      pluginId: string;
    }
);
export interface ConversationSnapshot {
  version: 1;
  generation: string;
  position: number;
  record: ConversationRecord;
  messageEntryIds?: string[];
  selectedEntryId?: string | null;
  historyBefore?: string | null;
  messageOffset?: number;
  eventOffset?: number;
  hasHistory?: boolean;
  phase: "idle" | "running" | "persistenceFailed" | "interrupted";
  error: string | null;
  taskActive: boolean;
  actionId?: string | null;
  partialMessage?: AssistantMessage | null;
  activityComment?: string;
  questionBusy?: boolean;
}
export type ConversationUpdate =
  | {
      version: 1;
      generation: string;
      position: number;
      subscription: string;
      type: "snapshot";
      snapshot: ConversationSnapshot;
    }
  | {
      version: 1;
      generation: string;
      position: number;
      subscription: string;
      type: "progress";
      partialMessage?: AssistantMessage | null;
      activityComment?: string;
    }
  | {
      version: 1;
      generation: string;
      position: number;
      subscription: string;
      type: "overflow";
    };
export function readSnapshot(
  value: unknown,
  conversation: string,
): ConversationSnapshot {
  if (!value || typeof value !== "object")
    throw new Error("native.ai.conversation.versionInvalid");
  const snapshot = value as ConversationSnapshot;
  if (
    snapshot.version !== 1 ||
    typeof snapshot.generation !== "string" ||
    !snapshot.generation ||
    !Number.isSafeInteger(snapshot.position) ||
    snapshot.position < 0 ||
    !["idle", "running", "persistenceFailed", "interrupted"].includes(
      snapshot.phase,
    ) ||
    typeof snapshot.taskActive !== "boolean" ||
    (snapshot.actionId != null && typeof snapshot.actionId !== "string") ||
    (snapshot.error !== null && typeof snapshot.error !== "string") ||
    (snapshot.activityComment !== undefined &&
      typeof snapshot.activityComment !== "string") ||
    (snapshot.questionBusy !== undefined &&
      typeof snapshot.questionBusy !== "boolean") ||
    (snapshot.hasHistory !== undefined &&
      typeof snapshot.hasHistory !== "boolean") ||
    [snapshot.messageOffset, snapshot.eventOffset].some(
      (offset) =>
        offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0),
    ) ||
    [snapshot.selectedEntryId, snapshot.historyBefore].some(
      (id) => id != null && (typeof id !== "string" || !id || id.length > 256),
    ) ||
    (snapshot.messageEntryIds !== undefined &&
      (!Array.isArray(snapshot.messageEntryIds) ||
        snapshot.messageEntryIds.some(
          (id) => typeof id !== "string" || !id || id.length > 256,
        ) ||
        new Set(snapshot.messageEntryIds).size !==
          snapshot.messageEntryIds.length))
  )
    throw new Error("native.ai.conversation.versionInvalid");
  if (snapshot.partialMessage != null)
    readPartialMessage(snapshot.partialMessage);
  const record = readConversationRecord(snapshot.record, conversation);
  if (
    snapshot.messageEntryIds &&
    snapshot.messageEntryIds.length !== record.messages.length
  )
    throw new Error("native.ai.conversation.versionInvalid");
  return { ...snapshot, record };
}

export class NativeConversation {
  snapshot?: ConversationSnapshot;
  private epoch = 0;
  private closed = false;
  private connecting?: Promise<void>;
  private uncertain?: {
    actionId: string;
    action: ConversationAction;
    generation?: string;
  };
  private waiters = new Set<{
    resolve: (snapshot: ConversationSnapshot) => void;
    reject: (error: unknown) => void;
  }>();
  constructor(
    private readonly scope: string,
    private readonly conversation: string,
    private readonly publish: (snapshot: ConversationSnapshot) => void,
    private readonly failed: (error: unknown) => void,
  ) {}
  async ancestor(ancestor: string, selected: string): Promise<boolean> {
    if (this.closed) throw new Error("plugins.workspaceUnavailable");
    const result = await invoke("ai_conversation_ancestor", {
      scope: this.scope,
      conversation: this.conversation,
      ancestor,
      selected,
    });
    if (typeof result !== "boolean")
      throw new Error("native.ai.conversation.versionInvalid");
    return result;
  }
  async history(before: string): Promise<HistoryPage> {
    if (this.closed) throw new Error("plugins.workspaceUnavailable");
    return readHistoryPage(
      await invoke("ai_conversation_history", {
        scope: this.scope,
        conversation: this.conversation,
        before,
        limit: 100,
      }),
    );
  }
  get hasUncertainAction(): boolean {
    return !!this.uncertain;
  }
  refresh(): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error("plugins.workspaceUnavailable"));
    if (this.connecting) return this.connecting;
    const epoch = ++this.epoch;
    this.connecting = this.subscribe(epoch).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }
  private async subscribe(epoch: number): Promise<void> {
    const channel = new Channel<ConversationUpdate>();
    const buffered: ConversationUpdate[] = [];
    let attached = false;
    let overflow = false;
    channel.onmessage = (event) => {
      try {
        if (this.closed || epoch !== this.epoch) return;
        if (!attached) {
          if (buffered.length < 64) buffered.push(event);
          else overflow = true;
        } else this.update(event);
      } finally {
        if (
          event &&
          typeof event.subscription === "string" &&
          Number.isSafeInteger(event.position)
        )
          void invoke("ai_conversation_ack", {
            scope: this.scope,
            conversation: this.conversation,
            subscription: event.subscription,
            position: event.position,
          }).catch(() => {});
      }
    };
    const value = await invoke("ai_conversation_subscribe", {
      scope: this.scope,
      conversation: this.conversation,
      channel,
    });
    if (this.closed || epoch !== this.epoch) return;
    const snapshot = readSnapshot(value, this.conversation);
    if (
      !this.snapshot ||
      snapshot.generation !== this.snapshot.generation ||
      snapshot.position >= this.snapshot.position
    )
      this.replace(snapshot);
    attached = true;
    if (overflow) {
      this.resync();
      return;
    }
    for (const event of buffered) this.update(event);
  }
  private resync(): void {
    // A new atomic attachment closes both stream gaps and generation changes.
    void (this.connecting ?? Promise.resolve())
      .then(() => this.refresh())
      .catch((error) => this.report(error));
  }
  private update(value: ConversationUpdate): void {
    try {
      if (
        !value ||
        value.version !== 1 ||
        typeof value.subscription !== "string" ||
        !value.subscription ||
        !Number.isSafeInteger(value.position) ||
        value.position < 0 ||
        value.type === "overflow"
      ) {
        this.resync();
        return;
      }
      const previous = this.snapshot;
      if (
        previous?.generation === value.generation &&
        value.position <= previous.position
      )
        return;
      if (
        !previous ||
        value.generation !== previous.generation ||
        value.position !== previous.position + 1
      ) {
        this.resync();
        return;
      }
      if (value.type === "snapshot") {
        const next = readSnapshot(value.snapshot, this.conversation);
        if (
          next.generation !== value.generation ||
          next.position !== value.position
        )
          throw new Error("native.ai.conversation.versionInvalid");
        this.replace(next);
      } else if (value.type === "progress") {
        const next = { ...previous, position: value.position };
        if (Object.hasOwn(value, "partialMessage"))
          next.partialMessage = value.partialMessage;
        if (Object.hasOwn(value, "activityComment"))
          next.activityComment = value.activityComment;
        this.replace(readSnapshot(next, this.conversation));
      } else this.resync();
    } catch (error) {
      this.report(error);
      this.resync();
    }
  }
  private replace(snapshot: ConversationSnapshot): void {
    this.snapshot = snapshot;
    this.publish(snapshot);
    if (!snapshot.taskActive && !snapshot.questionBusy) {
      for (const waiter of this.waiters) waiter.resolve(snapshot);
      this.waiters.clear();
    }
  }
  private report(error: unknown): void {
    if (this.closed) return;
    this.failed(error);
    for (const waiter of this.waiters) waiter.reject(error);
    this.waiters.clear();
  }
  async action(
    action: ConversationAction,
    actionId: string = crypto.randomUUID(),
    generation = this.snapshot?.generation,
  ): Promise<ConversationSnapshot> {
    if (this.closed) throw new Error("plugins.workspaceUnavailable");
    if (generation === undefined) {
      await this.refresh();
      if (this.closed || !this.snapshot)
        throw new Error("plugins.workspaceUnavailable");
      generation = this.snapshot.generation;
    }
    try {
      action = structuredClone(action);
    } catch {
      throw new Error("native.ai.conversation.versionInvalid");
    }
    try {
      const value = await invoke("ai_conversation_action", {
        scope: this.scope,
        conversation: this.conversation,
        actionId,
        action,
        generation,
      });
      const snapshot = readSnapshot(value, this.conversation);
      if (!this.closed) {
        if (
          generation !== undefined &&
          this.snapshot?.generation !== generation
        )
          await this.refresh();
        else if (
          !this.snapshot ||
          snapshot.generation !== this.snapshot.generation ||
          snapshot.position >= this.snapshot.position
        )
          this.replace(snapshot);
      }
      if (this.uncertain?.actionId === actionId) this.uncertain = undefined;
      return snapshot;
    } catch (error) {
      const key = error instanceof Error ? error.message : error;
      if (
        ![
          "native.ai.conversation.conflict",
          "native.ai.conversation.versionInvalid",
          "native.ai.turn.inactive",
          "native.ai.response.finishFirst",
          "chatQuestion.stale",
          "chatQuestion.invalid",
          "chatQuestion.busy",
          "chat.titleInvalid",
        ].includes(String(key)) &&
        !(
          action.type === "notifyPluginAvailable" &&
          key === "native.ai.tool.unavailable"
        )
      )
        this.uncertain ??= { actionId, action, generation };
      this.failed(error);
      // Read-back never acknowledges an uncertain action and never replays it.
      void this.refresh().catch((error) => this.report(error));
      throw error;
    }
  }
  async retry(): Promise<ConversationSnapshot> {
    const pending = this.uncertain;
    if (
      pending &&
      this.snapshot?.phase === "persistenceFailed" &&
      pending.generation === this.snapshot.generation
    )
      await this.action({ version: 1, type: "retryPersistence" });
    return pending
      ? this.action(pending.action, pending.actionId, pending.generation)
      : this.action({ version: 1, type: "retryPersistence" });
  }
  settled(): Promise<ConversationSnapshot> {
    if (this.closed)
      return Promise.reject(new Error("plugins.workspaceUnavailable"));
    if (
      this.snapshot &&
      !this.snapshot.taskActive &&
      !this.snapshot.questionBusy
    )
      return Promise.resolve(this.snapshot);
    return new Promise((resolve, reject) => {
      this.waiters.add({ resolve, reject });
    });
  }
  dispose(): void {
    this.closed = true;
    this.epoch++;
    for (const waiter of this.waiters)
      waiter.reject(new Error("plugins.workspaceUnavailable"));
    this.waiters.clear();
  }
}
