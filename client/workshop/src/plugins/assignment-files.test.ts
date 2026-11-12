import { describe, expect, it } from "vitest";
import {
  createAssignmentInspection,
  inspectionChanges,
} from "./assignment-files";

describe("assignment inspection fixtures", () => {
  it("starts a new assignment without equating empty changes with an empty workspace", () => {
    const state = createAssignmentInspection("plugins-create");
    expect(state.mode).toBe("changes");
    expect(state.recordedChanges).toEqual([]);
    expect(state.workspaceFiles.map((file) => file.current.path)).toContain(
      "Notes/Reading list.md",
    );
  });
  it("reuses a connection without recording a modification", () => {
    const state = createAssignmentInspection("plugins-development-reuse");
    expect(state.recordedChanges.map((change) => change.packageId)).toEqual([
      "notes-view",
    ]);
    expect(state.unchangedPackages).toContainEqual({
      id: "notes",
      name: "Notes connection",
      group: "connection",
      revision: "notes-r1",
    });
    expect(
      state.workspaceFiles.find((file) => file.packageId === "notes")?.current
        .revision,
    ).toBe("notes-r1");
  });
  it("keeps original identity and both historical paths for renames and deletions", () => {
    const state = createAssignmentInspection("plugins-development-changes");
    expect(state.recordedChanges.map((entry) => entry.operation)).toEqual([
      "modified",
      "added",
      "modified",
      "deleted",
      "renamed",
    ]);
    const renamed = state.recordedChanges.find(
      (entry) => entry.operation === "renamed",
    )!;
    expect(renamed.identity).toBe("file-manifest");
    expect(renamed.before?.path).toBe(
      ".situate/plugins/notes/code/plugin.json",
    );
    expect(renamed.after?.path).toBe(
      ".situate/plugins/notes/code/manifest.json",
    );
    state.changes.query = "plugin.json";
    expect(inspectionChanges(state).map((entry) => entry.id)).toEqual([
      "manifest",
    ]);
    const deleted = state.recordedChanges.find(
      (entry) => entry.operation === "deleted",
    )!;
    expect(deleted.before?.text).toBe("export const legacy = true;\n");
    expect(deleted.after).toBeNull();
    expect(
      state.workspaceFiles.some((file) => file.identity === deleted.identity),
    ).toBe(false);
  });
  it("does not substitute later contents or uncertain observations for attributed revisions", () => {
    const state = createAssignmentInspection("plugins-development-parallel");
    const record = state.recordedChanges.find((entry) => entry.id === "notes")!;
    expect(record.before?.revision).toBe("notes-r1");
    expect(record.after?.revision).toBe("notes-r2");
    expect(record.provenance).toEqual({
      attribution: "recorded",
      source: "write",
      conversationId: "assignment-notes",
      runId: "run-1",
    });
    expect(state.observations[0].provenance).toEqual({
      attribution: "uncertain",
      source: "shell",
      conversationId: null,
      runId: null,
    });
    const current = state.workspaceFiles.find(
      (file) => file.identity === record.identity,
    )!;
    expect(current.current.revision).toBe("notes-r3");
    expect(current.current.text).not.toBe(record.after?.text);
    current.current.text = "Later edit";
    expect(record.after?.text).toBe(
      "export const listNotes = ({ limit = 20 } = {}) => [];\n",
    );
  });
  it.each([
    "connection-only",
    "reuse",
    "missing-connection",
    "shared-change",
    "system-change",
    "parallel",
    "changes",
    "workspace-files",
    "activation",
    "access-needed",
  ])("provides serializable independent %s snapshots", (preset) => {
    const id = `plugins-development-${preset}`;
    const state = createAssignmentInspection(id);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    state.changes.query = "mutated";
    expect(createAssignmentInspection(id).changes.query).toBe("");
    expect(
      state.workspaceFiles.some((file) => file.packageId === "planning"),
    ).toBe(true);
    expect(
      state.workspaceFiles.map((file) => file.current.path).join(" "),
    ).not.toMatch(/credential|runtime|token|account/i);
  });
  it("separates connection-only, shared and system assignments", () => {
    expect(
      createAssignmentInspection(
        "plugins-development-connection-only",
      ).recordedChanges.map((entry) => entry.group),
    ).toEqual(["connection"]);
    expect(
      createAssignmentInspection(
        "plugins-development-missing-connection",
      ).recordedChanges.map((entry) => entry.operation),
    ).toEqual(["added", "added"]);
    expect(
      createAssignmentInspection(
        "plugins-development-shared-change",
      ).recordedChanges.map((entry) => entry.packageId),
    ).toEqual(["notes", "notes-view", "notes-digest"]);
    const system = createAssignmentInspection(
      "plugins-development-system-change",
    );
    expect(
      system.recordedChanges.some((entry) => entry.packageId === "calendar"),
    ).toBe(true);
    expect(
      system.recordedChanges.find((entry) => entry.group === "workspace")
        ?.disposition,
    ).toBe("written");
  });
  it.each([
    "plugins-development",
    "plugins-interrupted",
    "plugins-error",
    "plugins-success",
    "plugins-source-create",
    "plugins-source-error",
    "plugins-source-success",
    "documents-connect",
  ])("retains inspection for %s", (preset) => {
    expect(
      createAssignmentInspection(preset).recordedChanges.length,
    ).toBeGreaterThan(0);
  });
});
