import { describe, expect, it } from "vitest";
import { currentScreen, screenControls } from "./screen-controls";
import {
  createSimulation,
  reduceSimulation,
  type Scenario,
} from "./simulation";

describe("screen controls", () => {
  it("follows plugin uninstall confirmation from the installed collection", () => {
    const state = createSimulation("plugins-list");
    state.plugins.dialog = "uninstall";
    state.plugins.target = "morning";
    expect(screenControls(state)).toMatchObject({
      label: "Uninstall Morning brief?",
      controls: ["plugins"],
      editing: false,
    });
  });
  it.each<[Scenario, string, string[]]>([
    ["tabs-overview", "tabs", ["tabs"]],
    ["tabs-new-chat", "tabs", ["tabs", "tab-model"]],
    ["tabs-move-pane", "tabs", ["tabs"]],
    ["welcome", "selection", ["content", "error"]],
    ["workspaces", "selection", ["content", "error"]],
    ["access-error", "selection", ["content", "error"]],
    ["restore-error", "selection", ["content", "error"]],
    ["opening", "selection", ["content", "error"]],
    ["create", "creation", ["error", "folder"]],
    ["collision", "creation", ["error", "folder"]],
    ["remove", "removal", ["error"]],
    ["startup", "startup", []],
    ["startup-error", "startup", []],
    ["workspace", "workspace", ["content", "error"]],
    ["create-error", "creation", ["error", "folder"]],
    ["invalid-folder", "selection", ["content", "error"]],
    ["navigation-chat", "navigation", ["navigation"]],
    ["navigation-dashboard", "navigation", ["navigation"]],
    ["files-read", "editor", ["editor"]],
    ["files-source", "editor", ["editor"]],
    ["files-history", "editor", ["editor"]],
    ["files-conflict", "editor", ["editor"]],
    ["files-conflict-failure", "editor", ["editor"]],
    ["files-conflict-race", "editor", ["editor"]],
    ["files-merged", "editor", ["editor"]],
    ["ai-offer", "ai", ["ai"]],
    ["ai-chat-uncertain", "chat", ["chat"]],
    ["ai-browser", "ai", ["ai"]],
  ])(
    "offers only controls for the visible screen in %s",
    (scenario, screen, controls) => {
      const state = createSimulation(scenario);
      expect(currentScreen(state)).toBe(screen);
      expect(screenControls(state).controls).toEqual(controls);
    },
  );

  it("follows tag creation and exposes keyboard geometry even beside a selected document", () => {
    const state = createSimulation("documents-new-tag");
    state.documents.selected = "bike";
    expect(screenControls(state)).toMatchObject({
      label: "Documents · new tag",
      editing: true,
      controls: ["documents"],
    });
    state.documents.tagCreation = null;
    expect(screenControls(state)).toMatchObject({
      label: "Documents · preview",
      editing: false,
    });
  });

  it.each([
    ["documents-delete-tag", "Documents · delete tag"],
    ["documents-delete-branch", "Documents · delete tag"],
    ["documents-tag-delete-conflict", "Documents · delete tag"],
  ] as const)("exposes controls for %s", (scenario, label) => {
    const state = createSimulation(scenario);
    expect(screenControls(state)).toMatchObject({
      label,
      controls: ["documents"],
      editing: true,
      canSetOutcome: false,
    });
  });

  it.each([
    "documents-tag-removed",
    "documents-repair-view",
    "documents-missing-tag",
  ] as const)("shows collection controls for %s", (scenario) => {
    expect(screenControls(createSimulation(scenario))).toMatchObject({
      label: "Documents · collection",
      controls: ["documents"],
      editing: true,
      canSetOutcome: false,
    });
  });

  it("follows document actions and initializes the menu closed", () => {
    const state = createSimulation("documents-find");
    state.documents.collectionMenu = { x: 100, y: 60 };
    expect(screenControls(state)).toMatchObject({
      label: "Documents · actions",
      controls: ["documents"],
    });
    expect(
      createSimulation("documents-find").documents.collectionMenu,
    ).toBeNull();
  });

  it("follows settings and document-source navigation without replacing the tab starting state", () => {
    let state = createSimulation("tabs-new-chat");
    const tabs = state.tabs;
    for (const feature of ["settings", "documents", "tabs"] as const) {
      state = reduceSimulation(state, { type: "feature", feature });
      expect(currentScreen(state)).toBe(feature);
      expect(screenControls(state).controls).toEqual(
        feature === "tabs" ? ["tabs", "tab-model"] : [feature],
      );
      expect(state.scenario).toBe("tabs-new-chat");
      expect(state.tabs).toEqual(tabs);
    }
    state = reduceSimulation(state, {
      type: "document-sources",
      action: "list",
      workspaceId: state.snapshot.current!.id,
    });
    expect(screenControls(state)).toMatchObject({
      controls: ["plugins"],
      sourceManagement: true,
    });
    expect(state.scenario).toBe("tabs-new-chat");
    expect(state.tabs).toEqual(tabs);
  });

  it("follows navigation rather than the original scenario", () => {
    const initial = createSimulation("welcome");
    const creation = reduceSimulation(initial, {
      type: "creating",
      value: true,
    });
    expect(creation.scenario).toBe("welcome");
    expect(creation.firstEntry.step).toBe("intro");
    expect(screenControls(creation).controls).toEqual(["first-entry"]);
    const opened = reduceSimulation(creation, {
      type: "action",
      operation: { request: "create", action: "create", name: "Reading room" },
    });
    expect(opened.scenario).toBe("welcome");
    expect(currentScreen(opened)).toBe("ai");
    expect(screenControls(opened).controls).toEqual(["ai", "first-entry"]);
    expect(opened.firstEntry.step).toBe("ai");
  });

  it("gives the visible modal and startup screen precedence over background state", () => {
    const state = createSimulation("create");
    state.removingId = "sample-1";
    expect(currentScreen(state)).toBe("removal");
    state.snapshot.error = "Could not start.";
    expect(currentScreen(state)).toBe("startup");
    expect(screenControls(state).controls).toEqual([]);
  });

  it("keeps workspace settings out of proposals until workspace selection opens", () => {
    const state = createSimulation("files-source");
    expect(screenControls(state)).toMatchObject({
      label: "Edit Markdown",
      editing: true,
      canSetOutcome: false,
    });
    const selection = reduceSimulation(state, { type: "entry", visible: true });
    expect(screenControls(selection)).toMatchObject({
      label: "Workspace selection",
      editing: false,
      controls: ["content", "error"],
    });
    const back = reduceSimulation(selection, { type: "entry", visible: false });
    expect(screenControls(back).controls).toEqual(["editor"]);
  });

  it("shows completion controls only while an action is pending", () => {
    const initial = createSimulation("welcome");
    expect(screenControls(initial)).toMatchObject({
      canSetOutcome: true,
      canComplete: false,
    });
    const waiting = reduceSimulation(
      reduceSimulation(initial, { type: "outcome", outcome: "wait" }),
      {
        type: "action",
        operation: { request: "open", action: "pick" },
      },
    );
    expect(screenControls(waiting)).toMatchObject({
      canSetOutcome: false,
      canComplete: true,
    });
    const failed = reduceSimulation(waiting, { type: "finish", ok: false });
    expect(screenControls(failed)).toMatchObject({
      canSetOutcome: true,
      canComplete: false,
    });
    const reset = reduceSimulation(waiting, { type: "reset" });
    expect(screenControls(reset).canComplete).toBe(false);
  });

  it("offers startup action results only when Retry is available", () => {
    const state = createSimulation("startup");
    expect(screenControls(state)).toMatchObject({
      canSetOutcome: false,
      canComplete: true,
    });
    state.pending = null;
    expect(screenControls(state)).toMatchObject({
      canSetOutcome: false,
      canComplete: false,
    });
    state.snapshot.error = "Try again.";
    expect(screenControls(state)).toMatchObject({
      canSetOutcome: true,
      canComplete: false,
    });
  });
});
