import { workTimeFixture, type WorkDuration } from "./work-time";
import { workClockTime } from "./work-clock";
import {
  historyExample,
  historyTransition,
  type WorkHistoryState,
} from "./work-history";
import { questionExample, questionTitle } from "./question-examples";
import type { QuestionEvent } from "./question";
import { nextGreeting } from "../navigation/greetings";
import type { Variant } from "../mini-bend-playful/gestures";
import {
  chatGuard,
  choiceGuard,
  cloneAiState,
  createAiState,
  currentWorkspace,
  resolvedModelId,
  type AiState,
} from "../ai/model";

import {
  systemMessageFixture,
  type SystemMessageLocale,
} from "./system-message";

export type Phase = "complete" | "working" | "error" | "cancelled";
import {
  selectedThinking,
  validThinkingSelection,
  thinkingKey,
  type ThinkingSelection,
  type ThinkingChoices,
  type ThinkingLevel,
} from "./thinking";
export interface ChatRun {
  connection: string | null;
  model: string | null;
  thinking: ThinkingLevel | null;
}
export interface ChatState {
  transcriptStyle?: "history";
  questionVariant?: string;
  workHistory?: WorkHistoryState;
  workTimeMs?: number;
  workClockStartedAt?: number;
  composerLocale?: "en" | "de";
  title?: string;
  phase: Phase;
  transcript: Event[] | null;
  systemMessageLocale: SystemMessageLocale;
  systemAnnouncement: string;
  draft: string;
  empty: boolean;
  greeting: string;
  motion: Variant;
  ai: AiState;
  thinking: ThinkingChoices;
  run: ChatRun | null;
}
export function chooseThinking(
  state: ChatState,
  level: ThinkingSelection,
): ChatState {
  if (choiceGuard(state.ai) || !validThinkingSelection(state.ai, level))
    return state;
  const workspace = state.ai.workspace;
  const choices = { ...state.thinking[workspace] };
  if (level === null) delete choices[thinkingKey(state.ai)];
  else choices[thinkingKey(state.ai)] = level;
  return {
    ...state,
    thinking: {
      ...state.thinking,
      [workspace]: choices,
    },
  };
}
export function mainChatRequest(state: ChatState): ChatRun {
  return state.phase === "working" && state.run
    ? state.run
    : {
        connection:
          currentWorkspace(state.ai).connection?.id ??
          currentWorkspace(state.ai).connection?.provider ??
          null,
        model: resolvedModelId(state.ai),
        thinking: selectedThinking(state.ai, state.thinking),
      };
}
export function changePhase(state: ChatState, phase: Phase): ChatState {
  if (phase === "working" && (state.phase === "working" || chatGuard(state.ai)))
    return state;
  const ai = cloneAiState(state.ai);
  currentWorkspace(ai).response = phase === "working" ? "streaming" : "idle";
  return {
    ...state,
    ai,
    phase,
    workClockStartedAt: undefined,
    ...(state.workHistory
      ? {
          transcript: historyTransition(state, phase),
          workHistory: {
            ...state.workHistory,
            milliseconds:
              state.phase === "working"
                ? workClockTime(state)
                : state.workHistory.milliseconds,
          },
        }
      : {}),
    run: phase === "working" ? mainChatRequest(state) : null,
  };
}
export function commentRequest(state: ChatState) {
  if (state.phase !== "working") return null;
  return { context: "Checking the reading-evening plan." };
}
export function simulatedComment(
  request: NonNullable<ReturnType<typeof commentRequest>>,
  index: number,
): string {
  if (!request.context) return "Still working.";
  return [
    "A little room for a good conversation.",
    "Checking the last few details.",
  ][index % 2];
}
export interface Message {
  kind: "message";
  id: string;
  speaker: "user" | "assistant";
  text: string;
  answer?: boolean;
  purpose?: "progress";
  workDuration?: WorkDuration;
  files?: { path: string; label?: string }[];
}
export interface ReasoningEvent {
  kind: "reasoning";
  id: string;
  text: string;
  status: Phase;
}
export interface Call {
  kind: "call";
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  category?: "read" | "search" | "other";
  pluginName?: string;
  state?: Phase;
  label: string;
  input: string;
  result: string;
  visible: boolean;
  file?: string;
  before?: string;
  after?: string;
  contentNotice?: string;
}
export interface SystemMessage {
  kind: "system";
  id: string;
  pluginName: string;
}
export type Event =
  Message | Call | SystemMessage | QuestionEvent | ReasoningEvent;
export type Block = Event | { kind: "activity"; id: string; calls: Call[] };
export function groupEvents(events: Event[]): Block[] {
  const blocks: Block[] = [];
  for (const event of events) {
    if (event.kind === "call" && !event.visible) {
      const previous = blocks.at(-1);
      if (previous?.kind === "activity") previous.calls.push(event);
      else blocks.push({ kind: "activity", id: event.id, calls: [event] });
    } else blocks.push(event);
  }
  return blocks;
}
export function createChatState(scenario: string): ChatState {
  const ai = createAiState(
    scenario.startsWith("ai-chat-") ? scenario.slice(3) : "chat-new",
  );
  currentWorkspace(ai).draft = "";
  currentWorkspace(ai).history = [];
  return changePhase(
    {
      phase: "complete",
      ...(scenario.startsWith("chat-work-history") ||
      scenario.startsWith("ai-chat")
        ? {
            workHistory: {
              example: historyExample(scenario),
              milliseconds: 103000,
            },
            title: "A plan for Thursday",
          }
        : {}),
      ...(scenario.startsWith("chat-work-time")
        ? { workTimeMs: scenario.endsWith("working") ? 69000 : 0 }
        : {}),
      transcript:
        scenario === "chat-plugin-available"
          ? systemMessageFixture("en")
          : (workTimeFixture(scenario) ?? questionExample(scenario)),
      ...(scenario.startsWith("chat-question")
        ? { title: questionTitle, questionVariant: scenario }
        : {}),
      systemMessageLocale: "en",
      systemAnnouncement: "",
      draft: "",
      empty: scenario.endsWith("empty"),
      greeting: scenario.endsWith("empty") ? nextGreeting("conversation") : "",
      motion: "mixed",
      ai,
      thinking: { Personal: {}, Studio: {} },
      run: null,
    },
    scenario.startsWith("ai-chat")
      ? "complete"
      : scenario.endsWith("working")
        ? "working"
        : scenario.endsWith("error")
          ? "error"
          : scenario.endsWith("cancelled")
            ? "cancelled"
            : "complete",
  );
}
const call = (
  id: string,
  tool: string,
  label: string,
  input: string,
  result: string,
  args: Record<string, unknown>,
  pluginName?: string,
): Call => ({
  kind: "call",
  id,
  tool,
  label,
  input,
  result,
  args,
  pluginName,
  category: tool === "read" ? "read" : tool === "search" ? "search" : "other",
  visible: false,
});
export const events: Event[] = [
  {
    kind: "message",
    id: "request",
    speaker: "user",
    text: "Make a short plan for our reading evening. Use the notes from last time, and move the start to 7 pm.",
  },
  call(
    "search",
    "search",
    "Found the reading-group notes",
    "query: reading group",
    "2 notes found: Reading evenings.md, Book shortlist.md",
    { query: "reading group" },
  ),
  call(
    "read",
    "read",
    "Read the previous plan",
    "path: Reading evenings.md",
    "Meet at 18:30. Bring a favourite passage. Leave time for conversation.",
    { path: "Reading evenings.md" },
  ),
  {
    kind: "message",
    id: "context",
    speaker: "assistant",
    purpose: "progress",
    text: "Last time, the open conversation worked well. I’ll keep the plan light and leave room for it.",
  },
  call(
    "book",
    "books.search",
    "Checked the selected book",
    "collection: Book shortlist\nselection: next meeting",
    "The Lantern Orchard — chapters 1–4",
    { collection: "Book shortlist", selection: "next meeting" },
    "Book shelf",
  ),
  {
    kind: "call",
    id: "write",
    tool: "write",
    label: "Created",
    visible: true,
    file: "Reading evening.md",
    input: "path: Reading evening.md",
    result: "File created.",
    after:
      "# Reading evening\n\nThursday · Library room\n\n18:30 — Arrive and settle in.\n18:45 — Share a favourite passage from chapters 1–4.\n19:15 — Open conversation.\n\nBring the book and one question you would like to explore.",
  },
  call(
    "check",
    "read",
    "Checked the meeting time",
    "path: Reading evening.md",
    "Current start: 18:30",
    { path: "Reading evening.md" },
  ),
  {
    kind: "call",
    id: "edit",
    tool: "edit",
    label: "Updated",
    visible: true,
    file: "Reading evening.md",
    input: "path: Reading evening.md",
    result: "Meeting times updated.",
    before:
      "18:30 — Arrive and settle in.\n18:45 — Share a favourite passage from chapters 1–4.\n19:15 — Open conversation.",
    after:
      "19:00 — Arrive and settle in.\n19:15 — Share a favourite passage from chapters 1–4.\n19:45 — Open conversation.",
  },
  call(
    "verify",
    "read",
    "Verified the updated plan",
    "path: Reading evening.md",
    "Start: 19:00. All three times updated.",
    { path: "Reading evening.md" },
  ),
  {
    kind: "message",
    id: "answer",
    speaker: "assistant",
    text: "The plan is ready, with a 7 pm start. I moved the other times along with it. There’s still plenty of room to disagree about the book.",
  },
];
