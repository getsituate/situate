import { c, copy } from "./content";

export type Network = "wifi" | "metered" | "ethernet" | "cellular" | "offline";
export type ModelStatus =
  "waiting" | "downloading" | "preparing" | "ready" | "failed" | "storage";
export type Phase = "permission" | "recording" | "transcribing";
export type Notice =
  | ""
  | "denied"
  | "noSpeech"
  | "failed"
  | "interrupted"
  | "inserted"
  | "sent"
  | "queued"
  | "agentStopped";
export type Feedback = {
  owner: string;
  kind:
    "permission" | "denied" | "noSpeech" | "failed" | "interrupted" | "model";
};
export interface Selection {
  start: number;
  end: number;
}
export interface Draft {
  text: string;
  selection: Selection;
  notice: Notice;
  messages: string[];
  working: boolean;
}
export interface DictationState {
  language: "en" | "de";
  model: ModelStatus;
  network: Network;
  progress: number;
  permission: "ask" | "allowed" | "denied";
  connected: boolean;
  speech: "speaking" | "quiet" | "silence";
  motionPaused: boolean;
  session: { owner: string; phase: Phase; id: number } | null;
  feedback: Feedback | null;
  sequence: number;
  result: string;
  drafts: Record<string, Draft>;
  selected: Record<string, "a" | "b">;
  split: boolean;
}
export type DictationAction =
  | { type: "edit"; owner: string; text: string; selection: Selection }
  | { type: "selection"; owner: string; selection: Selection }
  | { type: "mic"; owner: string }
  | { type: "dismiss-feedback"; owner: string }
  | { type: "permission"; value: DictationState["permission"] }
  | { type: "result"; value: string }
  | { type: "speech"; value: DictationState["speech"] }
  | { type: "motion-paused"; value: boolean }
  | { type: "complete"; id: number; outcome: "success" | "noSpeech" | "failed" }
  | { type: "select"; workspace: string; chat: "a" | "b" }
  | { type: "close-pane"; workspace: string; chat: "a" | "b" }
  | { type: "split"; value: boolean }
  | { type: "send" | "stop-agent" | "dismiss"; owner: string }
  | { type: "network"; value: Network }
  | { type: "model"; value: ModelStatus }
  | { type: "progress"; value: number }
  | { type: "retry" | "background" | "interrupt" }
  | { type: "language"; value: "en" | "de" }
  | { type: "connected"; value: boolean }
  | { type: "working"; owner: string; value: boolean };

export const chatPresets = [
  ["dictation-ready", c.states.ready],
  ["dictation-recording", c.states.recording],
  ["dictation-transcribing", c.states.transcribing],
  ["dictation-selection", c.states.selection],
  ["dictation-split", c.states.split],
  ["dictation-permission", c.states.permission],
  ["dictation-denied", c.states.denied],
  ["dictation-silence", c.states.silence],
  ["dictation-failed", c.states.failed],
  ["dictation-interrupted", c.states.interrupted],
  ["dictation-offline", c.states.offline],
  ["dictation-agent", c.states.agent],
  ["dictation-close-files", c.states.closeFiles],
  ["dictation-close-agent", c.states.closeAgent],
] as const;
export const downloadPresets = [
  ["dictation-download-waiting", c.states.waiting],
  ["dictation-download-active", c.states.downloading],
  ["dictation-download-paused", c.states.paused],
  ["dictation-download-preparing", c.states.preparing],
  ["dictation-download-failed", c.states.downloadFailed],
  ["dictation-download-storage", c.states.storage],
  ["dictation-download-ready", c.states.installed],
] as const;
export const dictationScenarios = [
  ...chatPresets.map(([id, label]) => ({ id, label, group: "Chat" as const })),
  ...downloadPresets.map(([id, label]) => ({
    id,
    label,
    group: "Settings" as const,
  })),
];
export function eligible(network: Network): boolean {
  return ["wifi", "metered", "ethernet"].includes(network);
}
export function draftFor(state: DictationState, owner: string): Draft {
  return state.drafts[owner]!;
}
export function titleFor(state: DictationState, owner: string): string {
  return owner.endsWith("/a")
    ? copy(state.language).chatA
    : copy(state.language).chatB;
}
export function ensureWorkspace(
  state: DictationState,
  workspace: string,
): void {
  state.selected[workspace] ??= "a";
  for (const chat of ["a", "b"]) {
    const text = chat === "a" ? c.draftA : c.draftB;
    state.drafts[`${workspace}/${chat}`] ??= {
      text,
      selection: { start: text.length, end: text.length },
      notice: "",
      messages: [],
      working: false,
    };
  }
}
export function createDictation(scenario = "dictation-ready"): DictationState {
  const state: DictationState = {
    language: "en",
    model: "ready",
    network: "wifi",
    progress: 0,
    permission: "allowed",
    connected: true,
    speech: "speaking",
    motionPaused: false,
    session: null,
    feedback: null,
    sequence: 0,
    result: c.transcript,
    drafts: {},
    selected: {},
    split: false,
  };
  for (const workspace of ["sample-1", "sample-2", "sample-3"])
    ensureWorkspace(state, workspace);
  const origin = state.drafts["sample-1/a"]!;
  if (["dictation-recording", "dictation-agent"].includes(scenario))
    state.session = {
      owner: "sample-1/a",
      phase: "recording",
      id: ++state.sequence,
    };
  if (
    [
      "dictation-transcribing",
      "dictation-selection",
      "dictation-split",
      "dictation-close-files",
      "dictation-close-agent",
    ].includes(scenario)
  )
    state.session = {
      owner: "sample-1/a",
      phase: "transcribing",
      id: ++state.sequence,
    };
  if (scenario === "dictation-selection")
    origin.selection = { start: 14, end: 36 };
  if (scenario === "dictation-split") state.split = true;
  if (scenario === "dictation-agent" || scenario === "dictation-close-agent")
    origin.working = true;
  if (scenario === "dictation-permission") {
    state.permission = "ask";
    state.session = {
      owner: "sample-1/a",
      phase: "permission",
      id: ++state.sequence,
    };
  }
  if (scenario === "dictation-denied") {
    state.permission = "denied";
    origin.notice = "denied";
  }
  if (scenario === "dictation-silence") origin.notice = "noSpeech";
  if (scenario === "dictation-failed") origin.notice = "failed";
  if (scenario === "dictation-interrupted") origin.notice = "interrupted";
  if (scenario === "dictation-offline") {
    state.network = "offline";
    state.connected = false;
  }
  if (scenario.startsWith("dictation-download-")) {
    const status: Record<string, ModelStatus> = {
      waiting: "waiting",
      active: "downloading",
      paused: "waiting",
      preparing: "preparing",
      failed: "failed",
      storage: "storage",
      ready: "ready",
    };
    state.model =
      status[scenario.replace("dictation-download-", "")] ?? "ready";
    state.progress = ["waiting", "ready"].includes(
      scenario.replace("dictation-download-", ""),
    )
      ? 0
      : 42;
    if (scenario.endsWith("waiting")) state.network = "offline";
    if (scenario.endsWith("paused")) state.network = "cellular";
  }
  if (state.session?.phase === "permission")
    state.feedback = { owner: "sample-1/a", kind: "permission" };
  if (["denied", "noSpeech", "failed", "interrupted"].includes(origin.notice))
    state.feedback = {
      owner: "sample-1/a",
      kind: origin.notice as Feedback["kind"],
    };
  return state;
}
export function visibleFeedback(
  state: DictationState,
  workspace: string,
  mobile: boolean,
): Feedback | null {
  const feedback = state.feedback;
  const visible = (
    state.split && !mobile ? ["a", "b"] : [state.selected[workspace] ?? "a"]
  ).map((chat) => `${workspace}/${chat}`);
  if (feedback && visible.includes(feedback.owner)) return feedback;
  for (const owner of visible) {
    const notice = state.drafts[owner]?.notice;
    if (
      notice === "denied" ||
      notice === "noSpeech" ||
      notice === "failed" ||
      notice === "interrupted"
    )
      return { owner, kind: notice };
  }
  return null;
}
export function reduceDictation(
  state: DictationState,
  action: DictationAction,
): void {
  const draft = "owner" in action ? state.drafts[action.owner] : undefined;
  switch (action.type) {
    case "edit":
      if (draft) {
        draft.text = action.text;
        draft.selection = action.selection;
        draft.notice = "";
      }
      break;
    case "selection":
      if (draft) draft.selection = action.selection;
      break;
    case "mic":
      if (!draft) break;
      if (state.session) {
        if (
          state.session.owner === action.owner &&
          state.session.phase === "recording"
        )
          state.session.phase = "transcribing";
        break;
      }
      if (state.model !== "ready") {
        state.feedback = { owner: action.owner, kind: "model" };
        break;
      }
      draft.notice = "";
      state.feedback = null;
      if (state.permission === "denied") {
        draft.notice = "denied";
        state.feedback = { owner: action.owner, kind: "denied" };
        break;
      }
      state.session = {
        owner: action.owner,
        phase: state.permission === "ask" ? "permission" : "recording",
        id: ++state.sequence,
      };
      if (state.permission === "ask")
        state.feedback = { owner: action.owner, kind: "permission" };
      break;
    case "dismiss-feedback":
      if (draft) draft.notice = "";
      if (state.feedback?.owner === action.owner) state.feedback = null;
      break;
    case "permission":
      state.permission = action.value;
      if (state.session?.phase === "permission") {
        if (action.value === "allowed") {
          state.session.phase = "recording";
          state.feedback = null;
        }
        if (action.value === "denied") {
          state.drafts[state.session.owner]!.notice = "denied";
          state.feedback = { owner: state.session.owner, kind: "denied" };
          state.session = null;
        }
      }
      break;
    case "complete": {
      const session = state.session;
      if (session?.phase !== "transcribing" || session.id !== action.id) break;
      const target = state.drafts[session.owner]!;
      if (action.outcome === "success" && state.result.trim()) {
        const start = Math.min(target.text.length, target.selection.start);
        const end = Math.min(
          target.text.length,
          Math.max(start, target.selection.end),
        );
        target.text =
          target.text.slice(0, start) + state.result + target.text.slice(end);
        target.selection = {
          start: start + state.result.length,
          end: start + state.result.length,
        };
        target.notice = "inserted";
      } else {
        target.notice = action.outcome === "failed" ? "failed" : "noSpeech";
        state.feedback = { owner: session.owner, kind: target.notice };
      }
      state.session = null;
      break;
    }
    case "send":
      if (
        draft?.text.trim() &&
        state.connected &&
        state.network !== "offline" &&
        state.session?.owner !== action.owner
      ) {
        draft.messages.push(draft.text);
        draft.text = "";
        draft.selection = { start: 0, end: 0 };
        draft.notice = draft.working ? "queued" : "sent";
      }
      break;
    case "stop-agent":
      if (draft) {
        draft.working = false;
        draft.notice = "agentStopped";
      }
      break;
    case "dismiss":
      if (draft) draft.notice = "";
      break;
    case "select":
      state.selected[action.workspace] = action.chat;
      break;
    case "close-pane":
      state.split = false;
      state.selected[action.workspace] = action.chat === "a" ? "b" : "a";
      break;
    case "split":
      state.split = action.value;
      break;
    case "network":
      state.network = action.value;
      if (state.model === "downloading" && !eligible(action.value))
        state.model = "waiting";
      else if (state.model === "waiting" && eligible(action.value))
        state.model = "downloading";
      break;
    case "retry":
      if (["failed", "storage", "waiting"].includes(state.model))
        state.model = eligible(state.network) ? "downloading" : "waiting";
      break;
    case "model":
      if (action.value === "preparing" && state.model !== "downloading") break;
      if (action.value === "ready" && state.model !== "preparing") break;
      if (state.session) break;
      state.model = action.value;
      if (["preparing", "ready"].includes(action.value)) state.progress = 100;
      if (action.value === "ready" && state.feedback?.kind === "model")
        state.feedback = null;
      break;
    case "progress":
      if (state.model === "downloading")
        state.progress = Math.max(0, Math.min(100, action.value));
      break;
    case "background":
    case "interrupt":
      if (
        state.session &&
        (action.type === "interrupt" || state.session.phase !== "transcribing")
      ) {
        state.drafts[state.session.owner]!.notice = "interrupted";
        state.feedback = { owner: state.session.owner, kind: "interrupted" };
        state.session = null;
      }
      break;
    case "language":
      state.language = action.value;
      break;
    case "connected":
      state.connected = action.value;
      break;
    case "result":
      state.result = action.value;
      break;
    case "speech":
      state.speech = action.value;
      break;
    case "motion-paused":
      state.motionPaused = action.value;
      break;
    case "working":
      if (draft) draft.working = action.value;
      break;
  }
}
export function modelLabel(state: DictationState): string {
  const text = copy(state.language);
  return {
    waiting: text.waiting,
    downloading: text.downloading,
    preparing: text.preparing,
    ready: text.ready,
    failed: text.downloadFailed,
    storage: text.storageFailed,
  }[state.model];
}
