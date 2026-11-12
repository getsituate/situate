import { describe, it, expect } from "vitest";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";
import {
  accentStyle,
  accents,
  createFirstEntry,
  reduceFirstEntry,
} from "./first-entry";
import { applyOutcome, beginConnection, currentWorkspace } from "../ai/model";

describe("first workspace entry", () => {
  it("starts on the normal workspace overview without welcome or setup", () => {
    const state = createSimulation();
    expect(state.feature).toBe("workspace");
    expect(state.entryVisible).toBe(true);
    expect(state.creating).toBe(false);
    expect(screenControls(state).label).toBe("Workspace selection");
    expect(state.snapshot.known.length).toBeGreaterThan(0);
  });
  it.each(["create", "collision", "create-error"] as const)(
    "%s opens the shared creation step directly",
    (scenario) => {
      const state = createSimulation(scenario);
      expect(state.creating).toBe(true);
      expect(state.firstEntry).toMatchObject({
        step: "create",
        created: false,
        openingAvailable: false,
      });
      expect(screenControls(state).label).toBe("Create workspace");
    },
  );
  it.each(["workspaces", "workspace"] as const)(
    "onboards each new workspace from %s without reusing another workspace's setup",
    (scenario) => {
      let state = createSimulation(scenario);
      const existing = structuredClone(state.snapshot.known);
      state = reduceSimulation(state, { type: "creating", value: true });
      expect(state.firstEntry.step).toBe("intro");
      state = reduceSimulation(state, {
        type: "first-entry",
        action: { type: "step", step: "create" },
      });
      expect(state.firstEntry.step).toBe("create");
      state = reduceSimulation(state, {
        type: "action",
        operation: { request: "fresh", action: "create", name: "Field notes" },
      });
      expect(state.firstEntry).toMatchObject({
        created: true,
        step: "ai",
        transitionAvailable: true,
        check: "idle",
      });
      expect(state.feature).toBe("ai");
      expect(state.snapshot.current?.name).toBe("Field notes");
      expect(
        state.snapshot.known.filter((item) =>
          existing.some((old) => old.id === item.id),
        ),
      ).toEqual(existing);
      expect(state.firstEntry.step).toBe("ai");
      expect(state.ai.screen).toBe("providers");
      expect(state.onboarding.confirmed).toBe(false);
    },
  );
  it("returns to the overview and preserves the existing workspace when creation is cancelled", () => {
    const initial = createSimulation("workspace");
    let state = reduceSimulation(initial, { type: "creating", value: true });
    state = reduceSimulation(state, { type: "creating", value: false });
    expect(state.entryVisible).toBe(true);
    expect(state.creating).toBe(false);
    expect(state.feature).toBe(initial.feature);
    expect(state.snapshot.current).toEqual(initial.snapshot.current);
    expect(state.snapshot.known).toEqual(initial.snapshot.known);
  });
  it.each(["opus", "astra"] as const)(
    "opens the current welcome for the %s link without changing workspace setup",
    (study) => {
      const s = createSimulation(
        study === "opus" ? "first-entry-opus" : "first-entry",
      );
      expect(s.firstEntry).toMatchObject({
        step: "intro",
        welcomeStudy: "astra",
        welcomeTime: null,
      });
      expect(s.snapshot.current).toBeNull();
      expect(s.feature).toBe("first-entry");
    },
  );
  it("keeps frame inspection separate from playback and resets it on replay", () => {
    let s = createSimulation("first-entry-opus");
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "welcome-time", timeMs: 3200 },
    });
    expect(s.firstEntry).toMatchObject({ step: "intro", welcomeTime: 3200 });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "welcome-replay" },
    });
    expect(s.firstEntry).toMatchObject({
      step: "intro",
      welcomeTime: null,
      welcomeRun: 1,
      paused: false,
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "step", step: "create" },
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "welcome-replay" },
    });
    expect(s.firstEntry.step).toBe("create");
  });
  it("limits opening inspection to the create screen and clears it when returning", () => {
    let state = createFirstEntry("first-entry");
    const apply = (action: Parameters<typeof reduceFirstEntry>[1]) => {
      state = reduceFirstEntry(state, action);
    };
    apply({ type: "opening-time", timeMs: 300 });
    expect(state.openingTime).toBeNull();
    apply({ type: "step", step: "create" });
    expect(state.openingAvailable).toBe(true);
    apply({ type: "opening-time", timeMs: 300 });
    expect(state.openingTime).toBe(300);
    apply({ type: "opening-time", timeMs: NaN });
    expect(state.openingTime).toBe(300);
    state.paused = true;
    apply({ type: "opening-replay" });
    expect(state).toMatchObject({
      openingTime: null,
      openingRun: 1,
      paused: true,
    });
    apply({ type: "step", step: "intro" });
    expect(state).toMatchObject({ openingTime: null, openingAvailable: false });
    apply({ type: "opening-replay" });
    expect(state.openingRun).toBe(1);
  });
  it("preserves form drafts while inspecting or replaying the opening", () => {
    let state = createSimulation("first-entry");
    state = reduceSimulation(state, {
      type: "first-entry",
      action: { type: "step", step: "create" },
    });
    state = reduceSimulation(state, { type: "draft", name: "Paper garden" });
    for (const action of [
      { type: "opening-time", timeMs: 370 },
      { type: "opening-replay" },
    ] as const)
      state = reduceSimulation(state, { type: "first-entry", action });
    expect(state.draftName).toBe("Paper garden");
    expect(state.snapshot.current).toBeNull();
    expect(screenControls(state).controls).toContain("first-entry");
    expect(screenControls(state).editing).toBe(true);
  });
  it("offers the settings palette with appropriate text colors", () => {
    expect(accents).toEqual([
      "violet",
      "cobalt",
      "sky",
      "tangerine",
      "peach",
      "lemon",
    ]);
    for (const accent of ["sky", "lemon", "tangerine", "peach"] as const)
      expect(accentStyle(accent)["--workspace-on-accent"]).toBe(
        "var(--situate-ink)",
      );
  });
  it("does not unlock working-method setup from authentication alone", () => {
    let s = createSimulation("first-entry-ai");
    s = reduceSimulation(s, { type: "feature", feature: "onboarding" });
    expect(s.feature).toBe("ai");
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "check-model" },
    });
    expect(s.firstEntry.check).toBe("idle");
    beginConnection(s.ai);
    applyOutcome(s.ai, "success");
    expect(s.ai.screen).toBe("success");
    expect(s.firstEntry.step).toBe("ai");
    s = reduceSimulation(s, {
      type: "onboarding",
      action: { type: "patch", patch: { step: "method" } },
    });
    expect(s.onboarding.step).toBe("access");
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "step", step: "working" },
    });
    expect(s.firstEntry.step).toBe("ai");
  });
  it("advances only after a successful model check and retains the workspace", () => {
    let s = createSimulation("first-entry-model");
    const workspace = s.snapshot.current;
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "model", id: "example-chat" },
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "check-model" },
    });
    const attempt = s.firstEntry.attempt;
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "model-result", ok: false, attempt },
    });
    expect(s.firstEntry.check).toBe("failed");
    expect(s.firstEntry.step).toBe("ai");
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "check-model" },
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "model-result", ok: true, attempt: s.firstEntry.attempt },
    });
    expect(s.firstEntry).toMatchObject({ check: "verified", step: "working" });
    expect(s.setupConversation.phase).toBe("brief");
    expect(s.setupConversation.transcript).toEqual([]);
    expect(s.feature).toBe("setup-conversation");
    expect(s.snapshot.current).toEqual(workspace);
    expect(currentWorkspace(s.ai).model.selected).toBe("example-chat");
  });
  it("ignores cancelled checks and resumes without repeating creation", () => {
    let s = createSimulation("first-entry-model");
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "model", id: "example-chat" },
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "check-model" },
    });
    const attempt = s.firstEntry.attempt;
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "pause-setup" },
    });
    expect(s.firstEntry.step).toBe("paused");
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "resume-setup" },
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "model-result", ok: true, attempt },
    });
    expect(s.firstEntry).toMatchObject({
      step: "ai",
      check: "idle",
      modelId: "example-chat",
    });
    expect(s.snapshot.known).toHaveLength(1);
  });
  it("keeps the working-method draft when pausing later in setup", () => {
    let s = createSimulation("first-entry-model");
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "model", id: "example-chat" },
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "check-model" },
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "model-result", ok: true, attempt: s.firstEntry.attempt },
    });
    s = reduceSimulation(s, {
      type: "setup-conversation",
      action: {
        type: "details",
        patch: { preferences: "Keep a weekly journal" },
      },
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "pause-setup" },
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "resume-setup" },
    });
    expect(s.setupConversation.preferences).toBe("Keep a weekly journal");
    expect(s.firstEntry.step).toBe("working");
  });
  it("rejects unavailable models and disconnected verification", () => {
    let s = createSimulation("first-entry-model");
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "model", id: "example-image" },
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "check-model" },
    });
    expect(s.firstEntry.check).toBe("idle");
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "model", id: "example-chat" },
    });
    currentWorkspace(s.ai).unavailable = "offline";
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "check-model" },
    });
    expect(s.firstEntry.check).toBe("idle");
  });
  it("starts before any workspace is created", () => {
    const s = createSimulation("first-entry");
    expect(s.snapshot.current).toBeNull();
    expect(s.snapshot.known).toEqual([]);
    expect(s.firstEntry.step).toBe("intro");
    expect(s.firstEntry.welcomeStudy).toBe("astra");
    expect(reduceSimulation(s, { type: "reset" }).firstEntry.welcomeStudy).toBe(
      "astra",
    );
    expect(screenControls(s).controls).toContain("first-entry");
  });
  it("stores the selected accent and inspected path only on successful creation", () => {
    let s = createSimulation("first-entry-create");
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "accent", accent: "tangerine" },
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "parent", parent: "/Example/Selected folder" },
    });
    expect(s.snapshot.known).toHaveLength(0);
    s = reduceSimulation(s, { type: "outcome", outcome: "wait" });
    s = reduceSimulation(s, {
      type: "action",
      operation: { request: "create-one", action: "create", name: "Personal" },
    });
    expect(s.snapshot.current).toBeNull();
    s = reduceSimulation(s, { type: "finish", ok: true });
    expect(s.snapshot.current).toMatchObject({
      name: "Personal",
      display: "/Example/Selected folder/Personal",
      accent: "tangerine",
    });
    expect(s.firstEntry).toMatchObject({ step: "ai", created: true });
    expect(s.settings.accent).toBe("tangerine");
  });
  it("does not lose the draft after a failed operation or viewport change", () => {
    let s = createSimulation("first-entry-create");
    s = reduceSimulation(s, { type: "draft", name: "Work" });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "accent", accent: "cobalt" },
    });
    s = reduceSimulation(s, { type: "outcome", outcome: "error" });
    s = reduceSimulation(s, {
      type: "action",
      operation: { request: "fail", action: "create", name: "Work" },
    });
    s = reduceSimulation(s, { type: "platform", mobile: true });
    expect(s.firstEntry).toMatchObject({ step: "create", accent: "cobalt" });
    expect(s.draftName).toBe("Work");
    expect(s.snapshot.current).toBeNull();
  });
  it("does not apply a cancelled preview to an existing workspace", () => {
    let s = createSimulation("first-entry-create");
    s.snapshot.known.push({
      id: "existing",
      name: "Work",
      display: "/Example/Work",
      accent: "cobalt",
    });
    s = reduceSimulation(s, {
      type: "first-entry",
      action: { type: "accent", accent: "tangerine" },
    });
    s = reduceSimulation(s, { type: "creating", value: false });
    expect(s.firstEntry.accent).toBe("violet");
    s = reduceSimulation(s, {
      type: "action",
      operation: { request: "open-existing", action: "open", id: "existing" },
    });
    expect(s.snapshot.current?.accent).toBe("cobalt");
    expect(s.settings.accent).toBe("cobalt");
    expect(s.firstEntry.created).toBe(false);
    expect(s.feature).toBe("workspace");
  });
  it("opens an existing workspace with its saved appearance", () => {
    let s = createSimulation("settings-appearance");
    const workspace = s.snapshot.current!;
    s = reduceSimulation(s, {
      type: "settings",
      state: { ...s.settings, accent: "peach" },
    });
    s = reduceSimulation(s, { type: "entry", visible: true });
    s = reduceSimulation(s, {
      type: "action",
      operation: { request: "reopen", action: "open", id: workspace.id },
    });
    expect(s.feature).toBe("settings");
    expect(s.firstEntry.created).toBe(false);
    expect(s.firstEntry.openingAvailable).toBe(false);
    expect(s.settings.accent).toBe("peach");
    expect(accentStyle("peach")["--workspace-on-accent"]).toBe(
      "var(--situate-ink)",
    );
  });
  it("resumes an already-created workspace without replaying welcome or creation", () => {
    const paused = createSimulation("first-entry-paused");
    const workspace = structuredClone(paused.snapshot.current);
    const saved = structuredClone(paused.onboarding);
    const state = reduceSimulation(paused, {
      type: "first-entry",
      action: { type: "resume-setup" },
    });
    expect(state.firstEntry).toMatchObject({
      created: true,
      step: "ai",
      openingAvailable: false,
      transitionAvailable: false,
    });
    expect(state.snapshot.current).toEqual(workspace);
    expect(state.onboarding).toEqual(saved);
    expect(state.feature).toBe("ai");
    expect(reduceSimulation(state, { type: "creating", value: false })).toEqual(
      state,
    );
  });
  it("returns direct creation to the overview without creating a workspace", () => {
    const initial = createSimulation("first-entry-create");
    const state = reduceSimulation(initial, { type: "creating", value: false });
    expect(state.feature).toBe("workspace");
    expect(state.entryVisible).toBe(true);
    expect(state.creating).toBe(false);
    expect(state.snapshot.current).toBeNull();
    expect(state.snapshot.known).toEqual(initial.snapshot.known);
  });
});
