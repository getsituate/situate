import c from "../localization/en.auth-callback.json" with { type: "json" };
import { handoffDuration } from "./score";

export type CallbackStatus = keyof typeof c.states;
export interface CallbackState {
  status: CallbackStatus;
  helpOpen: boolean;
  replay: number;
  paused: boolean;
  timeMs: number | null;
  still: boolean;
}
export type CallbackAction =
  | { type: "status"; status: CallbackStatus }
  | { type: "help"; open: boolean }
  | { type: "replay" }
  | { type: "pause" }
  | { type: "seek"; timeMs: number }
  | { type: "still"; value: boolean };

export const callbackScenarios = (
  Object.keys(c.states) as CallbackStatus[]
).map((status) => ({
  id: `auth-callback-${status}` as `auth-callback-${CallbackStatus}`,
  label: c.states[status],
  group: "Interface" as const,
}));
export function createCallbackState(scenario = ""): CallbackState {
  return {
    status: scenario === "auth-callback-rejected" ? "rejected" : "received",
    helpOpen: false,
    replay: 0,
    paused: false,
    timeMs: null,
    still: false,
  };
}
export function reduceCallback(state: CallbackState, action: CallbackAction) {
  switch (action.type) {
    case "status":
      Object.assign(
        state,
        createCallbackState(`auth-callback-${action.status}`),
        {
          replay: state.replay + 1,
        },
      );
      break;
    case "help":
      state.helpOpen = action.open;
      break;
    case "replay":
      state.replay++;
      state.timeMs = null;
      state.paused = false;
      break;
    case "pause":
      state.paused = !state.paused;
      break;
    case "seek":
      state.timeMs = Number.isFinite(action.timeMs)
        ? Math.max(0, Math.min(handoffDuration, action.timeMs))
        : handoffDuration;
      state.paused = true;
      break;
    case "still":
      state.still = action.value;
      break;
  }
}
