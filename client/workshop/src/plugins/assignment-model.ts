import text from "../localization/en.assignment-model.json" with { type: "json" };
import {
  newConnectorFixture,
  newPluginFixture,
  newSourceFixture,
} from "./fixtures";
import type { Development, Plugin, PluginState } from "./model";
import type { AssignmentChange, InspectionFile } from "./assignment-files";

export interface AssignmentPackage {
  id: string;
  name: string;
  kind: Plugin["kind"];
  change: "added" | "modified" | "unchanged";
  revision: number;
  activeRevision: number | null;
  dependencies: string[];
  check: "pending" | "running" | "passed" | "failed";
  activation: "pending" | "active" | "unchanged" | "removed";
  access: "ready" | "needed";
}
export interface AssignmentCheck {
  status: "pending" | "running" | "passed" | "failed";
  revisions: Record<string, number>;
  failedPackageId: string | null;
  detail: string;
}
export type AssignmentActivation =
  | "pending"
  | "ready"
  | "waiting"
  | "failed"
  | "uncertain"
  | "active"
  | "notification-failed";
export interface WorkspaceEffect {
  path: string;
  status: "written";
  attribution: "recorded" | "uncertain";
}
export const emptyAssignmentCheck = (): AssignmentCheck => ({
  status: "pending",
  revisions: {},
  failedPackageId: null,
  detail: "",
});
export function assignmentPackage(
  plugin: Plugin,
  change: AssignmentPackage["change"] = "modified",
): AssignmentPackage {
  return {
    id: plugin.id,
    name: plugin.name,
    kind: plugin.kind,
    change,
    revision: plugin.version + (change === "unchanged" ? 0 : 1),
    activeRevision: change === "added" ? null : plugin.version,
    dependencies: [...plugin.dependencies],
    check: "pending",
    activation: change === "unchanged" ? "unchanged" : "pending",
    access: "ready",
  };
}
export function initializeAssignment(
  s: PluginState,
  d: Development,
  preset = "plugins-development",
) {
  const existing = (
    id: string,
    change: AssignmentPackage["change"] = "modified",
  ) =>
    assignmentPackage(
      s.plugins.find((p) => p.id === id)!,
      change,
    );
  if (
    preset.endsWith("single-package") ||
    (d.pluginId && preset === "entry-context")
  ) {
    const p = existing(d.pluginId ?? "weekly");
    d.packages = [p, ...p.dependencies.map((id) => existing(id, "unchanged"))];
    d.title = p.name;
    d.workspaceEffects = [];
    return;
  }
  const missing =
    preset.endsWith("missing-connection") ||
    preset.endsWith("connection-only") ||
    preset.endsWith("access-needed") ||
    d.kind === "source" ||
    d.kind === "connector";
  if (!missing && !s.plugins.some((p) => p.id === "notes")) {
    s.plugins.push({ ...newConnectorFixture, id: "notes", version: 1 });
    s.accounts.notes = [
      { id: "notes-example", name: text.exampleAccount, status: "connected" },
    ];
  }
  if (
    ["reuse", "shared-change", "system-change"].some((suffix) =>
      preset.endsWith(suffix),
    ) &&
    !s.plugins.some((p) => p.id === "notes-digest")
  ) {
    s.plugins.push({
      ...newPluginFixture,
      id: "notes-digest",
      name: text.digestName,
      version: 1,
      dependencies: ["notes"],
    });
    s.accountSelections["notes-digest"] = ["notes-example"];
  }
  const connection = missing
    ? assignmentPackage({ ...newConnectorFixture, id: "notes" }, "added")
    : existing("notes");
  connection.access = missing ? "needed" : "ready";
  const existingView =
    ["shared-change", "system-change", "changes", "activation"].some((suffix) =>
      preset.endsWith(suffix),
    ) || preset === "plugins-success";
  if (existingView && !s.plugins.some((p) => p.id === "notes-view"))
    s.plugins.push({
      ...newPluginFixture,
      id: "notes-view",
      name: text.viewName,
      version: 1,
      dependencies: [connection.id],
    });
  const consumer = existingView
    ? existing("notes-view")
    : assignmentPackage(
        {
          ...newPluginFixture,
          id: "notes-view",
          name: text.viewName,
          dependencies: [connection.id],
        },
        "added",
      );
  d.title = text.title;
  d.packages = [connection, consumer];
  d.workspaceEffects = [
    { path: text.guidePath, status: "written", attribution: "recorded" },
  ];
  if (preset.endsWith("connection-only") || d.kind === "connector") {
    d.packages = [connection];
    d.title = text.connectionTitle;
  } else if (preset.endsWith("reuse")) {
    d.packages = [
      existing("notes", "unchanged"),
      existing("notes-digest", "unchanged"),
      consumer,
    ];
    d.title = text.reuseTitle;
  } else if (
    preset.endsWith("shared-change") ||
    preset.endsWith("system-change")
  ) {
    if (!s.plugins.some((p) => p.id === "notes-digest"))
      s.plugins.push({
        ...newPluginFixture,
        id: "notes-digest",
        name: text.digestName,
        version: 1,
        dependencies: ["notes"],
      });
    const digest = s.plugins.find((p) => p.id === "notes-digest")!;
    digest.dependencies = ["notes", "calendar"];
    d.packages = [
      connection,
      consumer,
      existing("notes-digest"),
      existing(
        "calendar",
        preset.endsWith("system-change") ? "modified" : "unchanged",
      ),
    ];
    d.title = preset.endsWith("system-change")
      ? text.systemTitle
      : text.sharedTitle;
    d.workspaceEffects = [
      { path: text.conventionPath, status: "written", attribution: "recorded" },
    ];
  } else if (d.kind === "source") {
    d.packages[1] = assignmentPackage(
      { ...newSourceFixture, id: "notes-view", dependencies: [connection.id] },
      "added",
    );
  }
  if (preset.endsWith("access-needed")) connection.access = "needed";
  if (connection.access === "needed")
    s.connectionAvailability.notes = "permission";
}
function phase(d: Development, value: Development["phase"]) {
  d.phase = value;
  if (d.messages.length) d.responses[d.messages.length - 1] = value;
}
function canPrepare(d: Development) {
  return (
    !["uncertain", "active", "notification-failed"].includes(d.activation) &&
    d.phase !== "discarded"
  );
}
export function editAssignmentPackage(d: Development, id: string) {
  const p = d.packages.find((p) => p.id === id);
  if (!p || !canPrepare(d)) return;
  p.revision++;
  if (p.change === "unchanged") p.change = "modified";
  p.activation = "pending";
  invalidateAssignment(d);
  syncAssignmentInspection(d);
}
function invalidateAssignment(d: Development) {
  d.check = emptyAssignmentCheck();
  d.activation = "pending";
  for (const p of d.packages) p.check = "pending";
  phase(d, "working");
}
export function growAssignment(s: PluginState) {
  const d = s.developments.find((d) => d.id === s.developmentId);
  if (!d || !canPrepare(d)) return;
  const plugin = s.plugins.find(
    (p) => !d.packages.some((item) => item.id === p.id) && p.kind === "tool",
  );
  if (!plugin) return;
  const previousFiles = JSON.parse(JSON.stringify(d.inspection.workspaceFiles));
  d.packages.push(assignmentPackage(plugin));
  for (const id of plugin.dependencies) {
    if (!d.packages.some((p) => p.id === id)) {
      const dep = s.plugins.find((p) => p.id === id);
      if (dep) d.packages.push(assignmentPackage(dep, "unchanged"));
    }
  }
  invalidateAssignment(d);
  syncAssignmentInspection(d);
  shareAssignmentWrites(s, d, previousFiles);
}
export function startAssignmentChecks(d: Development) {
  if (!canPrepare(d) || !d.packages.length) return;
  d.check = {
    ...emptyAssignmentCheck(),
    status: "running",
    revisions: Object.fromEntries(d.packages.map((p) => [p.id, p.revision])),
  };
  for (const p of d.packages) p.check = "running";
  d.activation = "pending";
  phase(d, "checking");
}
export function finishAssignmentChecks(
  d: Development,
  failedPackageId?: string,
) {
  if (d.check.status !== "running") return;
  if (failedPackageId && !d.packages.some((p) => p.id === failedPackageId))
    return;
  d.check.status = failedPackageId ? "failed" : "passed";
  d.check.failedPackageId = failedPackageId ?? null;
  d.check.detail = failedPackageId ? text.checkFailure : "";
  for (const p of d.packages)
    p.check = p.id === failedPackageId ? "failed" : "passed";
  d.activation = failedPackageId ? "pending" : "ready";
  phase(d, failedPackageId ? "failed" : "waiting");
}
export function assignmentAffectedIds(s: PluginState, d: Development) {
  const ids = new Set(
    d.packages.filter((p) => p.change !== "unchanged").map((p) => p.id),
  );
  let previous = -1;
  while (previous !== ids.size) {
    previous = ids.size;
    for (const plugin of s.plugins)
      if (plugin.dependencies.some((id) => ids.has(id))) ids.add(plugin.id);
  }
  return ids;
}
export function activateAssignment(
  s: PluginState,
  outcome:
    "success" | "failure" | "uncertain" | "notification-failure" = "success",
) {
  const d = s.developments.find((d) => d.id === s.developmentId);
  if (
    !d ||
    d.check.status !== "passed" ||
    !["ready", "waiting", "failed"].includes(d.activation)
  )
    return;
  if (d.packages.some((p) => d.check.revisions[p.id] !== p.revision)) {
    invalidateAssignment(d);
    return;
  }
  const unchanged = d.packages.filter((p) => p.change === "unchanged");
  if (
    unchanged.some(
      (p) =>
        s.plugins.find((active) => active.id === p.id)?.version !== p.revision,
    )
  ) {
    for (const p of unchanged) {
      const active = s.plugins.find((active) => active.id === p.id);
      if (active) p.revision = p.activeRevision = active.version;
    }
    invalidateAssignment(d);
    d.check.detail = text.dependencyChanged;
    return;
  }
  const changed = d.packages.filter((p) => p.change !== "unchanged");
  if (
    d.packages.some((p) =>
      p.dependencies.some(
        (id) =>
          !changed.some((c) => c.id === id) &&
          !s.plugins.some((active) => active.id === id && active.enabled),
      ),
    )
  ) {
    d.activation = "failed";
    d.check.detail = text.dependencyMissing;
    phase(d, "failed");
    return;
  }
  const affected = assignmentAffectedIds(s, d);
  if (s.plugins.some((p) => affected.has(p.id) && p.running > 0)) {
    d.activation = "waiting";
    phase(d, "waiting");
    return;
  }
  if (outcome === "failure" || outcome === "uncertain") {
    d.activation = outcome === "failure" ? "failed" : "uncertain";
    phase(d, outcome === "failure" ? "failed" : "interrupted");
    return;
  }
  recordActivatedAssignment(s, d, outcome === "notification-failure");
}
function recordActivatedAssignment(
  s: PluginState,
  d: Development,
  notificationFailed = false,
) {
  for (const p of d.packages.filter((p) => p.change !== "unchanged")) {
    let active = s.plugins.find((active) => active.id === p.id);
    if (!active) {
      active = {
        ...(p.kind === "connector"
          ? newConnectorFixture
          : p.kind === "source"
            ? newSourceFixture
            : newPluginFixture),
        id: p.id,
        name: p.name,
      };
      s.plugins.push(active);
      if (p.kind === "connector") {
        s.accounts[p.id] = [];
        s.connectionAvailability[p.id] = "permission";
      }
    }
    active.version = p.revision;
    active.dependencies = [...p.dependencies];
    active.enabled = true;
    active.blocked = false;
    p.activeRevision = p.revision;
    p.activation = "active";
  }
  d.activation = notificationFailed ? "notification-failed" : "active";
  d.storageMB = 0;
  phase(d, "adopted");
  syncAssignmentInspection(d);
}
export function resolveAssignmentActivation(s: PluginState, active: boolean) {
  const d = s.developments.find((d) => d.id === s.developmentId);
  if (!d || d.activation !== "uncertain") return;
  if (active) recordActivatedAssignment(s, d);
  else {
    d.activation = "ready";
    phase(d, "interrupted");
  }
}
export function removePendingAssignmentCode(d: Development) {
  if (d.activation === "uncertain") return;
  for (const p of d.packages)
    if (p.activation === "pending") p.activation = "removed";
  d.storageMB = 0;
  phase(d, "discarded");
  syncAssignmentInspection(d);
}
export function syncAssignmentInspection(
  d: Development,
  run = Math.max(1, d.messages.length),
) {
  const inspection = d.inspection;
  if (!inspection) return;
  inspection.recordedChanges = inspection.recordedChanges.filter(
    (change) =>
      !change.packageId ||
      d.packages.some(
        (p) => p.id === change.packageId && p.change !== "unchanged",
      ),
  );
  inspection.unchangedPackages = d.packages
    .filter((p) => p.change === "unchanged")
    .map((p) => ({
      id: p.id,
      name: p.name,
      group: p.kind === "connector" ? "connection" : "plugin",
      revision: `${p.id}-r${p.revision}`,
    }));
  for (const p of d.packages) {
    const group = p.kind === "connector" ? "connection" : "plugin";
    const changes = inspection.recordedChanges.filter(
      (change) => change.packageId === p.id,
    );
    for (const change of changes) {
      if (change.packageRevision !== undefined) continue;
      change.packageRevision = p.revision;
      change.packageName = p.name;
      change.provenance.conversationId = d.id;
      change.provenance.runId = `${d.id}-run-1`;
      if (p.change === "added" && change.operation === "modified") {
        change.operation = "added";
        change.before = null;
      }
      if (change.after) {
        const current = inspection.workspaceFiles.find(
          (file) => file.identity === change.identity,
        );
        const previousRevision = change.after.revision;
        change.after.revision = `${p.id}-r${p.revision}`;
        if (current?.current.revision === previousRevision)
          current.current = { ...change.after };
      }
    }
    if (
      p.change !== "unchanged" &&
      !changes.some((change) => change.packageRevision === p.revision)
    ) {
      const previous = changes
        .filter((change) => change.after?.path.endsWith("/src/index.ts"))
        .at(-1);
      const path =
        previous?.after?.path ?? `.situate/plugins/${p.id}/code/src/index.ts`;
      const identity = previous?.identity ?? `file-${p.id}`;
      const current = inspection.workspaceFiles.find(
        (file) => file.identity === identity,
      );
      const before = previous?.after
        ? { ...previous.after }
        : p.activeRevision === null
          ? null
          : current
            ? { ...current.current }
            : {
                path,
                revision: `${p.id}-r${p.activeRevision}`,
                status: "available" as const,
                text: "export const limit = 10;\n",
              };
      const change: AssignmentChange = {
        id: `${d.id}-${p.id}-r${p.revision}`,
        identity,
        group,
        packageId: p.id,
        packageName: p.name,
        packageRevision: p.revision,
        operation: before ? "modified" : "added",
        before,
        after: {
          path,
          revision: `${p.id}-r${p.revision}`,
          status: "available",
          text: `export const limit = ${p.revision * 10};\n`,
        },
        provenance: {
          attribution: "recorded",
          source: "write",
          conversationId: d.id,
          runId: `${d.id}-run-${run}`,
        },
        disposition: "pending",
      };
      inspection.recordedChanges.push(change);
      changes.push(change);
      if (current) current.current = { ...change.after! };
      else
        inspection.workspaceFiles.push({
          identity,
          group,
          packageId: p.id,
          current: { ...change.after! },
        });
    }
    for (const change of changes) {
      if (change.packageRevision !== p.revision) {
        if (change.disposition === "pending") change.disposition = "superseded";
        else if (change.disposition === "active" && p.activation === "active")
          change.disposition = "previous";
        continue;
      }
      change.disposition =
        p.activation === "removed"
          ? "removed"
          : p.activation === "active"
            ? "active"
            : "pending";
      if (p.activation === "removed" && change.after)
        change.after.status = "unavailable";
    }
  }
  for (const effect of d.workspaceEffects) {
    if (
      inspection.recordedChanges.some(
        (change) => change.after?.path === effect.path,
      )
    )
      continue;
    const revision = {
      path: effect.path,
      revision: `${d.id}-workspace-1`,
      status: "available" as const,
      text: text.workspaceText,
    };
    const identity = `workspace-${effect.path}`;
    inspection.recordedChanges.push({
      id: identity,
      identity,
      group: "workspace",
      packageId: null,
      packageName: "",
      operation: "added",
      before: null,
      after: revision,
      provenance: {
        attribution: effect.attribution,
        source: "write",
        conversationId: d.id,
        runId: `${d.id}-run-1`,
      },
      disposition: "written",
    });
    inspection.workspaceFiles.push({
      identity,
      group: "workspace",
      packageId: null,
      current: { ...revision },
    });
  }
  for (const change of inspection.recordedChanges) {
    if (
      change.group === "workspace" &&
      change.after &&
      !d.workspaceEffects.some((effect) => effect.path === change.after!.path)
    )
      d.workspaceEffects.push({
        path: change.after.path,
        status: "written",
        attribution: change.provenance.attribution,
      });
  }
}
export function shareAssignmentWrites(
  s: PluginState,
  d: Development,
  previous: InspectionFile[],
) {
  const writes = d.inspection.workspaceFiles.filter((file) => {
    const before = previous.find((item) => item.identity === file.identity);
    return (
      !before || JSON.stringify(before.current) !== JSON.stringify(file.current)
    );
  });
  for (const other of s.developments) {
    if (other.id === d.id) continue;
    for (const file of writes) {
      const current = other.inspection.workspaceFiles.find(
        (item) => item.identity === file.identity,
      );
      const copy = JSON.parse(JSON.stringify(file)) as InspectionFile;
      if (current) Object.assign(current, copy);
      else other.inspection.workspaceFiles.push(copy);
    }
  }
}
export { text as assignmentText };
