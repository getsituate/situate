import c from "../localization/en.assignment-files.json" with { type: "json" };

export type InspectionMode = "changes" | "files";
export type InspectionGroup = "connection" | "plugin" | "workspace";
export type InspectionStatus = "ready" | "loading" | "error" | "empty";
export interface InspectionRevision {
  revision: string;
  path: string;
  status: "available" | "unavailable" | "unsupported";
  text: string;
}
export interface AssignmentChange {
  id: string;
  identity: string;
  group: InspectionGroup;
  packageId: string | null;
  packageName: string;
  operation: "added" | "modified" | "deleted" | "renamed";
  before: InspectionRevision | null;
  after: InspectionRevision | null;
  provenance: {
    attribution: "recorded" | "uncertain";
    source: "write" | "shell" | "external";
    conversationId: string | null;
    runId: string | null;
  };
  packageRevision?: number;
  disposition:
    "pending" | "active" | "written" | "removed" | "previous" | "superseded";
}
export interface InspectionFile {
  identity: string;
  group: InspectionGroup;
  packageId: string | null;
  current: InspectionRevision;
}
export interface InspectionNavigation {
  selected: string;
  page?: number;
  query: string;
  pane: "tree" | "file";
  expanded: string[];
  listScroll: number;
  fileScroll: number;
  view: "comparison" | "before" | "after";
  status: InspectionStatus;
}
export interface AssignmentInspectionState {
  mode: InspectionMode;
  expanded?: boolean;
  changes: InspectionNavigation;
  files: InspectionNavigation;
  recordedChanges: AssignmentChange[];
  observations: AssignmentChange[];
  workspaceFiles: InspectionFile[];
  unchangedPackages: {
    id: string;
    name: string;
    group: InspectionGroup;
    revision: string;
  }[];
}
const navigation = (): InspectionNavigation => ({
  selected: "",
  query: "",
  pane: "tree",
  expanded: [],
  listScroll: 0,
  fileScroll: 0,
  view: "comparison",
  status: "ready",
});
const revision = (
  path: string,
  text: string,
  id: string,
): InspectionRevision => ({
  path,
  text,
  revision: id,
  status: "available",
});
export function changePath(change: AssignmentChange): string {
  return (change.after ?? change.before)?.path ?? "";
}
export function inspectionChanges(
  state: AssignmentInspectionState,
): AssignmentChange[] {
  const query = state.changes.query.trim().toLowerCase();
  return [...state.recordedChanges, ...state.observations]
    .filter((change) =>
      [change.before?.path, change.after?.path].some((value) =>
        value?.toLowerCase().includes(query),
      ),
    )
    .sort((a, b) =>
      changePath(a).localeCompare(changePath(b), "en", { numeric: true }),
    );
}
export function makeSelectedHistoryUnavailable(
  state: AssignmentInspectionState,
): void {
  const changes = [...state.recordedChanges, ...state.observations];
  const selected =
    changes.find((entry) => entry.id === state.changes.selected) ?? changes[0];
  if (!selected) return;
  for (const revision of [selected.before, selected.after]) {
    if (revision) {
      revision.status = "unavailable";
      revision.text = "";
    }
  }
  state.mode = "changes";
  state.changes.selected = selected.id;
  state.changes.pane = "file";
  state.changes.status = "ready";
}
export function addInspectionStressChanges(
  state: AssignmentInspectionState,
): void {
  for (let index = 1; index <= 500; index++) {
    const id = `review-${index}`;
    if (state.recordedChanges.some((entry) => entry.id === id)) continue;
    const after = revision(
      `Notes/Weekly reviews/Review ${index}.md`,
      c.fixtures.noteAfter,
      `${id}-r2`,
    );
    state.recordedChanges.push({
      id,
      identity: `file-${id}`,
      group: "workspace",
      packageId: null,
      packageName: "",
      operation: "modified",
      before: revision(after.path, c.fixtures.noteBefore, `${id}-r1`),
      after,
      provenance: {
        attribution: "recorded",
        source: "write",
        conversationId: "assignment-notes",
        runId: "run-1",
      },
      disposition: "written",
    });
    state.workspaceFiles.push({
      identity: `file-${id}`,
      group: "workspace",
      packageId: null,
      current: { ...after },
    });
  }
}
export function addInspectionLongDiff(state: AssignmentInspectionState): void {
  const id = "long-diff";
  if (!state.recordedChanges.some((change) => change.id === id)) {
    const before = Array.from(
      { length: 1200 },
      (_, index) => `export const value${index + 1} = ${index + 1};`,
    );
    const after = [...before];
    after[20] = "export const value21 = 42;";
    after[900] = "export const value901 = 1802;";
    const path = ".situate/plugins/notes/code/src/preferences.ts";
    state.recordedChanges.push({
      id,
      identity: "file-long-diff",
      group: "connection",
      packageId: "notes",
      packageName: c.packages.notes,
      operation: "modified",
      before: revision(path, before.join("\n") + "\n", "preferences-r1"),
      after: revision(path, after.join("\n") + "\n", "preferences-r2"),
      provenance: {
        attribution: "recorded",
        source: "write",
        conversationId: "assignment-notes",
        runId: "run-1",
      },
      disposition: "pending",
    });
  }
  state.changes.selected = id;
  state.changes.pane = "file";
  state.changes.status = "ready";
}
export function createAssignmentInspection(
  preset = "plugins-development",
): AssignmentInspectionState {
  const f = c.fixtures;
  const state: AssignmentInspectionState = {
    mode: "changes",
    changes: navigation(),
    files: navigation(),
    recordedChanges: [],
    observations: [],
    workspaceFiles: [],
    unchangedPackages: [],
  };
  const connectionPath = ".situate/plugins/notes/code/src/index.ts";
  const add = (
    id: string,
    group: InspectionGroup,
    packageId: string | null,
    packageName: string,
    operation: AssignmentChange["operation"],
    before: InspectionRevision | null,
    after: InspectionRevision | null,
  ) => {
    state.recordedChanges.push({
      id,
      identity: `file-${id}`,
      group,
      packageId,
      packageName,
      operation,
      before,
      after,
      provenance: {
        attribution: "recorded",
        source: "write",
        conversationId: "assignment-notes",
        runId: "run-1",
      },
      disposition: group === "workspace" ? "written" : "pending",
    });
  };
  const reuse = preset === "plugins-development-reuse";
  const newConnection = [
    "plugins-development-missing-connection",
    "plugins-development-connection-only",
    "plugins-source-create",
    "documents-connect",
  ].includes(preset);
  const empty = ["plugins-create", "plugins-development-empty"].includes(
    preset,
  );
  if (!empty) {
    if (!reuse)
      add(
        "notes",
        "connection",
        "notes",
        c.packages.notes,
        newConnection ? "added" : "modified",
        newConnection
          ? null
          : revision(connectionPath, f.connectionBefore, "notes-r1"),
        revision(connectionPath, f.connectionAfter, "notes-r2"),
      );
    if (preset !== "plugins-development-connection-only")
      add(
        "view",
        "plugin",
        "notes-view",
        c.packages.view,
        "added",
        null,
        revision(
          ".situate/plugins/notes-view/code/src/index.ts",
          f.view,
          "view-r1",
        ),
      );
    if (
      [
        "plugins-development-shared-change",
        "plugins-development-system-change",
      ].includes(preset)
    ) {
      add(
        "digest",
        "plugin",
        "notes-digest",
        c.packages.digest,
        "modified",
        revision(
          ".situate/plugins/notes-digest/code/src/index.ts",
          f.view,
          "digest-r1",
        ),
        revision(
          ".situate/plugins/notes-digest/code/src/index.ts",
          f.digest,
          "digest-r2",
        ),
      );
    }
    if (preset === "plugins-development-system-change")
      add(
        "calendar",
        "connection",
        "calendar",
        c.packages.calendar,
        "modified",
        revision(
          ".situate/plugins/calendar/code/src/index.ts",
          f.calendar,
          "calendar-r1",
        ),
        revision(
          ".situate/plugins/calendar/code/src/index.ts",
          `${f.calendar}export const limit = 20;\n`,
          "calendar-r2",
        ),
      );
    if (
      [
        "plugins-development-changes",
        "plugins-development-system-change",
        "plugins-development-activation",
        "plugins-success",
        "plugins-source-success",
      ].includes(preset)
    ) {
      add(
        "review",
        "workspace",
        null,
        "",
        "modified",
        revision("Notes/Weekly review.md", f.noteBefore, "review-r1"),
        revision("Notes/Weekly review.md", f.noteAfter, "review-r2"),
      );
      add(
        "legacy",
        "plugin",
        "notes-view",
        c.packages.view,
        "deleted",
        revision(
          ".situate/plugins/notes-view/code/src/legacy.ts",
          f.old,
          "legacy-r1",
        ),
        null,
      );
      add(
        "manifest",
        "connection",
        "notes",
        c.packages.notes,
        "renamed",
        revision(
          ".situate/plugins/notes/code/plugin.json",
          f.manifest,
          "manifest-r1",
        ),
        revision(
          ".situate/plugins/notes/code/manifest.json",
          f.manifest,
          "manifest-r2",
        ),
      );
    }
  }
  if (reuse)
    state.unchangedPackages.push({
      id: "notes",
      name: c.packages.notes,
      group: "connection",
      revision: "notes-r1",
    });
  state.workspaceFiles = [
    {
      identity: "file-notes",
      group: "connection",
      packageId: "notes",
      current: revision(
        connectionPath,
        reuse || empty ? f.connectionBefore : f.connectionAfter,
        reuse || empty ? "notes-r1" : "notes-r2",
      ),
    },
    {
      identity: "file-planning",
      group: "plugin",
      packageId: "planning",
      current: revision(
        ".situate/plugins/planning/code/src/index.ts",
        f.planning,
        "planning-r1",
      ),
    },
    {
      identity: "file-reading",
      group: "workspace",
      packageId: null,
      current: revision("Notes/Reading list.md", f.readme, "reading-r1"),
    },
    {
      identity: "file-image",
      group: "workspace",
      packageId: null,
      current: {
        ...revision("Documents/Garden.pdf", "", "garden-r1"),
        status: "unsupported",
      },
    },
    {
      identity: "file-unavailable",
      group: "workspace",
      packageId: null,
      current: {
        ...revision("Notes/Archive.md", "", "archive-r1"),
        status: "unavailable",
      },
    },
  ];
  for (const change of state.recordedChanges) {
    if (!change.after) continue;
    const file: InspectionFile = {
      identity: change.identity,
      group: change.group,
      packageId: change.packageId,
      current: { ...change.after },
    };
    const existing = state.workspaceFiles.findIndex(
      (entry) => entry.identity === file.identity,
    );
    if (existing >= 0) state.workspaceFiles[existing] = file;
    else state.workspaceFiles.push(file);
  }
  if (preset === "plugins-development-parallel") {
    state.workspaceFiles.find(
      (file) => file.identity === "file-notes",
    )!.current = revision(connectionPath, f.connectionLater, "notes-r3");
    state.observations.push({
      id: "observed-notes",
      identity: "file-notes",
      group: "connection",
      packageId: "notes",
      packageName: c.packages.notes,
      operation: "modified",
      before: revision(connectionPath, f.connectionAfter, "notes-r2"),
      after: revision(connectionPath, f.connectionLater, "notes-r3"),
      provenance: {
        attribution: "uncertain",
        source: "shell",
        conversationId: null,
        runId: null,
      },
      disposition: "pending",
    });
  }
  if (["plugins-success", "plugins-source-success"].includes(preset)) {
    for (const change of state.recordedChanges)
      if (change.group !== "workspace") change.disposition = "active";
  }
  return state;
}
