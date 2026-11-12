import {
  accentStyle as workspaceAccentStyle,
  type Accent as WorkspaceAccent,
} from "../settings/accents";
export { accents } from "../settings/accents";

export const entryCopy = {
  eyebrow: "Your own way of working",
  colorHelp: "Choose an accent for this workspace. You can change it later.",
  defaultName: "My workspace",
};
export type Accent = WorkspaceAccent;
export const accentStyle = (accent: Accent) => ({
  ...workspaceAccentStyle(accent),
  "--workspace-accent": `var(--situate-${accent === "violet" ? "violet-deep" : accent})`,
  "--workspace-on-accent": `var(--situate-${["violet", "cobalt"].includes(accent) ? "surface" : "ink"})`,
});
export type WelcomeStudy = "original" | "opus" | "astra";
export interface FirstEntryState {
  welcomeStudy: WelcomeStudy;
  welcomeTime: number | null;
  welcomeRun: number;
  openingAvailable: boolean;
  openingTime: number | null;
  openingRun: number;
  transitionAvailable: boolean;
  transitionTime: number | null;
  transitionRun: number;
  step: "intro" | "create" | "ai" | "working" | "paused";
  resume: "ai" | "working";
  modelId: string;
  check: "idle" | "pending" | "failed" | "verified";
  attempt: number;
  accent: Accent;
  parent: string;
  paused: boolean;
  created: boolean;
}
export function createFirstEntry(scenario: string): FirstEntryState {
  const study = scenario.replace("first-entry-", "");
  return {
    welcomeStudy: study === "opus" ? "opus" : "astra",
    welcomeTime: null,
    welcomeRun: 0,
    openingAvailable: false,
    openingTime: null,
    openingRun: 0,
    transitionAvailable: false,
    transitionTime: null,
    transitionRun: 0,
    step: scenario === "first-entry-create" ? "create" : "intro",
    resume: "ai",
    modelId: "",
    check: "idle",
    attempt: 0,
    accent: "violet",
    parent: "/Example/Workspaces",
    paused: false,
    created: false,
  };
}
export type FirstEntryAction =
  | { type: "welcome-time"; timeMs: number }
  | { type: "welcome-replay" }
  | { type: "opening-time"; timeMs: number }
  | { type: "opening-replay" }
  | { type: "transition-time"; timeMs: number }
  | { type: "transition-replay" }
  | { type: "pause-setup" }
  | { type: "resume-setup" }
  | { type: "model"; id: string }
  | { type: "check-model" }
  | { type: "model-result"; ok: boolean; attempt: number }
  | { type: "step"; step: FirstEntryState["step"] }
  | { type: "accent"; accent: Accent }
  | { type: "parent"; parent: string }
  | { type: "pause" };
export function reduceFirstEntry(
  previous: FirstEntryState,
  action: FirstEntryAction,
): FirstEntryState {
  const state = { ...previous };
  switch (action.type) {
    case "welcome-time":
      if (state.step === "intro" && Number.isFinite(action.timeMs))
        state.welcomeTime = Math.max(0, action.timeMs);
      break;
    case "welcome-replay":
      if (state.step === "intro") {
        state.welcomeTime = null;
        state.welcomeRun++;
        state.paused = false;
      }
      break;
    case "opening-time":
      if (
        state.openingAvailable &&
        state.step === "create" &&
        Number.isFinite(action.timeMs)
      )
        state.openingTime = Math.max(0, action.timeMs);
      break;
    case "opening-replay":
      if (state.openingAvailable && state.step === "create") {
        state.openingTime = null;
        state.openingRun++;
      }
      break;
    case "transition-time":
      if (
        state.transitionAvailable &&
        state.step === "ai" &&
        Number.isFinite(action.timeMs)
      )
        state.transitionTime = Math.max(0, action.timeMs);
      break;
    case "transition-replay":
      if (state.transitionAvailable && state.step === "ai") {
        state.transitionTime = null;
        state.transitionRun = (state.transitionRun ?? 0) + 1;
      }
      break;
    case "pause-setup":
      if (state.step !== "ai" && state.step !== "working") break;
      state.transitionAvailable = false;
      state.transitionTime = null;
      state.resume = state.step;
      state.step = "paused";
      state.attempt++;
      if (state.check === "pending") state.check = "idle";
      break;
    case "resume-setup":
      if (state.step === "paused") state.step = state.resume;
      break;
    case "model":
      if (state.step !== "ai" || state.check === "pending") break;
      state.modelId = action.id;
      state.check = "idle";
      break;
    case "check-model":
      if (
        state.step !== "ai" ||
        !state.modelId.trim() ||
        state.check === "pending"
      )
        break;
      state.check = "pending";
      state.attempt++;
      break;
    case "model-result":
      if (
        state.step !== "ai" ||
        state.check !== "pending" ||
        action.attempt !== state.attempt
      )
        break;
      state.check = action.ok ? "verified" : "failed";
      if (action.ok) state.step = "working";
      break;
    case "step":
      if (state.created) break;
      state.openingAvailable =
        state.step === "intro" && action.step === "create";
      state.openingTime = null;
      state.step = action.step;
      break;
    case "accent":
      state.accent = action.accent;
      break;
    case "parent":
      state.parent = action.parent;
      break;
    case "pause":
      state.paused = !state.paused;
      break;
  }
  return state;
}
