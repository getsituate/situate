import { invoke } from "@tauri-apps/api/core";
import { t } from "@situate/localization";
import { filesRequest, type TextVersion } from "../files/api";
import { getStatus } from "../ai/api";
import { workspaceChat, workspaceConversations } from "../ai/chat";
import { ownsDictation } from "../dictation/runtime";
import {
  readConversationRecord,
  readConversationList,
} from "../ai/conversation-record";
import { onboardingSession } from "./session";
import { checkModelAccess } from "./model-check";
import type { OnboardingRecord } from "./types";
import {
  sameSetup,
  setupQuestion,
  canAnswerOnboardingQuestion,
} from "./questions";

const preparing = new Map<
  string,
  Promise<{ id: string; chat: ReturnType<typeof workspaceChat> } | null>
>();
export function restoreSetupConversation(scope: string) {
  const pending = preparing.get(scope);
  if (pending) return pending;
  const operation = prepareConversation(scope, false);
  preparing.set(scope, operation);
  void operation
    .finally(() => {
      if (preparing.get(scope) === operation) preparing.delete(scope);
    })
    .catch(() => {});
  return operation;
}
async function prepareConversation(scope: string, create: boolean) {
  const session = onboardingSession(scope);
  await session.load();
  await session.flush();
  const record = session.state.record;
  if (!record) throw new Error("native.onboarding.storage.incomplete");
  let id = record.conversationId;
  if (!id) {
    if (!create) return null;
    id = crypto.randomUUID();
    await session.update({ conversationId: id });
  }
  const prepared = await loadSetupChat(scope, id, t("onboardingAgent.title"));
  if (
    !create &&
    ["access", "method"].includes(record.step) &&
    !record.proposal &&
    !record.instructionRevision &&
    !hasSetupInput(prepared.record, prepared.chat)
  )
    return null;
  return { id: prepared.id, chat: prepared.chat };
}
function hasSetupInput(
  record: ReturnType<typeof readConversationRecord>,
  chat: ReturnType<typeof workspaceChat>,
) {
  return !!(
    record.messages.length ||
    record.draft.length ||
    record.runtime?.runs.length ||
    record.runtime?.checkpoint ||
    record.runtime?.events.length ||
    record.runtime?.pending.length ||
    record.runtime?.draftAttachments.length ||
    record.runtime?.draftReferences?.length ||
    chat.state.running ||
    chat.state.transcript.length ||
    chat.state.draft.length ||
    chat.state.pending?.length ||
    chat.state.draftAttachments?.length ||
    chat.state.draftReferences?.length ||
    chat.state.questions?.length
  );
}
const starting = new Map<
  string,
  Promise<{ id: string; chat: ReturnType<typeof workspaceChat> }>
>();
export function startSetupConversation(scope: string, signal?: AbortSignal) {
  const existing = starting.get(scope);
  if (existing) return existing;
  const pending = startConversation(scope, signal);
  starting.set(scope, pending);
  void pending
    .finally(() => {
      if (starting.get(scope) === pending) starting.delete(scope);
    })
    .catch(() => {});
  return pending;
}
async function startConversation(scope: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const restored = await restoreSetupConversation(scope);
  const prepared = restored ?? (await prepareConversation(scope, true));
  if (!prepared) throw new Error("native.onboarding.storage.incomplete");
  signal?.throwIfAborted();
  const session = onboardingSession(scope);
  const retained = readConversationRecord(
    await invoke("ai_conversation_read", { scope, conversation: prepared.id }),
    prepared.id,
  );
  const unstarted = !hasSetupInput(retained, prepared.chat);
  const state = session.state.record!;
  if (
    state.step === "access" ||
    (state.step === "method" && !state.instructionBase && unstarted)
  ) {
    const base = await instructionVersion(scope);
    await session.update({ step: "method", instructionBase: base }, signal);
  }
  if (unstarted && session.state.record!.step === "method") {
    const record = session.state.record!;
    await sendMessage(
      prepared.chat,
      t("onboardingAgent.brief", {
        preferences: [
          record.description,
          record.approaches.length
            ? t("onboardingAgent.previousPreferences", {
                preferences: record.approaches.join(", "),
              })
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        sources: record.sourceDescription,
        fresh: record.fresh
          ? t("onboardingAgent.startFresh")
          : t("onboardingAgent.useSources"),
        intent: {
          keep: t("onboardingAgent.intent.keep"),
          change: t("onboardingAgent.intent.change"),
          help: t("onboardingAgent.intent.help"),
        }[record.intent ?? "help"],
      }),
      signal,
    );
  }
  return prepared;
}
export async function recoverSetupQuestion(scope: string) {
  const session = onboardingSession(scope);
  await session.retry();
  const prepared = await restoreSetupConversation(scope);
  if (!prepared) return;
  const chat = prepared.chat;
  if (chat.state.running || chat.state.questionBusy || chat.state.unsaved)
    throw new Error("native.onboarding.storage.conflict");
  await session.flush();
  if (chat.state.questionActionPending)
    throw new Error("native.onboarding.storage.conflict");
  if (
    session.state.record?.step === "proposal" &&
    !chat.state.questions.some((question) => question.status === "pending")
  ) {
    const previous = setupQuestion(scope, prepared.id);
    if (previous) await chat.presentQuestion(previous);
  }
  await invoke("onboarding_action", {
    scope,
    action: "recover",
    expected: null,
  });
  await session.retry();
  const pending = chat.state.questions.find(
    (question) => question.status === "pending",
  );
  if (pending && pending.context === undefined) return pending;
  if (chat.state.questionActionPending)
    throw new Error("native.onboarding.storage.conflict");
  if (pending && canAnswerOnboardingQuestion(scope, prepared.id, pending))
    return pending;
  if (session.state.record?.step === "support") return;
  const question = setupQuestion(scope, prepared.id);
  if (question) await chat.presentQuestion(question);
  return question;
}
export async function continueSetupSupport(
  scope: string,
  expected: OnboardingRecord,
  signal?: AbortSignal,
) {
  const session = onboardingSession(scope);
  await session.retry();
  const prepared = await restoreSetupConversation(scope);
  await session.flush();
  signal?.throwIfAborted();
  const record = session.state.record;
  if (
    !prepared ||
    !record ||
    !sameSetup(expected, record) ||
    !record.instructionRevision ||
    !["sources", "review"].includes(record.step) ||
    record.entered ||
    record.paused
  )
    throw new Error("native.onboarding.storage.conflict");
  const chat = prepared.chat;
  if (
    chat.state.running ||
    chat.state.unsaved ||
    chat.state.questionBusy ||
    chat.state.questionActionPending ||
    chat.state.attachmentBusy ||
    ownsDictation(scope, prepared.id)
  )
    throw new Error("native.onboarding.storage.conflict");
  let question = chat.state.questions.find((item) => item.status === "pending");
  if (question) {
    if (!canAnswerOnboardingQuestion(scope, prepared.id, question))
      throw new Error("native.onboarding.storage.conflict");
  } else {
    const next = setupQuestion(scope, prepared.id);
    if (!next) throw new Error("native.onboarding.storage.conflict");
    await chat.presentQuestion(next);
    question = chat.state.questions.find((item) => item.id === next.id);
  }
  signal?.throwIfAborted();
  if (!question) throw new Error("native.onboarding.storage.conflict");
  const completion = chat.answerQuestion({
    questionId: question.id,
    choiceId: "support",
  });
  return { completion };
}
export async function enterSetupApp(scope: string) {
  const session = onboardingSession(scope);
  await session.load();
  await session.flush();
  const record = session.state.record;
  if (
    !record ||
    !record.instructionRevision ||
    (!["sources", "review", "support", "complete"].includes(record.step) &&
      !(record.entered && record.step === "proposal"))
  )
    throw new Error("native.onboarding.storage.incomplete");
  if (!record.entered) {
    const status = await getStatus(scope);
    if (!status.available || !status.selectedModel || status.modelError)
      throw new Error("onboarding.accessRequired");
  }
  if (record.step === "complete" && record.entered) return;
  await setupAction(scope, "enter");
}
async function loadSetupChat(scope: string, id: string, title: string) {
  let record: ReturnType<typeof readConversationRecord>;
  try {
    record = readConversationRecord(
      await invoke("ai_conversation_read", { scope, conversation: id }),
      id,
    );
  } catch (readError) {
    const conversations = await invoke("ai_conversations", { scope })
      .then(readConversationList)
      .catch(() => {
        throw readError;
      });
    if (conversations.some((conversation) => conversation.id === id))
      throw readError;
    try {
      record = readConversationRecord(
        await invoke("ai_create_conversation", { scope, id, title }),
        id,
      );
    } catch (error) {
      // A known child ID is read back instead of allocating another after uncertain creation.
      try {
        record = readConversationRecord(
          await invoke("ai_conversation_read", { scope, conversation: id }),
          id,
        );
      } catch {
        throw error;
      }
    }
  }
  await workspaceConversations(scope).refresh();
  const chat = workspaceChat(scope, id);
  await chat.refresh();
  if (chat.state.loadError) throw chat.state.loadError;
  return { id, chat, record };
}
export async function checkSetupAccess(scope: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const session = onboardingSession(scope);
  await session.load();
  signal?.throwIfAborted();
  if (!session.state.record || session.state.record.step === "complete")
    throw new Error("native.onboarding.storage.incomplete");
  return checkModelAccess(scope, signal);
}
async function sendMessage(
  chat: ReturnType<typeof workspaceChat>,
  text: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (
    chat.state.running ||
    chat.state.unsaved ||
    (chat.state.draft.trim() && chat.state.draft !== text)
  )
    throw new Error("onboarding.responseFailed");
  chat.state.draft = text;
  await chat.saveDraft();
  signal?.throwIfAborted();
  if (chat.state.draft !== text) throw new Error("onboarding.responseFailed");
  void chat.send().catch(() => {
    chat.state.error = "onboarding.responseFailed";
  });
  if (!chat.state.running)
    throw chat.state.error || new Error("onboarding.responseFailed");
  return chat;
}
export async function instructionVersion(
  scope: string,
): Promise<TextVersion | null> {
  const snapshot = await filesRequest({
    workspaceId: scope,
    operation: "snapshot",
  });
  if (
    !snapshot.snapshot.entries.some(
      (file) => file.path === ".situate/working-method.md" && !file.isDirectory,
    )
  )
    return null;
  const read = await filesRequest({
    workspaceId: scope,
    operation: "read",
    path: ".situate/working-method.md",
  });
  if (read.status !== "ok") throw new Error("onboarding.conflict");
  return read.document.version;
}
async function setupAction(
  scope: string,
  action: "confirm" | "finish" | "enter",
  signal?: AbortSignal,
  expected?: OnboardingRecord,
) {
  const session = onboardingSession(scope);
  await session.load();
  await session.flush();
  signal?.throwIfAborted();
  const record = session.state.record;
  if (!record || (expected && !sameSetup(expected, record)))
    throw new Error("native.onboarding.storage.conflict");
  await invoke("onboarding_action", {
    scope,
    action,
    expected: structuredClone(expected ?? record),
  });
  await session.retry();
}
export async function confirmInstructions(
  scope: string,
  signal?: AbortSignal,
  expected?: OnboardingRecord,
) {
  await setupAction(scope, "confirm", signal, expected);
}
export async function finishOnboarding(scope: string, signal?: AbortSignal) {
  await setupAction(scope, "finish", signal);
}
export async function pendingSetupDevelopments(
  scope: string,
): Promise<boolean> {
  const session = onboardingSession(scope);
  await session.load();
  const record = session.state.record;
  if (record?.step !== "complete") return false;
  for (const idea of record.ideas.filter((idea) => idea.choice === "develop")) {
    try {
      const child = readConversationRecord(
        await invoke("ai_conversation_read", {
          scope,
          conversation: idea.developmentId,
        }),
        idea.developmentId,
      );
      if (
        child.development?.pluginId !== idea.pluginId ||
        (!child.messages.length && !child.runtime?.runs.length)
      )
        return true;
    } catch {
      return true;
    }
  }
  return false;
}
const handedOff = new Set<string>();
export async function startSetupDevelopments(
  scope: string,
  record: OnboardingRecord,
) {
  if (record.step !== "complete") return;
  const failures: unknown[] = [];
  await Promise.allSettled(
    record.ideas
      .filter((idea) => idea.choice === "develop")
      .map(async (idea) => {
        const key = `${scope}:${idea.developmentId}`;
        if (handedOff.has(key)) return;
        handedOff.add(key);
        try {
          const result = await invoke<{
            conversation: unknown;
            ready: boolean;
            error?: string;
          }>("onboarding_development_prepare", {
            scope,
            developmentId: idea.developmentId,
          });
          const child = readConversationRecord(
            result.conversation,
            idea.developmentId,
          );
          if (child.development?.pluginId !== idea.pluginId)
            throw new Error("native.plugins.developmentToolDenied");
          await workspaceConversations(scope).refresh();
          if (child.messages.length || child.runtime?.runs.length) return;
          if (!result.ready)
            throw result.error ?? new Error("chat.developmentUnavailable");
          const chat = workspaceChat(scope, child.id);
          await chat.refresh();
          if (chat.state.running || chat.state.transcript.length) return;
          if (
            chat.state.unsaved ||
            chat.state.loadError ||
            !chat.state.draft.trim()
          )
            throw (
              chat.state.loadError ||
              chat.state.error ||
              new Error("chat.developmentUnavailable")
            );
          void chat.send().catch(() => {
            chat.state.error = "chat.developmentUnavailable";
          });
          if (!chat.state.running)
            throw chat.state.error || new Error("chat.developmentUnavailable");
        } catch (error) {
          failures.push(error);
        } finally {
          handedOff.delete(key);
          await workspaceConversations(scope).refresh();
        }
      }),
  );
  return failures;
}
