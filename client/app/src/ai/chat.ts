import { effectScope, reactive, shallowReactive, watch } from "vue";
import { projectHistory, rebaseHistoryEvent } from "./conversation-history";
import { invoke } from "@tauri-apps/api/core";
import { isRetiredSetupQuestion } from "../onboarding/questions";
import {
  workBlocks,
  type WorkBlock,
  type ActiveWorkBlock,
} from "./work-blocks";
import type { AgentMessage } from "./contracts";
import {
  readQuestion,
  retainedQuestions,
  validateAnswer,
  type ConversationQuestion,
  type QuestionResponse,
  type RetainedQuestion,
} from "./question";
import {
  mergeReferences,
  referenceKey,
  validReference,
  type ContentReference,
} from "./content-references";
import {
  emptyRuntime,
  type AttachmentRef,
  type PendingInput,
  type PendingKind,
  type ToolActivity,
  type ConversationRuntime,
} from "./queue-runtime";
import { importAttachment, validateAttachment } from "./attachment-runtime";
import { workspaceAiSettings } from "./settings";
import { provisionalTitle } from "./title-runtime";
import { modelRequestError } from "./request-errors";
import { pluginNotices, type PluginNotice } from "./plugin-notices";
import {
  readConversationList,
  readConversationRecord,
  conversationSummary,
  compareConversations,
  type ConversationRecord,
  type ConversationSummary,
  type PluginDevelopment,
} from "./conversation-record";
import { getStatus, type Status } from "./api";
import {
  NativeConversation,
  type ConversationSnapshot,
  type ConversationInput,
  type ConversationAction,
} from "./native-conversation";
import { ownsDictation, type Notice } from "../dictation/runtime";

export interface ChatState {
  questions: RetainedQuestion[];
  questionBusy: boolean;
  questionAnnouncement?: { id: string; prompt: string };
  questionActionPending?: string;
  ephemeral: boolean;
  loadError?: unknown;
  pluginNotices?: PluginNotice[];
  pluginNoticeAnnouncement?: PluginNotice;
  development?: PluginDevelopment;
  draft: string;
  draftSelection: {
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
  } | null;
  dictationNotice: Notice | null;
  dictationInserted: number;
  draftAttachments: AttachmentRef[];
  draftReferences: ContentReference[];
  readonly runReferences: readonly ContentReference[];
  pending: PendingInput[];
  transcript: AgentMessage[];
  historyBefore?: string | null;
  messageOffset?: number;
  historyLoading?: boolean;
  workBlocks: WorkBlock[];
  activeWork?: ActiveWorkBlock;
  toolActivity: ToolActivity[];
  compacting: boolean;
  activityComment: string;
  activityError: unknown;
  attachmentBusy: boolean;
  title: string;
  messages: { role: string; text: string }[];
  error: unknown;
  running: boolean;
  submitting: boolean;
  unsaved: boolean;
  selectingModel: boolean;
  selectionError: unknown;
  selectionUncertain: boolean;
  status: Status | null;
}

interface Session {
  state: ChatState;
  record?: ConversationRecord;
  historyPrefix?: {
    record: ConversationRecord;
    offset: number;
    tip: string;
    before: string | null;
  };
  projectionVersion?: number;
  runtime: ConversationRuntime;
  client: NativeConversation;
  draftBase: ConversationInput;
  draftVersion: number;
  restoringDraft: boolean;
  draftTimer?: ReturnType<typeof setTimeout>;
  stopWatching?: () => void;
  draftWrites: Promise<void>;
  attachmentWrites: Promise<void>;
  completion?: Promise<void>;
  inputCompletion?: Promise<void>;
  selectionCompletion?: Promise<boolean>;
  loading?: Promise<void>;
  questionSubmitting: boolean;
  actionError?: unknown;
  draftTitle?: string;
  submissionId?: string;
  submissionInput?: ConversationInput;
  submissionVersion?: number;
  preparation?: AbortController;
  disposed: boolean;
  statusVersion: number;
  draftModel?: string | null;
  draftThinking?: string | null;
  temporaryAttachments?: Map<string, File>;
  creationAttempted?: boolean;
  initialInput?: PendingInput;
  preparedSubmitted?: boolean;
  preparedSubmission?: {
    id: string;
    action: ConversationAction;
    generation?: string;
  };
  preparedSubmitting?: Promise<boolean>;
  initialConversation?: {
    title: string;
    draft: string;
    runtime: ConversationRuntime;
    development?: PluginDevelopment;
  };
}
interface WorkspaceChats {
  state: {
    conversations: ConversationSummary[];
    selected: string;
    loading: boolean;
    creating: boolean;
    error: unknown;
  };
  sessions: Map<string, Session>;
  listVersion: number;
}
const workspaces = new Map<string, WorkspaceChats>();
function workspace(scope: string): WorkspaceChats {
  let value = workspaces.get(scope);
  if (!value) {
    value = {
      state: reactive({
        conversations: [],
        selected: "legacy",
        loading: false,
        creating: false,
        error: "",
      }),
      sessions: shallowReactive(new Map()),
      listVersion: 0,
    };
    workspaces.set(scope, value);
  }
  return value;
}
function display(message: AgentMessage): { role: string; text: string } {
  return {
    role: message.role,
    text:
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n"),
  };
}
function updateSummary(
  owner: WorkspaceChats,
  record: ConversationRecord,
): void {
  if (
    record.development &&
    !record.development.originConversationId &&
    record.titleInput === "" &&
    !record.messages.length &&
    !record.runtime?.runs.length &&
    !record.runtime?.events.length
  )
    return;
  const summary = conversationSummary(record);
  const index = owner.state.conversations.findIndex(
    (item) => item.id === record.id,
  );
  if (index < 0) owner.state.conversations.push(summary);
  else owner.state.conversations[index] = summary;
  owner.state.conversations.sort(compareConversations);
}
export function workspaceConversations(scope: string) {
  const owner = workspace(scope);
  return {
    state: owner.state,
    async refresh(): Promise<void> {
      if (owner.state.creating) return;
      const version = ++owner.listVersion;
      owner.state.loading = true;
      try {
        const list = readConversationList(
          await invoke("ai_conversations", { scope }),
        );
        if (version !== owner.listVersion || workspaces.get(scope) !== owner)
          return;
        // A listing may finish after a local save; do not replace newer summaries.
        owner.state.conversations = list
          .map((item) => {
            const record = owner.sessions.get(item.id)?.record;
            return record && record.revision > item.revision
              ? conversationSummary(record)
              : item;
          })
          .sort(compareConversations);
        owner.state.error = "";
      } catch {
        if (version === owner.listVersion)
          owner.state.error = "ai.aiAccessOrConversationHistoryCouldNotBeRead";
      } finally {
        if (version === owner.listVersion) owner.state.loading = false;
      }
    },
    async create(): Promise<string | undefined> {
      if (owner.state.creating || owner.state.loading || owner.state.error)
        return;
      const id = crypto.randomUUID();
      workspaceChat(scope, id).state.ephemeral = true;
      return id;
    },
    async createDevelopment(pluginId?: string): Promise<string | undefined> {
      const id = await this.create();
      if (!id || workspaces.get(scope) !== owner) return;
      const { t } = await import("@situate/localization");
      if (workspaces.get(scope) !== owner) return;
      const state = workspaceChat(scope, id).state;
      state.development = Object.freeze({
        version: 2,
        ...(pluginId ? { pluginId } : {}),
      });
      state.title = pluginId
        ? t("pluginDevelopment.furtherTitle", { plugin: pluginId })
        : t("pluginDevelopment.newTitle");
      return id;
    },
    select(id: string): void {
      if (owner.state.conversations.some((item) => item.id === id))
        owner.state.selected = id;
    },
    running(id: string): boolean {
      return owner.sessions.get(id)?.state.running ?? false;
    },
  };
}

function sameInput(left: ConversationInput, right: ConversationInput): boolean {
  return canonicalMessages(left) === canonicalMessages(right);
}
function recordInput(record?: ConversationRecord): ConversationInput {
  return {
    text: record?.draft ?? "",
    attachments: record?.runtime?.draftAttachments ?? [],
    references: record?.runtime?.draftReferences ?? [],
  };
}
export function workspaceChat(
  scope: string,
  conversation = "legacy",
  initialRecord?: ConversationRecord,
) {
  const owner = workspace(scope);
  let session = owner.sessions.get(conversation);
  if (!session) {
    const state = shallowReactive<ChatState>({
      questions: [],
      questionBusy: false,
      ephemeral: false,
      pluginNotices: [],
      draft: "",
      draftSelection: null,
      dictationNotice: null,
      dictationInserted: 0,
      draftAttachments: [],
      draftReferences: [],
      get runReferences() {
        return mergeReferences(
          session?.runtime.runs.flatMap((run) => run.references ?? []) ?? [],
        );
      },
      pending: [],
      transcript: [],
      workBlocks: [],
      toolActivity: [],
      compacting: false,
      activityComment: "",
      activityError: "",
      attachmentBusy: false,
      title: "",
      messages: [],
      error: "",
      running: false,
      submitting: false,
      unsaved: false,
      selectingModel: false,
      selectionError: "",
      selectionUncertain: false,
      status: null,
    });
    session = {
      state,
      runtime: emptyRuntime(),
      draftBase: recordInput(),
      draftVersion: 0,
      restoringDraft: false,
      draftWrites: Promise.resolve(),
      attachmentWrites: Promise.resolve(),
      questionSubmitting: false,
      disposed: false,
      statusVersion: 0,
      client: new NativeConversation(
        scope,
        conversation,
        (snapshot) => project(snapshot),
        (error) => {
          if (live()) {
            current.actionError = error;
            current.state.error = error;
            current.state.unsaved =
              current.client.hasUncertainAction ||
              current.client.snapshot?.phase === "persistenceFailed";
          }
        },
      ),
    };
    owner.sessions.set(conversation, session);
  }
  const current = session;
  const live = () => !current.disposed && workspaces.get(scope) === owner;
  const input = (): ConversationInput => ({
    text: current.state.draft,
    attachments: [...current.state.draftAttachments],
    references: [...current.state.draftReferences],
  });
  function setInput(value: ConversationInput) {
    current.restoringDraft = true;
    current.state.draft = value.text;
    current.state.draftAttachments = [...value.attachments];
    current.state.draftReferences = [...value.references];
    current.restoringDraft = false;
  }
  function pendingQuestion() {
    return current.state.questions.find(
      (question) =>
        question.status === "pending" &&
        !isRetiredSetupQuestion(scope, conversation, question),
    );
  }
  function pendingQuestionAction() {
    const question = current.state.questions.find(
      (question) => question.id === current.state.questionActionPending,
    );
    return question && isRetiredSetupQuestion(scope, conversation, question)
      ? undefined
      : current.state.questionActionPending;
  }
  function project(snapshot: ConversationSnapshot) {
    if (!live()) return;
    const prefix = current.historyPrefix;
    const tip = snapshot.selectedEntryId;
    if (prefix && tip && prefix.tip !== tip) {
      const version = (current.projectionVersion =
        (current.projectionVersion ?? 0) + 1);
      void current.client
        .ancestor(prefix.tip, tip)
        .then(async (ancestor) => {
          if (!live() || version !== current.projectionVersion) return;
          if (!ancestor) current.historyPrefix = undefined;
          else {
            let before: string | null = tip;
            const missing: ReturnType<typeof projectHistory>[] = [];
            while (before) {
              const page = await current.client.history(before);
              if (!live() || version !== current.projectionVersion) return;
              if (page.metadata.selectedEntryId !== tip) return;
              const boundary = page.entries.findIndex(
                (entry) => entry.id === prefix.tip,
              );
              missing.unshift(
                projectHistory(
                  boundary < 0
                    ? page.entries
                    : page.entries.slice(boundary + 1),
                ),
              );
              if (boundary >= 0) break;
              before = page.nextBefore;
              if (!before) throw new Error("native.ai.conversation.conflict");
            }
            prefix.record.messages.push(
              ...missing.flatMap((page) => page.messages),
            );
            prefix.record.runtime!.events.push(
              ...missing.flatMap((page) => page.events),
            );
            prefix.tip = tip;
          }
          projectRecord(snapshot);
        })
        .catch((error) => {
          if (live()) current.state.error = error;
        });
      return;
    }
    projectRecord(snapshot);
  }
  function projectRecord(snapshot: ConversationSnapshot, hydrating = false) {
    if (!live()) return;
    const source = snapshot.record;
    const prefix = current.historyPrefix;
    const offset = prefix?.offset ?? snapshot.messageOffset ?? 0;
    const runtime = source.runtime ?? emptyRuntime();
    const events = [
      ...new Map(
        [...(prefix?.record.runtime?.events ?? []), ...runtime.events].map(
          (event) => [JSON.stringify([event.runId, event.id]), event],
        ),
      ).values(),
    ];
    const record = prefix
      ? {
          ...source,
          messages: [
            ...prefix.record.messages.slice(
              0,
              (snapshot.messageOffset ?? 0) - prefix.offset,
            ),
            ...source.messages,
          ],
          runtime: { ...runtime, events },
        }
      : source;
    if (prefix) prefix.record = record;
    const presentedRuntime = {
      ...(record.runtime ?? emptyRuntime()),
      events: events.map((event) => rebaseHistoryEvent(event, offset)),
    };
    current.state.historyBefore = prefix
      ? prefix.before
      : snapshot.historyBefore;
    current.state.messageOffset = offset;
    const previousQuestions = current.state.questions;
    const local = input();
    const replaceDraft =
      sameInput(local, current.draftBase) ||
      (current.submissionInput !== undefined &&
        current.submissionVersion === current.draftVersion &&
        sameInput(local, current.submissionInput));
    current.record = record;
    current.runtime = presentedRuntime;
    current.draftBase = recordInput(record);
    current.state.loadError = undefined;
    current.state.development = record.development
      ? Object.freeze({ ...record.development })
      : undefined;
    current.state.title = record.title;
    current.state.running = snapshot.taskActive || current.state.submitting;
    current.state.questionBusy =
      (snapshot.questionBusy ?? false) || current.questionSubmitting;
    current.state.unsaved =
      snapshot.phase === "persistenceFailed" ||
      current.client.hasUncertainAction;
    const error = snapshot.error ?? current.actionError ?? "";
    current.state.activityComment = snapshot.activityComment ?? "";
    current.state.pending = current.runtime.pending;
    current.state.transcript = [
      ...record.messages,
      ...(snapshot.partialMessage ? [snapshot.partialMessage] : []),
    ];
    current.state.messages = current.state.transcript.map(display);
    current.state.questions = retainedQuestions(current.runtime.events);
    const question = current.state.questions.at(-1);
    current.state.questionActionPending =
      question?.context !== undefined &&
      question.status === "answered" &&
      !current.runtime.events.some(
        (event) =>
          event.type === "question_action_completed" &&
          (event.data as { questionId?: string }).questionId === question.id,
      )
        ? question.id
        : undefined;
    const presented = current.state.questions.find(
      (question) =>
        !previousQuestions.some((previous) => previous.id === question.id),
    );
    if (presented && current.client.snapshot && !hydrating)
      current.state.questionAnnouncement = {
        id: presented.id,
        prompt: presented.prompt,
      };
    const previousNotices = current.state.pluginNotices ?? [];
    current.state.pluginNotices = pluginNotices(current.runtime.events);
    current.state.pluginNoticeAnnouncement = hydrating
      ? undefined
      : current.state.pluginNotices.find(
          (notice) =>
            !previousNotices.some((previous) => previous.id === notice.id),
        );
    const active = snapshot.taskActive
      ? [...current.runtime.events]
          .reverse()
          .find(
            (event) =>
              event.type === "work_block_start" &&
              !current.runtime.events.some(
                (end) =>
                  end.type === "work_block_end" &&
                  end.runId === event.runId &&
                  (end.data as { workId?: string }).workId ===
                    (event.data as { workId?: string }).workId,
              ),
          )
      : undefined;
    const work = active?.data as
      (ActiveWorkBlock & { workId?: string }) | undefined;
    current.state.activeWork =
      work && Number.isFinite(work.startedAt)
        ? {
            id: work.workId ?? active!.id,
            // Persisted starts use wall time; the live view uses a monotonic clock.
            startedAt:
              performance.now() - Math.max(0, Date.now() - work.startedAt),
            startMessageCount: work.startMessageCount,
          }
        : undefined;
    current.state.workBlocks = workBlocks(
      current.runtime.events.filter((event) => event !== active),
      record.messages.length,
    );
    const lastWork = current.state.workBlocks.at(-1);
    const modelFailed =
      snapshot.phase === "interrupted" &&
      snapshot.error &&
      !pendingQuestionAction() &&
      lastWork?.outcome === "error" &&
      lastWork.messageCount === record.messages.length;
    current.state.error =
      error === "native.ai.conversation.saveFailed"
        ? "ai.theConversationCouldNotBeSavedKeepThisWorkspace"
        : modelFailed
          ? (modelRequestError(snapshot.error) ??
            "ai.theResponseFailedCheckAIAccessReconnectIfYour")
          : (modelRequestError(error) ?? error);
    current.state.compacting =
      snapshot.taskActive &&
      current.runtime.events.at(-1)?.type === "compaction_start";
    current.state.toolActivity = current.runtime.events
      .filter((event) => event.type === "tool_intent")
      .map((event): ToolActivity => {
        const data = event.data as {
          name: string;
          args: unknown;
          toolCallId?: string;
          messageIndex?: number;
          pluginId?: string;
          pluginName?: string;
        };
        const id = data.toolCallId ?? event.id;
        const ended = current.runtime.events.find(
          (item) =>
            item.runId === event.runId &&
            item.sequence > event.sequence &&
            item.type === "tool_execution_end" &&
            (item.data as { toolCallId: string }).toolCallId === id,
        );
        const result = ended?.data as
          | {
              result?: ToolActivity["result"];
              isError?: boolean;
              durationMs?: number;
            }
          | undefined;
        const started = current.runtime.events.some(
          (item) =>
            item.type === "tool_execution_start" &&
            item.runId === event.runId &&
            (item.data as { toolCallId?: string }).toolCallId === id,
        );
        return {
          id,
          runId: event.runId,
          name: data.name,
          args: data.args,
          messageIndex: data.messageIndex,
          pluginId: data.pluginId,
          pluginName: data.pluginName,
          state: ended
            ? result?.isError
              ? "error"
              : "completed"
            : snapshot.taskActive
              ? started
                ? "running"
                : "intent"
              : "interrupted",
          result: result?.result,
          durationMs: result?.durationMs,
        };
      });
    if (replaceDraft) setInput(current.draftBase);
    updateSummary(owner, record);
  }
  async function load(): Promise<void> {
    if (current.state.ephemeral || !live()) return;
    if (current.loading) return current.loading;
    if (current.client.snapshot) return;
    current.loading = current.client.refresh();
    try {
      await current.loading;
    } catch (error) {
      if (live()) current.state.loadError = error;
      throw error;
    } finally {
      current.loading = undefined;
    }
  }
  function statusForDraft(): Promise<Status> {
    return invoke("ai_preview_conversation_status", {
      scope,
      model: current.draftModel ?? null,
      thinking: current.draftThinking ?? null,
    });
  }
  async function refresh(confirmSelection = false): Promise<void> {
    if (current.state.selectingModel || !live()) return;
    const version = ++current.statusVersion;
    const results = await Promise.allSettled([
      (current.state.ephemeral
        ? statusForDraft()
        : getStatus(scope, conversation)
      ).then((status) => {
        if (!live() || version !== current.statusVersion) return;
        current.state.status = status;
        if (confirmSelection) {
          current.state.selectionUncertain = false;
          current.state.selectionError = "";
        }
      }),
      load(),
    ]);
    if (!live() || version !== current.statusVersion) return;
    if (results.some((result) => result.status === "rejected")) {
      current.state.status = null;
      current.state.error = "ai.aiAccessOrConversationHistoryCouldNotBeRead";
    } else if (
      current.state.error === "ai.aiAccessOrConversationHistoryCouldNotBeRead"
    )
      current.state.error = "";
  }
  async function selectPreference(
    kind: "model" | "thinking",
    value: string | null,
  ): Promise<boolean> {
    if (current.state.selectingModel || !live()) return false;
    current.state.selectingModel = true;
    current.state.selectionError = "";
    ++current.statusVersion;
    try {
      if (current.state.ephemeral) {
        if (kind === "model") {
          current.draftModel = value;
          current.draftThinking = null;
        } else current.draftThinking = value;
        const status = await statusForDraft();
        if (!live()) return false;
        current.state.status = status;
        current.state.selectionUncertain = false;
        return !current.state.status.modelError;
      }
      const status = await invoke<Status>(`ai_select_conversation_${kind}`, {
        scope,
        conversation,
        [kind]: value,
      });
      if (!live()) return false;
      current.state.status = status;
      current.state.selectionUncertain = false;
      if (!status.modelError) {
        if (kind === "model") current.draftModel = undefined;
        else current.draftThinking = undefined;
      }
      return !status.modelError;
    } catch {
      if (!live()) return false;
      current.state.selectionError =
        "ai.theChatModelCouldNotBeChangedFinishAny";
      current.state.selectionUncertain = true;
      try {
        const status = await (current.state.ephemeral
          ? statusForDraft()
          : getStatus(scope, conversation));
        if (live()) {
          current.state.status = status;
          current.state.selectionUncertain = false;
        }
      } catch {
        /* A failed write can have committed; only readback or retry can settle it. */
      }
      return false;
    } finally {
      current.state.selectingModel = false;
    }
  }
  function select(
    kind: "model" | "thinking",
    value: string | null,
  ): Promise<boolean> {
    if (current.state.selectingModel) return Promise.resolve(false);
    if (!current.state.ephemeral && current.initialConversation) {
      if (kind === "model") {
        current.draftModel = value;
        current.draftThinking = null;
      } else current.draftThinking = value;
    }
    current.selectionCompletion = selectPreference(kind, value);
    return current.selectionCompletion;
  }

  async function saveDraft(): Promise<void> {
    clearTimeout(current.draftTimer);
    const save = current.draftWrites.then(async () => {
      if (!live() || current.state.ephemeral) return;
      await load();
      if (current.client.hasUncertainAction || current.state.unsaved)
        throw new Error("ai.saveTheConversationBeforeClosing");
      current.actionError = undefined;
      while (live() && !sameInput(input(), current.draftBase)) {
        const value = input();
        const version = current.draftVersion;
        const expected = current.draftBase;
        await current.client.action({
          version: 1,
          type: "draft",
          expected,
          input: value,
        });
        if (version === current.draftVersion) setInput(current.draftBase);
      }
    });
    current.draftWrites = save.catch(() => {});
    return save;
  }
  if (!current.stopWatching) {
    const effects = effectScope(true);
    effects.run(() =>
      watch(
        () => [
          current.state.draft,
          JSON.stringify(current.state.draftAttachments),
          JSON.stringify(current.state.draftReferences),
        ],
        () => {
          if (current.restoringDraft || !live()) return;
          current.draftVersion++;
          clearTimeout(current.draftTimer);
          if (
            !current.state.ephemeral &&
            !current.state.unsaved &&
            !current.state.submitting
          )
            current.draftTimer = setTimeout(() => {
              void saveDraft().catch((error) => {
                if (live()) {
                  current.state.unsaved = true;
                  current.state.error = error;
                }
              });
            }, 300);
        },
        { flush: "sync" },
      ),
    );
    current.stopWatching = () => effects.stop();
  }
  function stageAttachment(file: File): AttachmentRef {
    validateAttachment(file);
    const id = crypto.randomUUID();
    current.temporaryAttachments ??= new Map();
    current.temporaryAttachments.set(id, file);
    return { id, mimeType: file.type, size: file.size, name: file.name };
  }
  async function startConversation(
    input?: PendingInput,
    canStart = live,
  ): Promise<void> {
    if (!current.state.ephemeral && !current.initialConversation) return;
    try {
      current.initialInput ??= input;
      input = current.initialInput;
      await current.attachmentWrites;
      for (const [id, file] of current.temporaryAttachments ?? []) {
        if (!canStart()) break;
        const stored = await importAttachment(scope, file);
        if (!live()) return;
        const replace = (item: AttachmentRef) =>
          item.id === id ? stored : item;
        current.restoringDraft = true;
        current.state.draftAttachments =
          current.state.draftAttachments.map(replace);
        current.restoringDraft = false;
        if (input) input.attachments = input.attachments.map(replace);
        current.temporaryAttachments!.delete(id);
      }
      if (!canStart()) {
        if (!current.creationAttempted) current.initialInput = undefined;
        return;
      }
      current.initialConversation ??= {
        title:
          current.draftTitle ??
          provisionalTitle(input?.text ?? current.state.draft),
        draft: input?.text ?? current.state.draft,
        ...(current.state.development
          ? { development: current.state.development }
          : {}),
        runtime: {
          ...emptyRuntime(),
          draftAttachments: [
            ...(input?.attachments ?? current.state.draftAttachments),
          ],
          ...(input?.references?.length || current.state.draftReferences.length
            ? {
                draftReferences: [
                  ...(input?.references ?? current.state.draftReferences),
                ],
              }
            : {}),
        },
      };
      const initial = current.initialConversation;
      if (!current.record) {
        ++owner.listVersion;
        owner.state.loading = false;
        let stored: ConversationRecord | undefined;
        if (current.creationAttempted) {
          const list = readConversationList(
            await invoke("ai_conversations", { scope }),
          );
          if (list.some((item) => item.id === conversation))
            stored = readConversationRecord(
              await invoke("ai_conversation_read", { scope, conversation }),
              conversation,
            );
        }
        if (!stored) {
          current.creationAttempted = true;
          try {
            stored = readConversationRecord(
              await invoke("ai_create_conversation", {
                scope,
                id: conversation,
                title: initial.title,
                initial: {
                  draft: initial.draft,
                  attachments: initial.runtime?.draftAttachments ?? [],
                  references: initial.runtime?.draftReferences ?? [],
                  ...(initial.development
                    ? { development: initial.development }
                    : {}),
                },
              }),
              conversation,
            );
          } catch (error) {
            try {
              stored = readConversationRecord(
                await invoke("ai_conversation_read", { scope, conversation }),
                conversation,
              );
            } catch {
              throw error;
            }
          }
        }
        if (
          !sameContent(stored, { ...stored, ...initial, messages: [] }) ||
          canonicalMessages(stored.development) !==
            canonicalMessages(initial.development)
        )
          throw new Error("native.ai.conversation.conflict");
        if (!live()) return;
        current.record = stored;
        current.state.title = stored.title;
        current.state.ephemeral = false;
        ++owner.listVersion;
        owner.state.loading = false;
        updateSummary(owner, stored);
      }
      if (current.draftModel != null) {
        if (!(await selectPreference("model", current.draftModel)))
          throw new Error("ai.theChatModelCouldNotBeChangedFinishAny");
      }
      if (current.draftThinking != null) {
        if (!(await selectPreference("thinking", current.draftThinking)))
          throw new Error("ai.theChatModelCouldNotBeChangedFinishAny");
      }
      if (current.draftTitle !== undefined) {
        await load();
        await current.client.action({
          version: 1,
          type: "renameTitle",
          expected: current.record!.title,
          title: current.draftTitle,
        });
        current.draftTitle = undefined;
      }
      current.initialConversation = undefined;
      current.initialInput = undefined;
      current.creationAttempted = undefined;
    } catch (error) {
      if (live()) {
        current.state.unsaved = true;
        current.state.error =
          "ai.theConversationCouldNotBeSavedKeepThisWorkspace";
      }
      throw error;
    }
  }

  async function action(value: ConversationAction): Promise<void> {
    current.actionError = undefined;
    await load();
    await current.client.action(value);
  }
  function runId(): string | undefined {
    return (
      (current.client.snapshot?.questionBusy
        ? (current.client.snapshot.actionId ?? undefined)
        : undefined) ??
      current.runtime.runs.find((run) => run.state === "running")?.id ??
      current.submissionId
    );
  }
  const abort = (): void => {
    current.preparation?.abort();
    const id = runId();
    if (id)
      void current.client
        .action({ version: 1, type: "cancel", runId: id })
        .catch((error) => {
          if (live()) current.state.error = error;
        });
  };
  async function submit(kind?: PendingKind): Promise<void> {
    const version = current.draftVersion;
    const preparation = new AbortController();
    current.preparation = preparation;
    const captured = input();
    let accepted = false;
    try {
      await current.attachmentWrites;
      if (preparation.signal.aborted || !live()) return;
      const pending: PendingInput = {
        id: crypto.randomUUID(),
        kind: kind ?? "steering",
        state: "pending",
        ...captured,
        timestamp: Date.now(),
      };
      if (current.state.ephemeral || current.initialConversation)
        await startConversation(
          pending,
          () => live() && !preparation.signal.aborted,
        );
      if (preparation.signal.aborted || !live()) return;
      await load();
      await saveDraft();
      if (preparation.signal.aborted || !live()) return;
      current.submissionInput = {
        text: pending.text,
        attachments: pending.attachments,
        references: pending.references ?? [],
      };
      current.submissionVersion = version;
      const actionId = crypto.randomUUID();
      current.submissionId = actionId;
      await current.client.action(
        kind
          ? {
              version: 1,
              type: "enqueue",
              kind,
              input: current.submissionInput,
              timestamp: pending.timestamp,
            }
          : {
              version: 1,
              type: "submit",
              input: current.submissionInput,
              timestamp: pending.timestamp,
            },
        actionId,
      );
      accepted = true;
    } catch (error) {
      if (live()) {
        current.actionError = error;
        current.state.error = error;
        current.state.unsaved =
          current.state.unsaved || current.client.hasUncertainAction;
      }
    } finally {
      current.preparation = undefined;
      current.state.submitting = false;
      current.submissionId = undefined;
      current.submissionInput = undefined;
      if (current.client.snapshot) project(current.client.snapshot);
      else current.state.running = false;
    }
    if (accepted && !kind) {
      try {
        await current.client.settled();
      } catch (error) {
        if (live()) {
          current.actionError = error;
          current.state.error = error;
        }
      }
    }
  }
  function blocked(): boolean {
    return (
      !live() ||
      current.state.questionBusy ||
      !!pendingQuestion() ||
      !!pendingQuestionAction() ||
      current.state.selectingModel ||
      current.state.selectionUncertain ||
      current.state.unsaved ||
      ownsDictation(scope, conversation)
    );
  }
  if (initialRecord && !current.record) {
    current.record = readConversationRecord(initialRecord, conversation);
    current.runtime = current.record.runtime ?? emptyRuntime();
    current.draftBase = recordInput(current.record);
    if (!current.draftVersion) setInput(current.draftBase);
    current.state.title = current.record.title;
    current.state.transcript = [...current.record.messages];
    current.state.messages = current.state.transcript.map(display);
  }
  return {
    state: current.state,
    async loadOlder(): Promise<void> {
      const snapshot = current.client.snapshot;
      const before = current.state.historyBefore;
      if (!snapshot || !before || current.state.historyLoading) return;
      current.state.historyLoading = true;
      try {
        const page = await current.client.history(before);
        if (!live() || current.client.snapshot !== snapshot) return;
        if (page.metadata.selectedEntryId !== snapshot.selectedEntryId) return;
        const older = projectHistory(page.entries);
        const existing = current.historyPrefix;
        const source = existing?.record ?? snapshot.record;
        current.historyPrefix = {
          offset: page.messageOffset,
          tip: page.metadata.selectedEntryId!,
          before: page.nextBefore,
          record: {
            ...source,
            messages: [...older.messages, ...source.messages],
            runtime: {
              ...(source.runtime ?? emptyRuntime()),
              events: [...older.events, ...(source.runtime?.events ?? [])],
            },
          },
        };
        projectRecord(snapshot, true);
      } catch (error) {
        if (live()) current.state.error = error;
      } finally {
        if (live()) current.state.historyLoading = false;
      }
    },
    refresh: async () => {
      if (!current.state.ephemeral && current.client.snapshot)
        await current.client.refresh();
      await refresh(true);
    },
    saveDraft,
    async persistPreparedAssignment(canStart: () => boolean): Promise<void> {
      if (!live() || !canStart())
        throw new Error("plugins.workspaceUnavailable");
      await startConversation(undefined, () => live() && canStart());
      if (!live() || !canStart())
        throw new Error("plugins.workspaceUnavailable");
      await load();
      current.state.unsaved =
        current.client.hasUncertainAction ||
        current.client.snapshot?.phase === "persistenceFailed";
      await saveDraft();
    },
    // Resolve on native acceptance, not at the end of the model's work.
    submitPreparedAssignment(canStart: () => boolean): Promise<boolean> {
      if (current.preparedSubmitted) return Promise.resolve(true);
      if (current.preparedSubmitting) return current.preparedSubmitting;
      const task = (async () => {
        if (!live() || !canStart() || current.state.submitting) return false;
        current.state.submitting = true;
        current.state.running = true;
        try {
          if (!current.preparedSubmission) {
            if (
              blocked() ||
              current.state.ephemeral ||
              !current.state.draft.trim()
            )
              return false;
            await saveDraft();
            if (!live() || !canStart()) return false;
            current.preparedSubmission = {
              id: crypto.randomUUID(),
              generation: current.client.snapshot?.generation,
              action: {
                version: 1,
                type: "submit",
                input: input(),
                timestamp: Date.now(),
              },
            };
          }
          const submission = current.preparedSubmission;
          if (current.client.snapshot?.phase === "persistenceFailed")
            await current.client.action({
              version: 1,
              type: "retryPersistence",
            });
          if (!live() || !canStart()) return false;
          const snapshot = await current.client.action(
            submission.action,
            submission.id,
            submission.generation,
          );
          if (snapshot.phase === "persistenceFailed") return false;
          current.preparedSubmitted = true;
          return true;
        } finally {
          current.state.submitting = false;
          if (current.client.snapshot) project(current.client.snapshot);
        }
      })();
      current.preparedSubmitting = task;
      current.inputCompletion = task.then(
        () => {},
        () => {},
      );
      void task
        .finally(() => {
          current.preparedSubmitting = undefined;
        })
        .catch(() => {});
      return task;
    },
    async presentQuestion(value: ConversationQuestion) {
      if (
        current.state.running ||
        current.state.questionBusy ||
        current.state.unsaved
      )
        throw new Error("chatQuestion.busy");
      await action({
        version: 1,
        type: "presentQuestion",
        question: readQuestion(value),
      });
    },
    async supersedeQuestion(questionId: string) {
      await action({ version: 1, type: "supersedeQuestion", questionId });
    },
    answerQuestion(response: QuestionResponse): Promise<void> {
      if (
        current.state.questionBusy ||
        current.state.running ||
        current.state.unsaved ||
        current.state.attachmentBusy ||
        ownsDictation(scope, conversation)
      )
        return Promise.reject(new Error("chatQuestion.busy"));
      validateAnswer(
        pendingQuestion(),
        response,
        !!current.state.draftAttachments.length ||
          !!current.state.draftReferences.length,
      );
      const captured =
        response.choiceId === undefined
          ? { ...input(), text: response.text }
          : { text: "", attachments: [], references: [] };
      current.questionSubmitting = true;
      current.state.questionBusy = true;
      const version = current.draftVersion;
      const preparation = new AbortController();
      current.preparation = preparation;
      const task = (async () => {
        try {
          await saveDraft();
          await load();
          if (preparation.signal.aborted || !live()) return;
          current.submissionInput =
            response.choiceId === undefined ? captured : undefined;
          current.submissionVersion = version;
          current.submissionId = crypto.randomUUID();
          await current.client.action(
            {
              version: 1,
              type: "answerQuestion",
              response,
              input: captured,
              timestamp: Date.now(),
            },
            current.submissionId,
          );
        } finally {
          current.preparation = undefined;
          current.questionSubmitting = false;
          current.submissionId = undefined;
          current.submissionInput = undefined;
          if (current.client.snapshot) project(current.client.snapshot);
          else current.state.questionBusy = false;
        }
        await current.client.settled();
      })();
      current.completion = task;
      return task;
    },
    retryQuestionAction(questionId: string): Promise<void> {
      if (
        current.state.questionBusy ||
        current.state.running ||
        current.state.unsaved
      )
        return Promise.reject(new Error("chatQuestion.busy"));
      current.questionSubmitting = true;
      current.state.questionBusy = true;
      const preparation = new AbortController();
      current.preparation = preparation;
      const task = (async () => {
        try {
          await load();
          if (preparation.signal.aborted || !live()) return;
          current.submissionId = crypto.randomUUID();
          await current.client.action(
            { version: 1, type: "retryQuestionAction", questionId },
            current.submissionId,
          );
        } finally {
          current.preparation = undefined;
          current.submissionId = undefined;
          current.questionSubmitting = false;
          if (current.client.snapshot) project(current.client.snapshot);
          else current.state.questionBusy = false;
        }
        await current.client.settled();
      })();
      current.completion = task;
      return task;
    },
    async renameTitle(value: string) {
      const title = value.trim();
      if (!title || Array.from(title).length > 256)
        throw new Error("chat.titleInvalid");
      if (current.state.ephemeral) {
        current.draftTitle = title;
        current.state.title = title;
        return;
      }
      current.draftTitle = undefined;
      await load();
      await action({
        version: 1,
        type: "renameTitle",
        expected: current.record!.title,
        title,
      });
    },
    async dictate() {
      await load();
      if (!live()) return;
      const { dictateDraft } = await import("../dictation/draft");
      if (live())
        await dictateDraft(scope, conversation, current.state, live, saveDraft);
    },
    async notifyPluginAvailable(
      plugin: { pluginId: string; pluginName: string },
      _runId?: string,
    ) {
      await action({
        version: 1,
        type: "notifyPluginAvailable",
        pluginId: plugin.pluginId,
      });
    },
    selectModel: (model: string | null) => select("model", model),
    selectThinking: (thinking: string | null) => select("thinking", thinking),
    inheritModel: () => select("model", null),
    async recallPending() {
      await saveDraft();
      await action({ version: 1, type: "recall" });
    },
    async addReference(reference: ContentReference) {
      if (
        !validReference(reference) ||
        reference.workspaceId !== scope ||
        current.state.draftReferences.length >= 32
      )
        throw new Error("native.content.reference.invalid");
      await load();
      if (!live()) return;
      current.state.draftReferences = mergeReferences([
        ...current.state.draftReferences,
        { ...reference },
      ]);
      await saveDraft();
    },
    async removeReference(reference: ContentReference) {
      await load();
      current.state.draftReferences = current.state.draftReferences.filter(
        (item) => referenceKey(item) !== referenceKey(reference),
      );
      await saveDraft();
    },
    addAttachment(file: File): Promise<void> {
      current.state.attachmentBusy = true;
      const task = current.attachmentWrites.then(async () => {
        try {
          await load();
          const reference = current.state.ephemeral
            ? stageAttachment(file)
            : await importAttachment(scope, file);
          if (live()) {
            current.state.draftAttachments = [
              ...current.state.draftAttachments,
              reference,
            ];
            await saveDraft();
          }
        } catch (error) {
          if (live())
            current.state.error =
              error instanceof Error && error.message.startsWith("chat.")
                ? error.message
                : "chat.attachmentFailed";
        }
      });
      current.attachmentWrites = task;
      void task.finally(() => {
        if (current.attachmentWrites === task)
          current.state.attachmentBusy = false;
      });
      return task;
    },
    removeAttachment(id: string) {
      current.temporaryAttachments?.delete(id);
      current.state.draftAttachments = current.state.draftAttachments.filter(
        (item) => item.id !== id,
      );
    },
    send(kind: PendingKind = "steering"): Promise<void> {
      const settings = workspaceAiSettings(
        scope,
        current.state.status?.config?.connectionId,
      ).state;
      if (
        blocked() ||
        settings.loading ||
        settings.saving ||
        settings.error ||
        (current.state.ephemeral && current.state.attachmentBusy) ||
        (!current.state.draft.trim() &&
          !current.state.draftAttachments.length &&
          !current.state.draftReferences.length)
      )
        return Promise.resolve();
      if (current.state.submitting)
        return current.completion ?? Promise.resolve();
      const queued = current.state.running;
      current.state.submitting = true;
      current.state.running = true;
      clearTimeout(current.draftTimer);
      const task = submit(queued ? kind : undefined);
      current.inputCompletion = task;
      if (!queued) current.completion = task;
      return task;
    },
    abort,
    async retrySave() {
      await current.attachmentWrites;
      await current.draftWrites;
      if (current.state.ephemeral || current.initialConversation) {
        await startConversation();
        current.state.unsaved = false;
        current.state.error = "";
      }
      await load();
      current.actionError = undefined;
      await current.client.retry();
      if (current.client.snapshot) project(current.client.snapshot);
      await saveDraft();
    },
    async abortAndWait() {
      abort();
      await current.completion;
      await current.inputCompletion;
      if (current.client.snapshot) await current.client.settled();
      await current.attachmentWrites;
      await current.selectionCompletion;
      if (current.state.unsaved)
        throw new Error("ai.saveTheConversationBeforeClosing");
      await saveDraft();
    },
  };
}
function sameContent(
  left: ConversationRecord,
  right: ConversationRecord,
): boolean {
  return (
    canonicalMessages({
      ...left,
      revision: 0,
      runtime: left.runtime ?? emptyRuntime(),
    }) ===
    canonicalMessages({
      ...right,
      revision: 0,
      runtime: right.runtime ?? emptyRuntime(),
    })
  );
}
function canonicalMessages(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : item,
  );
}
export async function refreshWorkspaceChats(scope: string): Promise<void> {
  const owner = workspaces.get(scope);
  if (owner)
    await Promise.all(
      [...owner.sessions.keys()].map((id) =>
        workspaceChat(scope, id).refresh(),
      ),
    );
}
export function workspaceChatActivity(scope: string): {
  running: boolean;
  selectingModel: boolean;
} {
  const owner = workspace(scope);
  return {
    running: [...owner.sessions.values()].some(
      (session) => session.state.running || session.state.questionBusy,
    ),
    selectingModel: [...owner.sessions.values()].some(
      (session) => session.state.selectingModel,
    ),
  };
}
export async function saveChatDrafts(scope?: string): Promise<void> {
  for (const [id, owner] of workspaces)
    if (!scope || scope === id) {
      for (const [conversation, session] of owner.sessions) {
        if (session.state.questionBusy && session.completion)
          await session.completion;
        if (session.state.running || session.state.questionBusy)
          throw new Error("ai.saveTheConversationBeforeClosing");
        await session.attachmentWrites;
        await session.selectionCompletion;
        await workspaceChat(id, conversation).saveDraft();
        if (
          session.state.running ||
          session.state.questionBusy ||
          session.state.unsaved
        )
          throw new Error("ai.saveTheConversationBeforeClosing");
      }
    }
  for (const [id, owner] of workspaces)
    if (!scope || scope === id)
      for (const session of owner.sessions.values()) {
        const local = {
          text: session.state.draft,
          attachments: session.state.draftAttachments,
          references: session.state.draftReferences,
        };
        if (
          session.state.running ||
          session.state.questionBusy ||
          session.state.selectingModel ||
          session.state.unsaved ||
          (!session.state.ephemeral && !sameInput(local, session.draftBase))
        )
          throw new Error("ai.saveTheConversationBeforeClosing");
      }
}
export async function abortWorkspaceChats(scope: string): Promise<void> {
  await invoke("ai_conversations_abort", { scope });
}
export function discardUnsentChat(
  scope: string,
  conversation: string,
): boolean {
  const owner = workspaces.get(scope);
  const session = owner?.sessions.get(conversation);
  if (
    !session?.state.ephemeral ||
    session.state.running ||
    session.state.unsaved
  )
    return false;
  session.disposed = true;
  session.client.dispose();
  clearTimeout(session.draftTimer);
  session.stopWatching?.();
  session.temporaryAttachments?.clear();
  owner!.sessions.delete(conversation);
  return true;
}
export function closeChats(open: string[]): void {
  for (const [scope, owner] of workspaces)
    if (!open.includes(scope)) {
      owner.listVersion++;
      for (const session of owner.sessions.values()) {
        session.disposed = true;
        session.preparation?.abort();
        session.client.dispose();
        clearTimeout(session.draftTimer);
        session.stopWatching?.();
      }
      workspaces.delete(scope);
    }
}
