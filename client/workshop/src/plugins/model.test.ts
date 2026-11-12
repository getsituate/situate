import { describe, expect, it } from "vitest";
import {
  affectedPlugins,
  applyPluginOutcome,
  canEnablePlugin,
  createPluginState,
  currentDevelopment,
  disablePlugin,
  startPluginDisable,
  cancelPluginDisable,
  stopPluginDisable,
  finishPluginDisable,
  discardDevelopment,
  enablePlugin,
  hasPluginWork,
  interruptPluginWork,
  openPluginScreen,
  openPluginFiles,
  pluginScenarios,
  sendPluginRequest,
  startPluginDevelopment,
  connectorDependencies,
  connectionConsumers,
  selectConnectionAccount,
  startConnectionAttempt,
  finishConnectionAttempt,
  growAssignment,
} from "./model";
describe("local plugin management", () => {
  it("keeps general errors separate from development outcomes", () => {
    const s = createPluginState("plugins-general-error");
    expect(s.generalError).toBe(true);
    expect(currentDevelopment(s)?.phase).toBe("working");
    expect(createPluginState("plugins-error").generalError).toBe(false);
    expect(createPluginState("plugins-development").generalError).toBe(false);
  });
  it("keeps reusable connectors separate and account choices local to each consumer", () => {
    const s = createPluginState("plugins-connections");
    const inbox = s.plugins.find((p) => p.id === "inbox")!;
    expect(connectorDependencies(s, inbox).map((p) => p.id)).toEqual(["gmail"]);
    expect(connectionConsumers(s, "gmail").map((p) => p.id)).toEqual([
      "inbox",
      "follow-up",
    ]);
    selectConnectionAccount(s, "inbox", "gmail-project", true);
    expect(s.accountSelections.inbox).toEqual([
      "gmail-personal",
      "gmail-project",
    ]);
    expect(s.accountSelections["follow-up"]).toEqual(["gmail-project"]);
    startConnectionAttempt(s, "gmail");
    finishConnectionAttempt(s, true);
    expect(s.accounts.gmail).toHaveLength(3);
    expect(s.accountSelections.inbox).toHaveLength(2);
    expect(s.accountSelections["follow-up"]).toHaveLength(1);
    selectConnectionAccount(s, "inbox", "unknown-account", true);
    expect(s.accountSelections.inbox).toHaveLength(2);
  });
  it("preserves accounts and selections on failure, and reconnects the same account", () => {
    const s = createPluginState("plugins-connection-error");
    const original = JSON.stringify(s.accountSelections);
    startConnectionAttempt(s, "gmail", "gmail-personal");
    finishConnectionAttempt(s, false);
    expect(s.connectionError).not.toBe("");
    expect(s.accounts.gmail[0].status).toBe("expired");
    startConnectionAttempt(s, "gmail", "gmail-personal");
    finishConnectionAttempt(s, true);
    expect(s.accounts.gmail).toHaveLength(2);
    expect(s.accounts.gmail[0].status).toBe("connected");
    expect(JSON.stringify(s.accountSelections)).toBe(original);
  });
  it("cancels account connection work on disabling and interruption", () => {
    const s = createPluginState("plugins-connections");
    startConnectionAttempt(s, "gmail");
    s.target = "gmail";
    disablePlugin(s);
    finishConnectionAttempt(s, true);
    expect(s.accounts.gmail).toHaveLength(2);
    selectConnectionAccount(s, "inbox", "gmail-project", true);
    expect(s.accountSelections.inbox).toEqual(["gmail-personal"]);
    enablePlugin(s, "gmail");
    startConnectionAttempt(s, "gmail");
    interruptPluginWork(s);
    finishConnectionAttempt(s, true);
    expect(s.accounts.gmail).toHaveLength(2);
  });
  it("uses shared creation copy while preserving a resolved connector kind through adoption", () => {
    const s = createPluginState("plugins-empty");
    startPluginDevelopment(s, undefined, "connector");
    expect(currentDevelopment(s)?.kind).toBe("connector");
    const generic = createPluginState("plugins-empty");
    startPluginDevelopment(generic);
    expect(currentDevelopment(s)?.title).toBe(
      currentDevelopment(generic)?.title,
    );
    expect(currentDevelopment(s)?.draft).toBe(
      currentDevelopment(generic)?.draft,
    );
    sendPluginRequest(s);
    applyPluginOutcome(s, "checking");
    applyPluginOutcome(s, "waiting");
    applyPluginOutcome(s, "adopted");
    expect(s.plugins[0].kind).toBe("connector");
    expect(s.accounts[s.plugins[0].id]).toEqual([]);
  });
  it.each(["plugins-list", "plugins-connections"])(
    "keeps identical fixtures when comparing illustrations in %s",
    (scenario) => {
      const plain = createPluginState(scenario);
      const illustrated = createPluginState(`${scenario}-illustrated`);
      expect(plain.cardStyle).toBe("plain");
      expect(illustrated).toEqual({ ...plain, cardStyle: "illustrated" });
    },
  );
  it("exposes deterministic serializable scenarios without unrelated development work", () => {
    for (const scenario of pluginScenarios)
      expect(
        JSON.parse(JSON.stringify(createPluginState(scenario.id))),
      ).toEqual(createPluginState(scenario.id));
    expect(createPluginState("settings-formats").developments).toEqual([]);
    expect(createPluginState("plugins-empty").plugins).toEqual([]);
  });
  it("includes indirect dependents and retains configuration on disable", () => {
    const s = createPluginState();
    expect(affectedPlugins(s, "calendar").map((p) => p.id)).toEqual([
      "weekly",
      "morning",
    ]);
    s.target = "calendar";
    disablePlugin(s);
    expect(
      s.plugins
        .filter((p) => ["calendar", "weekly", "morning"].includes(p.id))
        .every((p) => !p.enabled),
    ).toBe(true);
    expect(
      s.plugins.filter((p) => p.kind === "source").every((p) => p.enabled),
    ).toBe(true);
    expect(s.plugins[1].running).toBe(1);
    expect(s.plugins[1].day).toBe("monday");
    expect(canEnablePlugin(s, s.plugins[1])).toBe(false);
    enablePlugin(s, "weekly");
    expect(s.plugins[1].enabled).toBe(false);
    enablePlugin(s, "calendar");
    expect(s.plugins[1].enabled).toBe(false);
    enablePlugin(s, "weekly");
    expect(s.plugins[1].enabled).toBe(true);
    expect(s.plugins[2].enabled).toBe(false);
  });
  it("keeps the disable dialog open without saving status before running work finishes", () => {
    const s = createPluginState();
    s.plugins[2].enabled = false;
    s.plugins[2].blocked = false;
    s.target = "calendar";
    s.dialog = "disable";
    startPluginDisable(s);
    expect(s.dialog).toBe("disable");
    expect(s.disableOperation?.phase).toBe("waiting");
    expect(s.disableOperation?.previous.map((p) => p.id)).toEqual([
      "calendar",
      "weekly",
    ]);
    expect(s.plugins[0].running).toBe(1);
    expect(canEnablePlugin(s, s.plugins[0])).toBe(false);
    enablePlugin(s, "calendar");
    expect(s.plugins[0].enabled).toBe(true);
    openPluginFiles(s, "weekly");
    expect(s.disableOperation?.target).toBe("calendar");
    cancelPluginDisable(s);
    expect(s.disableOperation).toBeNull();
    expect(s.plugins.slice(0, 3).map((p) => p.enabled)).toEqual([
      true,
      true,
      false,
    ]);
    expect(s.plugins[2].blocked).toBe(false);
    expect(s.plugins[0].running).toBe(1);
  });
  it("does not claim stopping succeeded until completion and leaves unrelated work alone", () => {
    const s = createPluginState();
    s.target = "weekly";
    startPluginDisable(s);
    stopPluginDisable(s);
    expect(s.disableOperation?.phase).toBe("stopping");
    expect(s.plugins[1].running).toBe(1);
    cancelPluginDisable(s);
    expect(s.disableOperation?.phase).toBe("stopping");
    finishPluginDisable(s);
    expect(s.disableOperation).toBeNull();
    expect(s.plugins[0].running).toBe(1);
    expect(s.plugins[1].running).toBe(0);
    expect(s.plugins[1].enabled).toBe(false);
  });
  it("does not restore use when the disable outcome is uncertain", () => {
    const s = createPluginState("plugins-disable-uncertain");
    cancelPluginDisable(s);
    finishPluginDisable(s);
    enablePlugin(s, "calendar");
    expect(s.disableOperation?.phase).toBe("uncertain");
    expect(canEnablePlugin(s, s.plugins[0])).toBe(false);
    s.disableOperation!.phase = "failed";
    cancelPluginDisable(s);
    expect(s.plugins[0].enabled).toBe(true);
  });
  it("finishes immediately without running actions and resets pending starting states deterministically", () => {
    const s = createPluginState();
    s.plugins.forEach((p) => {
      p.running = 0;
    });
    s.target = "calendar";
    startPluginDisable(s);
    expect(s.disableOperation).toBeNull();
    expect(s.plugins[0].enabled).toBe(false);
    const pending = createPluginState("plugins-disable-waiting");
    finishPluginDisable(pending);
    expect(
      createPluginState("plugins-disable-waiting").disableOperation?.phase,
    ).toBe("waiting");
  });
  it("aborts only affected running work when explicitly selected", () => {
    const s = createPluginState();
    s.target = "weekly";
    disablePlugin(s, true);
    expect(s.plugins[0].running).toBe(1);
    expect(s.plugins[1].running).toBe(0);
  });
  it("preserves working conversations on view closure", () => {
    const s = createPluginState("plugins-development");
    openPluginScreen(s, "list");
    expect(hasPluginWork(s)).toBe(true);
    expect(currentDevelopment(s)?.storageMB).toBe(24);
  });
  it("requires explicit request after reopening interrupted work", () => {
    const s = createPluginState("plugins-development");
    interruptPluginWork(s);
    expect(hasPluginWork(s)).toBe(false);
    openPluginScreen(s, "development");
    applyPluginOutcome(s, "checking");
    expect(currentDevelopment(s)?.phase).toBe("interrupted");
    currentDevelopment(s)!.draft = "Continue with the saved request.";
    sendPluginRequest(s);
    expect(hasPluginWork(s)).toBe(true);
  });
  it("does not adopt before checks and running-action wait", () => {
    const s = createPluginState("plugins-development");
    applyPluginOutcome(s, "adopted");
    expect(currentDevelopment(s)?.phase).toBe("working");
    applyPluginOutcome(s, "waiting");
    expect(currentDevelopment(s)?.phase).toBe("working");
    applyPluginOutcome(s, "failed");
    applyPluginOutcome(s, "adopted");
    expect(s.plugins[1].version).toBe(2);
  });
  it("activates disabled targets after actions finish and removes pending storage", () => {
    const s = createPluginState();
    s.target = "weekly";
    disablePlugin(s);
    s.selected = "weekly";
    startPluginDevelopment(s);
    sendPluginRequest(s);
    applyPluginOutcome(s, "checking");
    applyPluginOutcome(s, "waiting");
    applyPluginOutcome(s, "adopted");
    expect(s.plugins[1].enabled).toBe(false);
    s.plugins[1].running = 0;
    applyPluginOutcome(s, "adopted");
    expect(s.plugins[1].enabled).toBe(true);
    expect(s.plugins[1].version).toBe(3);
    expect(s.plugins[2].enabled).toBe(false);
    expect(currentDevelopment(s)?.storageMB).toBe(0);
    expect(currentDevelopment(s)?.messages).toHaveLength(1);
  });
  it("discards retained work without reversing adopted versions or removing chat", () => {
    const s = createPluginState("plugins-development");
    s.target = s.developmentId;
    discardDevelopment(s);
    expect(hasPluginWork(s)).toBe(false);
    expect(currentDevelopment(s)?.storageMB).toBe(0);
    expect(currentDevelopment(s)?.messages).toHaveLength(1);
    expect(s.plugins[1].version).toBe(2);
  });
  it("retains earlier replies and file browsing across follow-up requests", () => {
    const s = createPluginState("plugins-development");
    const d = currentDevelopment(s)!;
    expect(d.responses).toEqual(["working"]);
    expect(d.codeBrowser.pane).toBe("tree");
    expect(d.codeBrowser.selected).toBe("");
    d.codeBrowser.query = "src";
    d.codeBrowser.selected = "src/index.ts";
    d.filesOpen = false;
    applyPluginOutcome(s, "failed");
    d.draft = "Fix the failed checks.";
    sendPluginRequest(s);
    expect(d.responses).toEqual(["failed", "working"]);
    interruptPluginWork(s);
    expect(d.responses).toEqual(["failed", "interrupted"]);
    d.draft = "Continue.";
    sendPluginRequest(s);
    applyPluginOutcome(s, "checking");
    applyPluginOutcome(s, "waiting");
    applyPluginOutcome(s, "adopted");
    expect(d.responses).toEqual(["failed", "interrupted", "adopted"]);
    expect(d.messages).toHaveLength(3);
    expect(d.filesOpen).toBe(false);
    expect(d.codeBrowser.query).toBe("src");
    expect(d.codeBrowser.selected).toBe("src/index.ts");
    expect(d.storageMB).toBe(0);
  });
  it("starts the creation state without running work or exposing a selected file", () => {
    const s = createPluginState("plugins-create");
    expect(s.screen).toBe("development");
    expect(hasPluginWork(s)).toBe(false);
    expect(currentDevelopment(s)?.responses).toEqual([]);
    expect(currentDevelopment(s)?.filesOpen).toBe(true);
  });
  it("keeps package outcomes and inspection aligned across assignment presets", () => {
    for (const preset of [
      "development",
      "development-reuse",
      "development-missing-connection",
      "development-system-change",
      "development-shared-change",
      "source-success",
    ]) {
      const s = createPluginState(`plugins-${preset}`);
      const d = currentDevelopment(s)!;
      const changed = d.packages.filter((p) => p.change !== "unchanged");
      expect(
        new Set(
          d.inspection.recordedChanges.flatMap((change) =>
            change.packageId ? [change.packageId] : [],
          ),
        ),
      ).toEqual(new Set(changed.map((p) => p.id)));
      for (const change of d.inspection.recordedChanges) {
        if (change.packageId)
          expect(change.packageName).toBe(
            d.packages.find((p) => p.id === change.packageId)?.name,
          );
      }
    }
  });
  it("records newly discovered package files without replacing inspection navigation", () => {
    const s = createPluginState("plugins-development");
    const d = currentDevelopment(s)!;
    d.inspection.changes.query = "notes";
    growAssignment(s);
    expect(d.packages.some((p) => p.id === "weekly")).toBe(true);
    const change = d.inspection.recordedChanges.find(
      (change) => change.packageId === "weekly",
    )!;
    expect(change.provenance.conversationId).toBe(d.id);
    expect(
      d.inspection.workspaceFiles.some(
        (file) => file.identity === change.identity,
      ),
    ).toBe(true);
    expect(d.inspection.changes.query).toBe("notes");
  });
  it("keeps selected-package adaptation from installing unrelated connections", () => {
    const s = createPluginState();
    const original = structuredClone(s.plugins);
    s.selected = "weekly";
    startPluginDevelopment(s);
    sendPluginRequest(s);
    expect(s.plugins).toEqual(original);
    expect(currentDevelopment(s)!.packages.map((p) => p.id)).toEqual([
      "weekly",
      "calendar",
    ]);
  });
  it("keeps assignment access and connector setup in agreement", () => {
    const s = createPluginState("plugins-development-missing-connection");
    const d = currentDevelopment(s)!;
    applyPluginOutcome(s, "checking");
    applyPluginOutcome(s, "waiting");
    applyPluginOutcome(s, "adopted");
    expect(d.packages[0].access).toBe("needed");
    expect(s.connectionAvailability.notes).toBe("permission");
    s.returnToDevelopment = d.id;
    startConnectionAttempt(s, "notes");
    finishConnectionAttempt(s, true);
    expect(d.packages[0].access).toBe("ready");
    expect(s.connectionAvailability.notes).toBe("ready");
    expect(s.returnToDevelopment).toBe(d.id);
    expect(s.accountSelections["notes-view"]).toBeUndefined();
  });
  it("accepts a prepared external request without automatically sending it", () => {
    const s = createPluginState();
    s.selected = "weekly";
    startPluginDevelopment(s, "Build a reading list.");
    expect(currentDevelopment(s)?.pluginId).toBeNull();
    expect(currentDevelopment(s)?.draft).toBe("Build a reading list.");
    expect(hasPluginWork(s)).toBe(false);
    sendPluginRequest(s);
    applyPluginOutcome(s, "checking");
    applyPluginOutcome(s, "waiting");
    applyPluginOutcome(s, "adopted");
    expect(s.plugins).toHaveLength(createPluginState().plugins.length + 2);
  });
});
