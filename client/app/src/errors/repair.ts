import { t, type MessageKey } from "@situate/localization";
import { workspaceChat, workspaceConversations } from "../ai/chat";
import { workspaceAiSettings } from "../ai/settings";
import { workspaceCoordinator, type UiCoordinator } from "../layout/registry";
import { workspaceLayout, type NavigationTicket } from "../layout/session";
import { snapshot } from "../workspaces/api";
import { selectedTab } from "../layout/model";
import { currentEntry } from "../layout/navigation";

export interface ErrorRepairInput {
  id: string;
  scope?: string;
  boundary: string;
  code: string;
  details: string;
}
export interface ErrorRepairResult {
  conversationId?: string;
  blocked?: MessageKey;
  durable: boolean;
  assignment: string;
  started: boolean;
}
interface Repair {
  scope?: string;
  result: ErrorRepairResult;
  coordinator?: UiCoordinator;
  chat?: ReturnType<typeof workspaceChat>;
  pending?: Promise<ErrorRepairResult>;
}
const repairs = new Map<string, Repair>();

/** Call only for an explicit repair/retry action. Details must already be sanitized.
 * Retention and deduplication last for this process; durable refers to the assignment,
 * not this incident mapping. Missing scope never falls back to the active workspace.
 */
export function startErrorRepair(
  input: ErrorRepairInput,
): Promise<ErrorRepairResult> {
  const key = JSON.stringify([input.scope ?? null, input.id]);
  let repair = repairs.get(key);
  if (!repair) {
    repair = {
      scope: input.scope,
      result: {
        durable: false,
        started: false,
        assignment: t("errorRepair.assignment", {
          evidence: JSON.stringify({
            boundary: input.boundary.slice(0, 256),
            code: input.code.slice(0, 256),
            details: input.details.slice(0, 8192),
          }),
        }),
      },
    };
    repairs.set(key, repair);
  }
  if (repair.pending) return repair.pending;
  if (repair.result.started) return Promise.resolve({ ...repair.result });
  const owner = repair;
  owner.pending = attempt(owner).finally(() => {
    owner.pending = undefined;
  });
  return owner.pending;
}

async function attempt(repair: Repair): Promise<ErrorRepairResult> {
  const result = repair.result;
  const block = (key: MessageKey) => ({ ...result, blocked: key });
  const scope = repair.scope;
  if (!scope) return block("errorRepair.workspaceRequired");
  const coordinator = workspaceCoordinator(scope);
  if (
    !coordinator ||
    (repair.coordinator && repair.coordinator !== coordinator)
  )
    return block("errorRepair.workspaceRequired");
  repair.coordinator = coordinator;
  const session = workspaceLayout(scope);
  let ticket: NavigationTicket = session.capture();
  const current = () =>
    workspaceCoordinator(scope) === coordinator && session.current(ticket);
  let failure: MessageKey = "errorRepair.startFailed";
  try {
    const available = await snapshot();
    if (
      !available.ready ||
      available.current?.id !== scope ||
      !available.open.some((item) => item.id === scope) ||
      available.failures.some((item) => item.location.id === scope)
    )
      return block("errorRepair.workspaceRequired");
    if (workspaceCoordinator(scope) !== coordinator)
      return block("errorRepair.workspaceChanged");
    const wasLoaded = !!session.state.document;
    await session.load();
    if (!wasLoaded) ticket = session.capture();
    if (!current() || session.state.error)
      return block("errorRepair.workspaceChanged");
    if (!repair.chat) {
      const id = await workspaceConversations(scope).createDevelopment();
      if (!id) return block("ai.aiAccessOrConversationHistoryCouldNotBeRead");
      result.conversationId = id;
      repair.chat = workspaceChat(scope, id);
      repair.chat.state.draft = result.assignment;
      await repair.chat.renameTitle(t("errorRepair.title"));
    }
    const chat = repair.chat;
    if (!current()) return block("errorRepair.workspaceChanged");
    await chat.refresh();
    if (!current()) return block("errorRepair.workspaceChanged");
    if (!result.durable) {
      failure = "ai.theConversationCouldNotBeSavedKeepThisWorkspace";
      await chat.persistPreparedAssignment(current);
      result.durable = !chat.state.ephemeral && !chat.state.unsaved;
      failure = "errorRepair.startFailed";
    }
    if (!current()) return block("errorRepair.workspaceChanged");
    const status = chat.state.status;
    if (!status) return block("ai.aiAccessOrConversationHistoryCouldNotBeRead");
    if (!status.available || !status.selectedModel || status.modelError)
      return block("errorRepair.modelRequired");
    const settings = workspaceAiSettings(scope, status.config?.connectionId);
    await settings.refresh();
    if (!current()) return block("errorRepair.workspaceChanged");
    if (settings.state.error || settings.state.loading || settings.state.saving)
      return block("ai.modelChoicesCouldNotBeRead");
    const latest = await snapshot();
    if (
      !current() ||
      latest.current?.id !== scope ||
      !latest.ready ||
      !latest.open.some((item) => item.id === scope) ||
      latest.failures.some((item) => item.location.id === scope)
    )
      return block("errorRepair.workspaceChanged");
    const opened = await coordinator.open(
      { kind: "conversation", conversationId: result.conversationId! },
      ticket,
    );
    const tab =
      session.state.document && selectedTab(session.state.document.layout);
    const pane = tab?.panes.find((item) => item.id === tab.activePaneId);
    const target = pane && currentEntry(pane.navigation).target;
    if (
      (!opened && !current()) ||
      workspaceCoordinator(scope) !== coordinator ||
      target?.kind !== "conversation" ||
      target.conversationId !== result.conversationId
    )
      return block("errorRepair.workspaceChanged");
    ticket = session.capture();
    result.started = await chat.submitPreparedAssignment(current);
    if (!result.started)
      return block(
        chat.state.unsaved
          ? "ai.theConversationCouldNotBeSavedKeepThisWorkspace"
          : "errorRepair.submissionBlocked",
      );
    return { ...result };
  } catch {
    if (!current()) return block("errorRepair.workspaceChanged");
    return block(failure);
  }
}
