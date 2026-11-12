import type { ChatState, Event, Phase } from "./model";
import { cloneAiState, currentWorkspace } from "../ai/model";
import { workClockTime } from "./work-clock";
import en from "../localization/en.work-time.json" with { type: "json" };
import de from "../localization/de.work-time.json" with { type: "json" };

export interface WorkDuration {
  milliseconds: number;
  outcome: "complete" | "cancelled" | "error";
}
export const workTimeCopy = { en, de };
export function workDurationText(value: WorkDuration, locale: "en" | "de") {
  const c = workTimeCopy[locale];
  if (!Number.isFinite(value.milliseconds) || value.milliseconds < 0) return "";
  const seconds = Math.floor(value.milliseconds / 1000);
  const duration =
    seconds < 1
      ? c.lessThanSecond
      : seconds < 60
        ? c.seconds.replace("{seconds}", String(seconds))
        : c.minutesSeconds
            .replace("{minutes}", String(Math.floor(seconds / 60)))
            .replace("{seconds}", String(seconds % 60));
  return (value.outcome === "complete" ? c.worked : c[value.outcome]).replace(
    "{duration}",
    duration,
  );
}
export function workTimeFixture(scenario: string): Event[] | null {
  if (!scenario.startsWith("chat-work-time")) return null;
  const base: Event[] = [
    {
      kind: "message",
      id: "time-request",
      speaker: "user",
      text: "Create a short reading list from my book notes.",
    },
    {
      kind: "message",
      id: "time-progress",
      speaker: "assistant",
      purpose: "progress",
      text: "I found five books in your notes. I’ll put together a short selection.",
    },
    {
      kind: "call",
      id: "time-read",
      tool: "read",
      args: { path: "Book shortlist.md" },
      category: "read",
      state: "complete",
      label: "Read the book notes",
      input: "path: Book shortlist.md",
      result: "Five books found.",
      visible: false,
    },
    {
      kind: "message",
      id: "time-followup",
      speaker: "user",
      text: "Only include novels, please.",
    },
  ];
  if (scenario.endsWith("working")) return base;
  return [
    ...base,
    {
      kind: "message",
      id: "time-result",
      speaker: "assistant",
      text: "Your reading list is ready. It includes three novels from your notes.",
      workDuration: { milliseconds: 84000, outcome: "complete" },
    },
  ];
}
export function advanceWorkTime(
  state: ChatState,
  milliseconds = 15000,
): ChatState {
  return state.workTimeMs === undefined || state.phase !== "working"
    ? state
    : { ...state, workTimeMs: state.workTimeMs + milliseconds };
}
export function finishWorkTime(
  state: ChatState,
  phase: Exclude<Phase, "working">,
  waiting = false,
): ChatState {
  if (state.workTimeMs === undefined || state.phase !== "working") return state;
  const c = workTimeCopy[state.composerLocale ?? "en"];
  const ai = cloneAiState(state.ai);
  currentWorkspace(ai).response = "idle";
  return {
    ...state,
    ai,
    phase,
    run: null,
    workTimeMs: 0,
    workClockStartedAt: undefined,
    transcript: [
      ...(state.transcript ?? []),
      {
        kind: "message",
        id: `time-result-${state.transcript?.length ?? 0}`,
        speaker: "assistant",
        text: phase !== "complete" ? "" : waiting ? c.question : c.result,
        workDuration: { milliseconds: workClockTime(state), outcome: phase },
      },
    ],
  };
}
export function sendWorkTimeMessage(state: ChatState): ChatState {
  if (!state.draft.trim()) return state;
  const c = workTimeCopy[state.composerLocale ?? "en"];
  return {
    ...state,
    phase: "working",
    empty: false,
    draft: "",
    workTimeMs: state.phase === "working" ? state.workTimeMs : 0,
    workClockStartedAt:
      state.phase === "working" ? state.workClockStartedAt : undefined,
    transcript: [
      ...(state.transcript ?? []),
      {
        kind: "message",
        id: `time-user-${state.transcript?.length ?? 0}`,
        speaker: "user",
        text: state.draft.trim(),
      },
      {
        kind: "message",
        id: `time-progress-${state.transcript?.length ?? 0}`,
        speaker: "assistant",
        purpose: "progress",
        text: c.progress,
      },
    ],
  };
}
