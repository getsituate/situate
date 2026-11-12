import type { ChatState } from "./model";
import { setHistoryExample, type HistoryExample } from "./work-history";
import { finishWorkTime, workTimeFixture } from "./work-time";

export function setConversationExample(
  state: ChatState,
  example: HistoryExample | "followup",
): ChatState {
  if (example !== "followup")
    return setHistoryExample({ ...state, workTimeMs: undefined }, example);
  const working: ChatState = {
    ...state,
    workHistory: undefined,
    workTimeMs: 69000,
    workClockStartedAt: undefined,
    phase: "working",
    draft: "",
    transcript: workTimeFixture("chat-work-time-working"),
  };
  return state.phase === "working"
    ? working
    : finishWorkTime(working, state.phase);
}
