import { describe, expect, it } from "vitest";
import {
  createSetupConversation,
  importedExamples,
  reduceSetupConversation as act,
  setupStep,
} from "./conversation-setup";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";
import { activeQuestion } from "../chat/question";

describe("conversational setup", () => {
  it("takes starting details into one conversation without adopting a method or importing", () => {
    const state = createSetupConversation();
    const sources = "  Apple Notes\nFolders & $& <notes>  ";
    act(state, {
      type: "details",
      patch: { sources, intent: "keep", preferences: "Keep my folders." },
    });
    act(state, { type: "start" });
    expect(state.transcript).toHaveLength(2);
    expect(state.transcript[0]).toMatchObject({
      speaker: "user",
      text: expect.stringContaining(sources),
    });
    expect(state.transcript[0]).toMatchObject({
      text: expect.stringContaining("Keep my folders."),
    });
    expect(state.confirmed).toBe(false);
    expect(state.imported).toEqual([]);
    expect(state.phase).toBe("method");
    act(state, {
      type: "details",
      patch: { sources: "Different sources", intent: "change" },
    });
    expect(state.sources).toBe(sources);
    expect(state.intent).toBe("keep");
    expect(setupStep(state)).toBe(2);
    act(state, { type: "open-app" });
    expect(state.finale.status).toBe("idle");
    act(state, { type: "confirm" });
    expect(state.confirmed).toBe(false);
  });
  it("starts fresh without an import or compulsory plugin", () => {
    const state = createSetupConversation("setup-conversation-fresh");
    act(state, { type: "start" });
    act(state, { type: "complete", run: state.pending!.run });
    expect(state.proposal).toContain("simple place");
    act(state, { type: "confirm" });
    expect(state.phase).toBe("support");
    expect(state.pending).toBeNull();
    expect(state.imported).toEqual([]);
    expect(state.build).toBe(false);
    expect(state.developmentStarted).toBe(false);
  });
  it("can preserve an existing method without importing old contents", () => {
    const state = createSetupConversation("setup-conversation-fresh");
    act(state, { type: "details", patch: { intent: "keep" } });
    act(state, { type: "start" });
    act(state, { type: "complete", run: state.pending!.run });
    expect(state.proposal).toBe("");
    expect(state.transcript.at(-1)).toMatchObject({
      text: expect.stringContaining("method you already use"),
    });
    act(state, {
      type: "draft",
      value: "Keep new notes and tasks grouped by project.",
    });
    act(state, { type: "send" });
    act(state, { type: "complete", run: state.pending!.run });
    expect(state.proposal).toContain("existing working method");
    expect(state.proposal).toContain("grouped by project");
    act(state, { type: "confirm" });
    expect(state.imported).toEqual([]);
    expect(state.phase).toBe("support");
  });
  it("keeps a proposal reviewable and rejects a late response after Stop", () => {
    const state = createSetupConversation("setup-conversation-proposal");
    const before = state.proposal;
    act(state, { type: "draft", value: "Don’t add a weekly routine." });
    act(state, { type: "send" });
    const run = state.pending!.run;
    act(state, { type: "stop" });
    act(state, { type: "complete", run });
    expect(state.proposal).toBe(before);
    act(state, { type: "confirm" });
    expect(state.confirmed).toBe(false);
    act(state, { type: "retry" });
    act(state, { type: "complete", run: state.pending!.run });
    expect(state.proposal).toContain("Don’t add a weekly routine.");
    act(state, { type: "confirm" });
    expect(state.confirmed).toBe(true);
  });
  it("can ask a follow-up without starting a new conversation or repeatedly asking it", () => {
    const state = createSetupConversation("setup-conversation-keep");
    act(state, { type: "start" });
    act(state, { type: "outcome", value: "question" });
    act(state, { type: "complete", run: state.pending!.run });
    expect(state.proposal).toBe("");
    act(state, { type: "draft", value: "The project folders matter most." });
    act(state, { type: "send" });
    act(state, { type: "complete", run: state.pending!.run });
    expect(state.proposal).toContain("project folders matter most");
    expect(
      state.transcript.filter(
        (event) => event.kind === "message" && event.speaker === "user",
      ),
    ).toHaveLength(2);
  });
  it("sends a suggested method answer once without overwriting an unsent draft", () => {
    const state = createSetupConversation("setup-conversation-proposal");
    const question = activeQuestion(state.transcript)!;
    act(state, { type: "draft", value: "Keep this unsent detail." });
    const response = { questionId: question.id, optionId: "confirm" };
    act(state, { type: "answer", response });
    const before = structuredClone(state);
    act(state, { type: "answer", response });
    expect(state).toEqual(before);
    expect(state.confirmed).toBe(true);
    expect(state.phase).toBe("import");
    expect(state.draft).toBe("Keep this unsent detail.");
    expect(question.answer).toMatchObject({ optionId: "confirm" });
    expect(
      state.transcript
        .filter((event) => event.kind === "message" && event.speaker === "user")
        .at(-1),
    ).toMatchObject({ text: question.answer!.text });
  });
  it("keeps free-text method answers separate from approval and rejects stale choice buttons", () => {
    const state = createSetupConversation("setup-conversation-proposal");
    const question = activeQuestion(state.transcript)!;
    act(state, {
      type: "answer",
      response: {
        questionId: question.id,
        text: "Keep the folders, but change the review routine.",
      },
    });
    expect(state.confirmed).toBe(false);
    expect(question.answer?.optionId).toBeUndefined();
    act(state, { type: "complete", run: state.pending!.run });
    expect(activeQuestion(state.transcript)?.id).not.toBe(question.id);
    act(state, {
      type: "answer",
      response: { questionId: question.id, optionId: "confirm" },
    });
    expect(state.confirmed).toBe(false);
    expect(state.proposal).toContain("change the review routine");
  });
  it("asks for a written revision without a second input or implicit adoption", () => {
    const state = createSetupConversation("setup-conversation-proposal");
    act(state, {
      type: "answer",
      response: {
        questionId: activeQuestion(state.transcript)!.id,
        optionId: "adjust",
      },
    });
    expect(activeQuestion(state.transcript)?.options).toEqual([]);
    act(state, { type: "confirm" });
    expect(state.confirmed).toBe(false);
    act(state, { type: "draft", value: "No recurring reviews." });
    act(state, { type: "send" });
    act(state, { type: "complete", run: state.pending!.run });
    expect(state.proposal).toContain("No recurring reviews.");
  });
  it("does not start plugin development or finish setup from a free response", () => {
    const state = createSetupConversation("setup-conversation-support");
    act(state, { type: "draft", value: "What would the overview do?" });
    act(state, { type: "send" });
    expect(state.phase).toBe("support");
    expect(state.build).toBe(false);
    expect(state.developmentStarted).toBe(false);
    act(state, {
      type: "answer",
      response: {
        questionId: activeQuestion(state.transcript)!.id,
        optionId: "build",
      },
    });
    expect(state.build).toBe(true);
    expect(state.developmentStarted).toBe(false);
    act(state, {
      type: "answer",
      response: {
        questionId: activeQuestion(state.transcript)!.id,
        optionId: "finish",
      },
    });
    expect(state.developmentStarted).toBe(false);
    act(state, { type: "finale-finish" });
    expect(state.developmentStarted).toBe(true);
  });
  it("uses the same finale for early entry and completed guided setup", () => {
    const early = createSetupConversation("setup-conversation-import");
    const complete = createSetupConversation("setup-conversation-support");
    act(early, { type: "draft", value: "Keep this unsent question." });
    const pending = structuredClone(early.pending);
    act(early, { type: "open-app" });
    act(complete, { type: "finish" });
    expect(early.finale).toEqual(complete.finale);
    expect(early.finale).toEqual({
      status: "playing",
      timeMs: null,
      paused: false,
      run: 1,
    });
    act(early, { type: "finale-finish" });
    expect(early.view).toBe("app");
    expect(early.phase).toBe("import");
    expect(early.pending).toEqual(pending);
    expect(early.draft).toBe("Keep this unsent question.");
    expect(early.developmentStarted).toBe(false);
  });
  it("continues import while another conversation is selected and does not mix drafts", () => {
    const state = createSetupConversation("setup-conversation-app");
    act(state, { type: "draft", value: "Setup draft" });
    act(state, { type: "pane", value: "new" });
    state.otherChat.draft = "Plan a reading evening.";
    act(state, { type: "other-send" });
    expect(state.otherChat.transcript?.[0]).toMatchObject({
      speaker: "user",
      text: "Plan a reading evening.",
    });
    act(state, { type: "complete", run: state.pending!.run });
    expect(state.phase).toBe("support");
    expect(state.pane).toBe("new");
    expect(state.draft).toBe("Setup draft");
    expect(state.imported).toEqual(importedExamples.map((file) => file.path));
    expect(
      state.transcript.some(
        (event) =>
          event.kind === "message" &&
          event.text.includes("Plan a reading evening."),
      ),
    ).toBe(false);
  });
  it("retains partial copies and can defer the rest without claiming full import", () => {
    const state = createSetupConversation("setup-conversation-partial");
    const files = [...state.imported];
    expect(files).toHaveLength(1);
    expect(state.error).toBe("partial");
    act(state, { type: "defer" });
    expect(state.phase).toBe("support");
    expect(state.importDeferred).toBe(true);
    expect(state.imported).toEqual(files);
    expect(
      state.transcript.some(
        (event) =>
          event.kind === "message" &&
          event.text.includes("remaining import for later"),
      ),
    ).toBe(true);
  });
  it("does not replay the finale when returning to the guide or finishing later in the app", () => {
    const state = createSetupConversation("setup-conversation-app");
    act(state, { type: "guided" });
    act(state, { type: "open-app" });
    expect(state.view).toBe("app");
    expect(state.finale.status).toBe("idle");
    act(state, { type: "complete", run: state.pending!.run });
    act(state, { type: "build", value: true });
    expect(state.developmentStarted).toBe(false);
    act(state, { type: "finish" });
    expect(state.developmentStarted).toBe(true);
    expect(state.developmentChat.transcript?.[0]).toMatchObject({
      speaker: "assistant",
      text: expect.stringContaining("project overview"),
    });
    state.otherChat.draft = "Unsent ordinary chat";
    state.developmentChat.draft = "Keep the project folders.";
    act(state, { type: "development-send" });
    expect(state.otherChat.draft).toBe("Unsent ordinary chat");
    expect(state.developmentChat.draft).toBe("");
    expect(state.phase).toBe("done");
    expect(state.finale.status).toBe("idle");
  });
  it("starts selected development only after the full guided handoff", () => {
    const state = createSetupConversation("setup-conversation-support");
    act(state, { type: "build", value: true });
    act(state, { type: "finish" });
    expect(state.developmentStarted).toBe(false);
    act(state, { type: "finale-finish" });
    expect(state.developmentStarted).toBe(true);
  });
  it("uses the file reader as the current screen without exposing hidden response controls", () => {
    let state = createSimulation("setup-conversation-partial");
    state = reduceSimulation(state, {
      type: "setup-conversation",
      action: { type: "read", path: "Missing.md" },
    });
    expect(state.setupConversation.readFile).toBeNull();
    state = reduceSimulation(state, {
      type: "setup-conversation",
      action: { type: "read", path: state.setupConversation.imported[0]! },
    });
    expect(screenControls(state).label).toContain(
      "Imported file · Garden/Planning.md",
    );
    expect(screenControls(state).controls).toEqual([]);
    state = reduceSimulation(state, {
      type: "environment",
      state: { ...state.environment, keyboardOpen: true },
    });
    expect(state.setupConversation.readFile).toBe("Garden/Planning.md");
    state = reduceSimulation(state, {
      type: "setup-conversation",
      action: { type: "close-reader" },
    });
    expect(screenControls(state).controls).toEqual(["setup-conversation"]);
  });
  it("resets interactions but preserves the selected environment", () => {
    let state = createSimulation("setup-conversation-app");
    state = reduceSimulation(state, {
      type: "setup-conversation",
      action: { type: "draft", value: "Unsent" },
    });
    state = reduceSimulation(state, {
      type: "environment",
      state: { ...state.environment, keyboardOpen: true },
    });
    expect(state.setupConversation.draft).toBe("Unsent");
    state = reduceSimulation(state, { type: "reset" });
    expect(state.setupConversation.draft).toBe("");
    expect(state.environment.keyboardOpen).toBe(true);
    expect(state.setupConversation.imported).toHaveLength(1);
  });
  it("updates controls for the current view and hides unrelated workspace outcomes", () => {
    let state = createSimulation("setup-conversation-import");
    expect(screenControls(state).label).toContain("Import conversation");
    expect(screenControls(state).controls).toEqual(["setup-conversation"]);
    expect(screenControls(state).canSetOutcome).toBe(false);
    state = reduceSimulation(state, {
      type: "setup-conversation",
      action: { type: "open-app" },
    });
    expect(screenControls(state).label).toContain("celebration");
    state = reduceSimulation(state, {
      type: "setup-conversation",
      action: { type: "finale-finish" },
    });
    expect(screenControls(state).label).toContain("App view");
    state = reduceSimulation(state, {
      type: "setup-conversation",
      action: { type: "pane", value: "new" },
    });
    expect(screenControls(state).label).toContain("New chat in the app");
  });
});
