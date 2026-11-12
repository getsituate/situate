export type QueueKind = "steering" | "follow-up";
export type QueuePhase = "working" | "compacting" | "stopped" | "complete";
export interface Attachment {
  id: string;
  name: string;
}
export interface QueuedMessage {
  id: number;
  kind: QueueKind;
  text: string;
  attachments: Attachment[];
}
export interface QueueState {
  phase: QueuePhase;
  pending: QueuedMessage[];
  consumed: QueuedMessage[];
  draft: string;
  attachments: Attachment[];
  nextId: number;
  notice: string;
}
export const queueScenarios = [
  {
    id: "chat-queue-mixed",
    label: "Chat · pending steering and follow-up",
    group: "Chat",
  },
  {
    id: "chat-queue-long",
    label: "Chat · long pending messages",
    group: "Chat",
  },
  {
    id: "chat-queue-compacting",
    label: "Chat · compacting with pending messages",
    group: "Chat",
  },
  {
    id: "chat-queue-stopped",
    label: "Chat · stopped with restored draft",
    group: "Chat",
  },
] as const;
export function createQueueState(scenario: string): QueueState {
  const pending: QueuedMessage[] = [
    {
      id: 1,
      kind: "follow-up",
      text: "After this, draft a short invitation.",
      attachments: [{ id: "invitation", name: "Invitation outline.md" }],
    },
    {
      id: 2,
      kind: "steering",
      text: "Keep the discussion to chapters 1–4.",
      attachments: [],
    },
    {
      id: 3,
      kind: "steering",
      text: "Leave ten minutes for questions.",
      attachments: [{ id: "agenda", name: "Agenda notes.md" }],
    },
  ];
  if (scenario.endsWith("long")) {
    pending[1]!.text =
      "Keep the discussion to chapters 1–4.\n\nInclude a quiet opening so everyone has time to find a passage. Do not add another reading assignment. Leave the final question open rather than turning the evening into a checklist.\n\nIf the plan gets too long, shorten the introduction, not the conversation.";
    pending.push({
      id: 4,
      kind: "follow-up",
      text: "Once the plan is ready, make a separate list of supplies: paper, pencils, spare bookmarks and the room key. Keep it separate from the invitation so the invitation stays short.",
      attachments: [],
    });
  }
  const state: QueueState = {
    phase: scenario.endsWith("compacting") ? "compacting" : "working",
    pending,
    consumed: [],
    draft: "Also keep the invitation informal.",
    attachments: [{ id: "draft", name: "Room details.md" }],
    nextId: 5,
    notice: "",
  };
  return scenario.endsWith("stopped")
    ? reduceQueue(state, { type: "phase", phase: "stopped" })
    : state;
}
function restorePending(state: QueueState): void {
  const ordered = [
    ...state.pending.filter((item) => item.kind === "steering"),
    ...state.pending.filter((item) => item.kind === "follow-up"),
  ];
  if (!ordered.length) return;
  state.draft = [...ordered.map((item) => item.text), state.draft]
    .filter((text) => text.length > 0)
    .join("\n\n");
  state.attachments = [
    ...ordered.flatMap((item) => item.attachments),
    ...state.attachments,
  ];
  state.pending = [];
}
export type QueueAction =
  | { type: "draft"; text: string }
  | { type: "remove-attachment"; index: number }
  | { type: "submit"; kind: QueueKind }
  | { type: "restore" }
  | { type: "consume" }
  | { type: "finish" }
  | { type: "phase"; phase: QueuePhase };
export const isRunning = (state: QueueState) =>
  state.phase === "working" || state.phase === "compacting";
export function reduceQueue(
  previous: QueueState,
  action: QueueAction,
): QueueState {
  const state: QueueState = structuredClone(previous);
  const consume = (kind: QueueKind) => {
    const index = state.pending.findIndex((item) => item.kind === kind);
    if (index < 0) return false;
    const [item] = state.pending.splice(index, 1);
    state.consumed.push(item!);
    state.notice = `${kind === "steering" ? "Steering" : "Follow-up"} received by Situate. ${state.pending.length} pending.`;
    return true;
  };
  switch (action.type) {
    case "draft":
      state.draft = action.text;
      break;
    case "remove-attachment": {
      const attachments = state.attachments;
      if (
        !attachments ||
        !Number.isInteger(action.index) ||
        action.index < 0 ||
        action.index >= attachments.length
      )
        break;
      const [removed] = attachments.splice(action.index, 1);
      state.notice = `Attachment removed: ${removed!.name}.`;
      break;
    }
    case "phase":
      state.phase = action.phase;
      if (action.phase === "stopped") restorePending(state);
      state.notice =
        action.phase === "stopped"
          ? "Stopped. Unsent messages are in your draft."
          : action.phase === "compacting"
            ? "Compacting the conversation. Messages can still be queued."
            : action.phase === "working"
              ? "Situate is working."
              : "Task complete.";
      break;
    case "submit": {
      if (!state.draft.trim() && !state.attachments.length) break;
      const item: QueuedMessage = {
        id: state.nextId++,
        kind: action.kind,
        text: state.draft,
        attachments: state.attachments,
      };
      if (isRunning(state)) {
        state.pending.push(item);
        state.notice = `${action.kind === "steering" ? "Steering" : "Follow-up"} queued. ${state.pending.length} pending.`;
      } else {
        state.consumed.push(item);
        state.phase = "working";
        state.notice = "Message sent.";
      }
      state.draft = "";
      state.attachments = [];
      break;
    }
    case "restore": {
      if (!state.pending.length) break;
      restorePending(state);
      state.notice =
        "All pending messages moved to the draft. Nothing was sent.";
      break;
    }
    case "consume":
      if (state.phase === "working") consume("steering");
      break;
    case "finish":
      if (state.phase !== "working") break;
      if (!consume("steering") && !consume("follow-up")) {
        state.phase = "complete";
        state.notice = "Task complete.";
      }
      break;
  }
  return state;
}
