import { describe, expect, it } from "vitest";
import {
  activateAssignment,
  assignmentPackage,
  editAssignmentPackage,
  emptyAssignmentCheck,
  finishAssignmentChecks,
  growAssignment,
  initializeAssignment,
  removePendingAssignmentCode,
  resolveAssignmentActivation,
  startAssignmentChecks,
} from "./assignment-model";
import { pluginFixtures } from "./fixtures";
import { createAssignmentInspection } from "./assignment-files";
import {
  createPluginState,
  currentDevelopment,
  sendPluginRequest,
  type Development,
  type PluginState,
} from "./model";

function setup(preset = "plugins-development") {
  const d = {
    id: "example",
    inspection: createAssignmentInspection("plugins-create"),
    packages: [],
    workspaceEffects: [],
    check: emptyAssignmentCheck(),
    activation: "pending",
    phase: "working",
    messages: ["Build a reading view"],
    responses: ["working"],
    storageMB: 24,
  } as unknown as Development;
  const s = {
    plugins: structuredClone(pluginFixtures),
    developments: [d],
    developmentId: d.id,
    accounts: {},
    accountSelections: {},
    connectionAvailability: {},
  } as unknown as PluginState;
  initializeAssignment(s, d, preset);
  return { s, d };
}
function check(d: Development) {
  startAssignmentChecks(d);
  finishAssignmentChecks(d);
}

describe("assignment package outcomes", () => {
  it("publishes connection and consumer together without undoing ordinary writes", () => {
    const { s, d } = setup();
    const effects = structuredClone(d.workspaceEffects);
    startAssignmentChecks(d);
    finishAssignmentChecks(d, d.packages[1].id);
    activateAssignment(s);
    expect(s.plugins).toHaveLength(4);
    expect(d.check.failedPackageId).toBe("notes-view");
    expect(d.packages.map((p) => p.activation)).toEqual(["pending", "pending"]);
    expect(d.workspaceEffects).toEqual(effects);
    check(d);
    activateAssignment(s);
    expect(d.packages.map((p) => p.activation)).toEqual(["active", "active"]);
    expect(s.plugins.find((p) => p.id === "notes-view")?.dependencies).toEqual([
      "notes",
    ]);
    expect(d.workspaceEffects).toEqual(effects);
  });
  it("reuses connection code and accounts without making consumer account choices", () => {
    const { s, d } = setup("plugins-development-reuse");
    const connection = s.plugins.find((p) => p.id === "notes")!;
    s.accounts.notes = [
      { id: "personal", name: "Example", status: "connected" },
    ];
    check(d);
    activateAssignment(s);
    expect(connection.version).toBe(1);
    expect(d.packages[0].activation).toBe("unchanged");
    expect(s.accounts.notes).toHaveLength(1);
    expect(s.accountSelections).toEqual({ "notes-digest": ["notes-example"] });
    expect(
      s.plugins.filter((p) => p.dependencies.includes("notes")),
    ).toHaveLength(2);
  });
  it("waits for all affected actions and never aborts them", () => {
    const { s, d } = setup("plugins-development-system-change");
    check(d);
    activateAssignment(s);
    expect(d.activation).toBe("waiting");
    expect(s.plugins.map((p) => p.version)).toEqual([1, 2, 1, 1, 1, 1]);
    expect(s.plugins.map((p) => p.running)).toEqual([1, 1, 0, 0, 0, 0]);
    s.plugins.forEach((p) => (p.running = 0));
    activateAssignment(s);
    expect(s.plugins.map((p) => p.version)).toEqual([2, 2, 1, 2, 2, 2]);
  });
  it("invalidates checked revisions when packages change or the affected set grows", () => {
    const { s, d } = setup();
    check(d);
    editAssignmentPackage(d, d.packages[0].id);
    activateAssignment(s);
    expect(d.check.status).toBe("pending");
    expect(s.plugins).toHaveLength(4);
    check(d);
    growAssignment(s);
    expect(d.packages.map((p) => p.id)).toEqual([
      "notes",
      "notes-view",
      "weekly",
      "calendar",
    ]);
    expect(d.check.status).toBe("pending");
  });
  it("requires fresh evidence for changed reused dependency revisions", () => {
    const { s, d } = setup("plugins-development-reuse");
    check(d);
    s.plugins.find((p) => p.id === "notes")!.version++;
    activateAssignment(s);
    expect(d.check.status).toBe("pending");
    expect(d.check.detail).not.toBe("");
    expect(s.plugins).toHaveLength(5);
  });
  it.each(["uncertain", "notification-failure"] as const)(
    "does not blindly retry %s publication",
    (outcome) => {
      const { s, d } = setup();
      check(d);
      activateAssignment(s, outcome);
      const plugins = structuredClone(s.plugins);
      startAssignmentChecks(d);
      activateAssignment(s);
      expect(s.plugins).toEqual(plugins);
      expect(d.activation).toBe(
        outcome === "uncertain" ? "uncertain" : "notification-failed",
      );
      expect(d.packages[0].activation).toBe(
        outcome === "uncertain" ? "pending" : "active",
      );
    },
  );
  it.each([true, false])(
    "resolves uncertain publication from an inspection: active=%s",
    (active) => {
      const { s, d } = setup();
      check(d);
      activateAssignment(s, "uncertain");
      const evidence = structuredClone(d.check);
      resolveAssignmentActivation(s, active);
      expect(d.check).toEqual(evidence);
      expect(d.activation).toBe(active ? "active" : "ready");
      expect(s.plugins.some((p) => p.id === "notes-view")).toBe(active);
      const versions = s.plugins.map((p) => p.version);
      resolveAssignmentActivation(s, !active);
      expect(s.plugins.map((p) => p.version)).toEqual(versions);
    },
  );
  it("retains uncertain candidates and only cleans known pending code", () => {
    const { s, d } = setup();
    const effects = structuredClone(d.workspaceEffects);
    check(d);
    activateAssignment(s, "uncertain");
    removePendingAssignmentCode(d);
    expect(d.storageMB).toBe(24);
    expect(d.phase).toBe("interrupted");
    const pending = setup();
    removePendingAssignmentCode(pending.d);
    expect(pending.d.packages.every((p) => p.activation === "removed")).toBe(
      true,
    );
    expect(pending.d.workspaceEffects).toEqual(effects);
    expect(pending.d.messages).toHaveLength(1);
  });
  it("keeps access setup independent of synthetic code checks", () => {
    const { s, d } = setup("plugins-development-access-needed");
    check(d);
    activateAssignment(s);
    expect(d.activation).toBe("active");
    expect(d.packages[0].access).toBe("needed");
    expect(s.connectionAvailability.notes).toBe("permission");
  });
  it("supports one changed package and independent overlapping assignments", () => {
    const { s, d } = setup();
    d.packages = [assignmentPackage(s.plugins[1])];
    s.plugins.forEach((p) => (p.running = 0));
    check(d);
    const other = {
      ...d,
      id: "other",
      packages: structuredClone(d.packages),
      check: structuredClone(d.check),
    };
    s.developments.push(other);
    activateAssignment(s);
    s.developmentId = other.id;
    activateAssignment(s);
    expect(other.activation).toBe("active");
    expect(s.developments).toHaveLength(2);
  });
});

describe("recorded assignment revisions", () => {
  it("preserves earlier comparisons while a follow-up writes a new current revision", () => {
    const state = createPluginState("plugins-success");
    const d = currentDevelopment(state)!;
    const first = d.inspection.recordedChanges.find(
      (change) => change.packageId === "notes",
    )!;
    const original = structuredClone(first);
    d.draft = "Use a larger limit.";
    sendPluginRequest(state);
    expect(first.before).toEqual(original.before);
    expect(first.after).toEqual(original.after);
    expect(first.provenance).toEqual(original.provenance);
    const latest = d.inspection.recordedChanges
      .filter((change) => change.packageId === "notes")
      .at(-1)!;
    expect(latest.before).toEqual(original.after);
    expect(latest.after?.revision).not.toBe(original.after?.revision);
    expect(latest.after?.text).not.toBe(original.after?.text);
    expect(
      d.inspection.workspaceFiles.find(
        (file) => file.identity === first.identity,
      )?.current,
    ).toEqual(latest.after);
    check(d);
    activateAssignment(state);
    expect(first.disposition).toBe("previous");
    expect(latest.disposition).toBe("active");
  });
  it("gives overlapping conversations distinct records and retains uncertain observations", () => {
    const state = createPluginState("plugins-development-parallel");
    const [first, second] = state.developments;
    const a = first.inspection.recordedChanges.find(
      (change) => change.packageId === "notes",
    )!;
    const b = second.inspection.recordedChanges.find(
      (change) => change.packageId === "notes",
    )!;
    expect(b.before).toEqual(a.after);
    expect(b.after?.revision).not.toBe(a.after?.revision);
    expect(a.provenance.conversationId).toBe(first.id);
    expect(b.provenance.conversationId).toBe(second.id);
    expect(first.inspection.observations[0].provenance.attribution).toBe(
      "uncertain",
    );
    expect(
      first.inspection.workspaceFiles.find(
        (file) => file.identity === a.identity,
      )?.current,
    ).toEqual(b.after);
  });
  it("normalizes new package revisions in history and current contents together", () => {
    const state = createPluginState("plugins-development-missing-connection");
    const d = currentDevelopment(state)!;
    const record = d.inspection.recordedChanges.find(
      (change) => change.packageId === "notes",
    )!;
    expect(
      d.inspection.workspaceFiles.find(
        (file) => file.identity === record.identity,
      )?.current,
    ).toEqual(record.after);
  });
  it("shares later workspace writes without changing another assignment's recorded history", () => {
    const state = createPluginState("plugins-development-parallel");
    const [first, second] = state.developments;
    const history = structuredClone(first.inspection.recordedChanges);
    state.developmentId = second.id;
    check(second);
    activateAssignment(state);
    second.draft = "Increase the limit again.";
    sendPluginRequest(state);
    expect(first.inspection.recordedChanges).toEqual(history);
    expect(
      first.inspection.workspaceFiles.find(
        (file) => file.identity === "file-notes",
      )?.current,
    ).toEqual(
      second.inspection.workspaceFiles.find(
        (file) => file.identity === "file-notes",
      )?.current,
    );
    expect(
      first.inspection.workspaceFiles.find(
        (file) => file.identity === "file-notes",
      )?.current.revision,
    ).toBe("notes-r4");
  });
  it("accepts an inspection request without repeating uncertain publication", () => {
    const state = createPluginState("plugins-development-activation");
    const d = currentDevelopment(state)!;
    activateAssignment(state, "uncertain");
    const packages = structuredClone(state.plugins);
    const evidence = structuredClone(d.check);
    d.draft = "Check which revisions are active.";
    sendPluginRequest(state);
    expect(d.messages.at(-1)).toBe("Check which revisions are active.");
    expect(d.draft).toBe("");
    expect(d.activation).toBe("uncertain");
    expect(d.check).toEqual(evidence);
    expect(state.plugins).toEqual(packages);
  });
  it("waits for an unchanged transitive consumer of a changed connection", () => {
    const state = createPluginState("plugins-development-system-change");
    const d = currentDevelopment(state)!;
    state.plugins.forEach((p) => {
      p.running = p.id === "morning" ? 1 : 0;
    });
    check(d);
    activateAssignment(state);
    expect(d.activation).toBe("waiting");
    expect(state.plugins.find((p) => p.id === "morning")!.running).toBe(1);
    expect(d.packages.every((p) => p.activation !== "active")).toBe(true);
  });
  it("removes pending contents without deleting ordinary files or earlier history", () => {
    const state = createPluginState("plugins-development-changes");
    const d = currentDevelopment(state)!;
    const files = structuredClone(d.inspection.workspaceFiles);
    const effects = structuredClone(d.workspaceEffects);
    removePendingAssignmentCode(d);
    expect(d.inspection.workspaceFiles).toEqual(files);
    expect(d.workspaceEffects).toEqual(effects);
    expect(
      d.inspection.recordedChanges
        .filter((change) => change.packageId)
        .every((change) => change.disposition === "removed"),
    ).toBe(true);
    expect(
      d.inspection.recordedChanges
        .filter((change) => !change.packageId)
        .every((change) => change.after?.status === "available"),
    ).toBe(true);
  });
});
