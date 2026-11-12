import type { ChatState } from "./model";

export function elapsedWorkTime(
  milliseconds: number,
  startedAt: number | undefined,
  now = Date.now(),
): number {
  return (
    milliseconds + (startedAt === undefined ? 0 : Math.max(0, now - startedAt))
  );
}
export function workClockTime(state: ChatState, now = Date.now()): number {
  const base = state.workHistory?.milliseconds ?? state.workTimeMs ?? NaN;
  return elapsedWorkTime(
    base,
    state.phase === "working" ? state.workClockStartedAt : undefined,
    now,
  );
}
export function startWorkClock(state: ChatState, now = Date.now()): ChatState {
  if (
    state.phase !== "working" ||
    state.workClockStartedAt !== undefined ||
    !Number.isFinite(workClockTime(state, now))
  )
    return state;
  return { ...state, workClockStartedAt: now };
}
export function workClockText(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return minutes < 60
    ? `${minutes}:${rest}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${rest}`;
}
