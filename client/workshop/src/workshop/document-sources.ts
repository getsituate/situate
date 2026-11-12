import {
  clone,
  finishDocumentAction,
  purgeDeletedTagReferences,
  type DocumentsState,
} from "../documents/model";
import { reconcile } from "./reconcile";
import { documentFixtures, sourceFixtures } from "../documents/fixtures";
import { c } from "../plugins/content";
import { consumerAccessReason } from "../plugins/connection-readiness";
import { assignmentAffectedIds } from "../plugins/assignment-model";
import {
  openPluginScreen,
  startPluginDevelopment,
  affectedPlugins,
  activateAssignment,
  canEnablePlugin,
  currentDevelopment,
  disablePlugin,
  finishPluginDisable,
  type PluginState,
} from "../plugins/model";

export function syncSourceState(
  documents: DocumentsState,
  plugins: PluginState,
) {
  const sources = plugins.plugins.filter((p) => p.kind === "source");
  documents.sources = documents.sources.filter((source) =>
    sources.some((p) => p.id === source.id),
  );
  for (const plugin of sources) {
    let source = documents.sources.find((s) => s.id === plugin.id);
    if (!source) {
      const fixture = sourceFixtures.find((s) => s.id === plugin.id);
      source = fixture
        ? clone(fixture)
        : {
            id: plugin.id,
            name: plugin.name,
            detail: "Archive folder",
            included: "Archive / Receipts and records",
            excluded: "Archive / Private",
            rules: "Keep original files and filenames unchanged.",
            checked: c.sourceNeverChecked,
            status: "pending",
            pending: 1,
          };
      documents.sources.push(source);
    }
    source.paused =
      !plugin.enabled ||
      !canEnablePlugin(plugins, plugin) ||
      !!consumerAccessReason(plugins, plugin);
    if (
      !source.paused &&
      !sourceFixtures.some((item) => item.id === plugin.id) &&
      !documents.documents.some((item) => item.id === `${plugin.id}-receipt`)
    ) {
      const sample = documentFixtures.find((item) => item.type === "Image")!;
      documents.documents.push({
        ...clone(sample),
        id: `${plugin.id}-receipt`,
        source: plugin.id,
        title: "Archive receipt",
        folder: "Archive/Receipts",
        preparation: "pending",
      });
    }
    plugin.running = documents.pending?.id === plugin.id ? 1 : 0;
  }
  purgeDeletedTagReferences(documents);
}

export function reconcileSourceDocuments(
  current: DocumentsState,
  next: DocumentsState,
  base = current,
) {
  const candidate = clone(reconcile(base, next, current));
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const started = !same(next.sourceAction, base.sourceAction);
  const completed = !!base.pending && !same(next.pending, base.pending);
  const staleStart =
    started &&
    (!!current.pending ||
      !same(current.sourceAction, base.sourceAction) ||
      !!current.sources.find((source) => source.id === next.sourceAction?.id)
        ?.paused);
  const staleCompletion =
    completed &&
    (!same(current.pending, base.pending) ||
      !same(current.sourceAction, base.sourceAction));
  if (staleStart || staleCompletion) {
    candidate.sources = clone(current.sources);
    candidate.documents = clone(current.documents);
    candidate.pending = clone(current.pending);
    candidate.sourceAction = clone(current.sourceAction);
    candidate.notice = current.notice;
    candidate.nextOutcome = current.nextOutcome;
  }
  purgeDeletedTagReferences(candidate);
  return candidate;
}

export function sourcePluginAction(
  documents: DocumentsState,
  plugins: PluginState,
  action: "finish" | "adopt" | "abort",
  id?: string,
) {
  const pending = documents.pending?.id;
  if (action === "abort") {
    if (!id || !plugins.plugins.some((p) => p.id === id)) return;
    const affected = [id, ...affectedPlugins(plugins, id).map((p) => p.id)];
    plugins.target = id;
    disablePlugin(plugins, true);
    if (pending && affected.includes(pending)) documents.pending = null;
  } else if (action === "finish") {
    const operation = plugins.disableOperation;
    if (operation) {
      if (!["waiting", "stopping", "checking"].includes(operation.phase))
        return;
      const affected = operation.previous.map((p) => p.id);
      if (pending && affected.includes(pending)) {
        if (operation.phase === "stopping") documents.pending = null;
        else finishDocumentAction(documents, true, "source");
      }
      finishPluginDisable(plugins);
    } else {
      finishDocumentAction(documents, true, "source");
      for (const p of plugins.plugins) p.running = 0;
    }
  } else {
    const development = currentDevelopment(plugins);
    if (development?.check.status !== "passed") return;
    const affected = assignmentAffectedIds(plugins, development);
    if (pending && affected.has(pending))
      finishDocumentAction(documents, true, "source");
    syncSourceState(documents, plugins);
    for (const plugin of plugins.plugins)
      if (affected.has(plugin.id)) plugin.running = 0;
    activateAssignment(plugins);
  }
}

export function openSourceWorkflow(
  plugins: PluginState,
  action: "list" | "create" | "detail",
  id?: string,
) {
  plugins.returnToDocuments = true;
  plugins.listSection = "sources";
  if (action === "create")
    startPluginDevelopment(plugins, c.sourceRequest, "source");
  else if (
    action === "detail" &&
    plugins.plugins.some((p) => p.id === id && p.kind === "source")
  ) {
    plugins.selected = id!;
    openPluginScreen(plugins, "detail");
  } else openPluginScreen(plugins, "list");
}
