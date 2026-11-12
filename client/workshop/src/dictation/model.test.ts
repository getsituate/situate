import { describe, expect, it } from "vitest";
import {
  createSimulation,
  reduceSimulation,
  type Command,
  type Scenario,
} from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";
import { scenarioForState } from "../workshop/scenario-catalog";
import {
  chatPresets,
  downloadPresets,
  visibleFeedback,
  type DictationAction,
} from "./model";
import en from "../localization/en.dictation.json";
import de from "../localization/de.dictation.json";

function flow(scenario: Scenario = "dictation-ready") {
  let state = createSimulation(scenario);
  return {
    get state() {
      return state;
    },
    command(command: Command) {
      state = reduceSimulation(state, command);
    },
    act(action: DictationAction) {
      state = reduceSimulation(state, { type: "dictation", action });
    },
  };
}
const owner = "sample-1/a";
describe("dictation", () => {
  it("pauses feedback without pausing dictation and resets the motion control", () => {
    const f = flow("dictation-recording");
    const original = structuredClone(f.state.dictation);
    f.act({ type: "motion-paused", value: true });
    expect(f.state.dictation.session).toEqual(original.session);
    expect(f.state.dictation.drafts).toEqual(original.drafts);
    f.act({ type: "mic", owner });
    expect(f.state.dictation.session?.phase).toBe("transcribing");
    f.act({ type: "complete", id: original.session!.id, outcome: "success" });
    expect(f.state.dictation.session).toBeNull();
    expect(f.state.dictation.drafts[owner]!.text).toContain(original.result);
    f.command({ type: "reset" });
    expect(f.state.dictation.motionPaused).toBe(false);
  });

  it("groups every fixture under two workflows with complete translated keys", () => {
    for (const [id] of chatPresets)
      expect(scenarioForState(id).id).toBe("dictation-ready");
    for (const [id] of downloadPresets)
      expect(scenarioForState(id).id).toBe("dictation-download-waiting");
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    expect(Object.keys(en.controls).sort()).toEqual(
      Object.keys(de.controls).sort(),
    );
  });
  it("changes simulated speech independently of the session and draft, and resets it with the starting state", () => {
    const f = flow("dictation-recording");
    const session = { ...f.state.dictation.session! };
    const draft = { ...f.state.dictation.drafts[owner]! };
    for (const value of ["quiet", "silence", "speaking"] as const) {
      f.act({ type: "speech", value });
      expect(f.state.dictation.speech).toBe(value);
      expect(f.state.dictation.session).toEqual(session);
      expect(f.state.dictation.drafts[owner]).toEqual(draft);
    }
    f.act({ type: "speech", value: "silence" });
    f.command({ type: "reset" });
    expect(f.state.dictation.speech).toBe("speaking");
  });
  it("dismisses permission guidance without granting access or changing the pending session", () => {
    const f = flow("dictation-permission");
    expect(screenControls(f.state).dictationNotice).toBe(true);
    expect(f.state.dictation.feedback).toEqual({ owner, kind: "permission" });
    f.act({ type: "dismiss-feedback", owner });
    expect(screenControls(f.state).dictationNotice).toBe(false);
    expect(f.state.dictation.session?.phase).toBe("permission");
    expect(f.state.dictation.permission).toBe("ask");
    f.act({ type: "permission", value: "denied" });
    expect(f.state.dictation.feedback).toEqual({ owner, kind: "denied" });
    expect(screenControls(f.state).dictationNotice).toBe(true);
    f.act({ type: "dismiss-feedback", owner });
    expect(f.state.dictation.drafts[owner]!.notice).toBe("");
    expect(f.state.dictation.permission).toBe("denied");
  });
  it("keeps hidden-chat failures until their own notice is dismissed", () => {
    const f = flow("dictation-transcribing");
    f.act({ type: "select", workspace: "sample-1", chat: "b" });
    f.act({ type: "complete", id: 1, outcome: "failed" });
    expect(screenControls(f.state).dictationNotice).toBe(false);
    f.act({ type: "mic", owner: "sample-1/b" });
    f.act({ type: "mic", owner: "sample-1/b" });
    f.act({ type: "complete", id: 2, outcome: "noSpeech" });
    f.act({ type: "dismiss-feedback", owner: "sample-1/b" });
    expect(visibleFeedback(f.state.dictation, "sample-1", false)).toBeNull();
    f.act({ type: "select", workspace: "sample-1", chat: "a" });
    expect(visibleFeedback(f.state.dictation, "sample-1", false)).toEqual({
      owner,
      kind: "failed",
    });
    f.act({ type: "dismiss-feedback", owner });
    expect(visibleFeedback(f.state.dictation, "sample-1", false)).toBeNull();
  });
  it("offers model information without recording and clears it when the model becomes ready", () => {
    const f = flow("dictation-download-active");
    f.act({ type: "mic", owner });
    expect(f.state.dictation.feedback).toEqual({ owner, kind: "model" });
    expect(f.state.dictation.session).toBeNull();
    f.act({ type: "model", value: "preparing" });
    f.act({ type: "model", value: "ready" });
    expect(f.state.dictation.feedback).toBeNull();
  });
  it("records, blocks every origin send, and inserts only at the latest selection", () => {
    const f = flow();
    f.act({ type: "mic", owner });
    f.act({ type: "mic", owner: "sample-2/a" });
    expect(f.state.dictation.session).toMatchObject({
      owner,
      phase: "recording",
    });
    f.act({ type: "send", owner });
    expect(f.state.dictation.drafts[owner]!.messages).toEqual([]);
    f.act({ type: "mic", owner });
    f.act({
      type: "edit",
      owner,
      text: "Before OLD after",
      selection: { start: 7, end: 10 },
    });
    f.act({ type: "result", value: "new words" });
    f.act({ type: "complete", id: 1, outcome: "success" });
    expect(f.state.dictation.drafts[owner]).toMatchObject({
      text: "Before new words after",
      messages: [],
      selection: { start: 16, end: 16 },
    });
    f.act({ type: "send", owner });
    expect(f.state.dictation.drafts[owner]!.messages).toEqual([
      "Before new words after",
    ]);
  });
  it("keeps transcription with its origin across chat/workspace switches and allows unrelated typed sends", () => {
    const f = flow("dictation-transcribing");
    f.act({ type: "select", workspace: "sample-1", chat: "b" });
    f.act({ type: "send", owner: "sample-1/b" });
    expect(f.state.dictation.drafts["sample-1/b"]!.messages).toHaveLength(1);
    f.command({
      type: "action",
      operation: { action: "open", id: "sample-2", request: "switch" },
    });
    expect(f.state.dictationNavigation).toBeNull();
    f.command({
      type: "action",
      operation: { action: "open", id: "sample-1", request: "switch" },
    });
    f.act({ type: "select", workspace: "sample-1", chat: "a" });
    f.act({ type: "edit", owner, text: "AB", selection: { start: 1, end: 1 } });
    f.act({ type: "result", value: "X" });
    f.act({ type: "complete", id: 1, outcome: "success" });
    expect(f.state.dictation.drafts[owner]!.text).toBe("AXB");
    expect(f.state.snapshot.current?.id).toBe("sample-1");
  });
  it.each(["noSpeech", "failed"] as const)(
    "preserves current draft and selection on %s",
    (outcome) => {
      const f = flow("dictation-transcribing");
      f.act({
        type: "edit",
        owner,
        text: "Keep this",
        selection: { start: 0, end: 4 },
      });
      f.act({ type: "complete", id: 1, outcome });
      expect(f.state.dictation.drafts[owner]).toMatchObject({
        text: "Keep this",
        selection: { start: 0, end: 4 },
        notice: outcome,
      });
      expect(f.state.dictation.session).toBeNull();
    },
  );
  it("preserves recording on cancelled navigation and discards on confirmation", () => {
    const f = flow("dictation-recording");
    f.act({ type: "select", workspace: "sample-1", chat: "b" });
    expect(screenControls(f.state).label).toBe("Discard confirmation");
    expect(f.state.dictation.selected["sample-1"]).toBe("a");
    f.command({ type: "dictation-confirm", discard: false });
    expect(f.state.dictation.session?.phase).toBe("recording");
    f.command({ type: "dictation-settings" });
    f.command({ type: "dictation-confirm", discard: true });
    expect(f.state.feature).toBe("settings");
    expect(f.state.dictation.session).toBeNull();
    expect(screenControls(f.state).controls).toEqual(["dictation"]);
  });
  it.each(["close", "quit"] as const)(
    "waits for the user's %s decision and permits completion while waiting",
    (action) => {
      const f = flow("dictation-transcribing");
      f.command({
        type: "action",
        operation: { action, id: "sample-1", request: "close" },
      });
      expect(f.state.dictationNavigation).not.toBeNull();
      f.act({ type: "complete", id: 1, outcome: "success" });
      expect(f.state.dictation.drafts[owner]!.notice).toBe("inserted");
      f.command({ type: "dictation-confirm", discard: false });
      expect(f.state.completion).toEqual({ request: "close", ok: false });
      expect(f.state.snapshot.current?.id).toBe("sample-1");
    },
  );
  it("discards recording on background, but only interrupts transcription when told it was lost", () => {
    const f = flow("dictation-recording");
    f.act({ type: "background" });
    expect(f.state.dictation.session).toBeNull();
    expect(f.state.dictation.drafts[owner]!.notice).toBe("interrupted");
    f.act({ type: "mic", owner });
    f.act({ type: "mic", owner });
    f.act({ type: "background" });
    expect(f.state.dictation.session?.phase).toBe("transcribing");
    f.act({ type: "interrupt" });
    f.act({ type: "complete", id: 2, outcome: "success" });
    expect(f.state.dictation.drafts[owner]!.notice).toBe("interrupted");
  });
  it("denies permission without changing the draft and grants it only to the pending owner", () => {
    const f = flow("dictation-permission");
    f.act({ type: "mic", owner: "sample-1/b" });
    f.act({ type: "permission", value: "denied" });
    expect(f.state.dictation.drafts[owner]!.notice).toBe("denied");
    expect(f.state.dictation.session).toBeNull();
    f.act({ type: "permission", value: "ask" });
    f.act({ type: "mic", owner });
    f.act({ type: "permission", value: "allowed" });
    expect(f.state.dictation.session).toMatchObject({
      owner,
      phase: "recording",
    });
  });
  it("resumes on metered Wi-Fi, retains progress across workspaces and makes preparation distinct from readiness", () => {
    const f = flow("dictation-download-active");
    f.act({ type: "network", value: "cellular" });
    expect(f.state.dictation).toMatchObject({ model: "waiting", progress: 42 });
    f.act({ type: "retry" });
    expect(f.state.dictation.model).toBe("waiting");
    f.act({ type: "network", value: "metered" });
    f.command({
      type: "action",
      operation: { action: "open", id: "sample-2", request: "switch" },
    });
    expect(f.state.dictation).toMatchObject({
      model: "downloading",
      progress: 42,
    });
    f.act({ type: "model", value: "preparing" });
    f.act({ type: "mic", owner });
    expect(f.state.dictation.session).toBeNull();
    f.act({ type: "model", value: "ready" });
    f.act({ type: "network", value: "offline" });
    f.act({ type: "mic", owner });
    expect(f.state.dictation.session?.phase).toBe("recording");
  });
  it.each(["failed", "storage"] as const)(
    "keeps typed chat available after %s and permits retry on an eligible route",
    (value) => {
      const f = flow("dictation-download-active");
      f.act({ type: "model", value });
      f.act({ type: "send", owner });
      expect(f.state.dictation.drafts[owner]!.messages).toHaveLength(1);
      f.act({ type: "retry" });
      expect(f.state.dictation.model).toBe("downloading");
    },
  );
  it("keeps a failed file save ahead of discarding a dictation on close", () => {
    const f = flow("dictation-close-files");
    f.command({ type: "dictation-confirm", discard: true });
    expect(f.state.dictationNavigation).not.toBeNull();
    expect(f.state.dictation.session?.phase).toBe("transcribing");
    f.command({ type: "dictation-confirm", discard: false });
    f.command({ type: "feature", feature: "editor" });
    expect(f.state.editor.files.some((file) => file.saveError)).toBe(true);
    expect(screenControls(f.state).controls).toContain("editor");
    expect(screenControls(f.state).controls).toContain("dictation");
  });
  it("stopping an agent does not stop transcription", () => {
    const f = flow("dictation-close-agent");
    f.command({ type: "dictation-confirm", discard: false });
    f.act({ type: "stop-agent", owner });
    expect(f.state.dictation.drafts[owner]!.working).toBe(false);
    expect(f.state.dictation.session?.phase).toBe("transcribing");
  });
  it("preserves the draft on environment changes and removes pending work on reset", () => {
    const f = flow("dictation-transcribing");
    f.command({ type: "platform", mobile: true });
    expect(f.state.dictation.session?.phase).toBe("transcribing");
    f.command({ type: "scenario", scenario: "dictation-ready" });
    f.act({ type: "complete", id: 1, outcome: "success" });
    expect(f.state.dictation.drafts[owner]!.notice).toBe("");
    expect(f.state.snapshot.mobile).toBe(true);
  });
});
