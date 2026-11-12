import { describe, expect, it } from "vitest";
import {
  createSimulation,
  reduceSimulation,
  type Simulation,
} from "./simulation";
import {
  clone,
  finishDocumentAction,
  results,
  selectDocument,
  startDocumentAction,
} from "../documents/model";
import {
  applyPluginOutcome,
  currentDevelopment,
  disablePlugin,
  startPluginDisable,
  cancelPluginDisable,
  stopPluginDisable,
  enablePlugin,
  sendPluginRequest,
  startPluginDevelopment,
  startConnectionAttempt,
  finishConnectionAttempt,
  type PluginState,
} from "../plugins/model";
import { screenControls } from "./screen-controls";

function plugins(s: Simulation, change: (p: PluginState) => void) {
  const next = clone(s.plugins);
  change(next);
  return reduceSimulation(s, {
    type: "plugins",
    state: next,
    workspaceId: s.snapshot.current!.id,
  });
}
function open(
  s: Simulation,
  action: "list" | "create" | "detail",
  id?: string,
) {
  return reduceSimulation(s, {
    type: "document-sources",
    action,
    id,
    workspaceId: s.snapshot.current!.id,
  });
}

describe("document sources across workshop scenarios", () => {
  it("keeps standalone sources and a source reusing a connection distinct", () => {
    const s = createSimulation("documents-sources");
    expect(s.feature).toBe("plugins");
    expect(s.plugins.listSection).toBe("sources");
    expect(
      s.plugins.plugins.find((p) => p.id === "drive")?.dependencies,
    ).toEqual(["cloud-connection"]);
    expect(
      s.plugins.plugins.find((p) => p.id === "paperless")?.dependencies,
    ).toEqual([]);
    expect(
      s.plugins.plugins.filter((p) => p.kind === "source").map((p) => p.id),
    ).toEqual(s.documents.sources.map((source) => source.id));
    expect(screenControls(s).sourceManagement).toBe(true);
  });
  it.each([
    "documents-empty",
    "plugins-empty",
    "plugins-sources-empty",
  ] as const)("keeps %s empty on both sides", (scenario) => {
    const s = createSimulation(scenario);
    expect(s.documents.sources).toEqual([]);
    expect(results(s.documents)).toEqual([]);
    expect(s.plugins.plugins.some((p) => p.kind === "source")).toBe(false);
  });
  it("preserves document selection, preview and unsent text when managing a source", () => {
    let s = createSimulation("documents-gather");
    s.documents.draftQuery = "Unsent description";
    s.documents.scroll = { collection: 30, results: 210 };
    selectDocument(s.documents, "bike");
    const before = clone(s.documents);
    s = open(s, "detail", "paperless");
    expect(s.plugins.selected).toBe("paperless");
    expect(s.plugins.screen).toBe("detail");
    expect(s.documents).toEqual(before);
    s = reduceSimulation(s, { type: "feature", feature: "documents" });
    expect(s.documents).toEqual(before);
  });
  it("creates a source only on successful adoption, once, and preserves its identity on adaptation", () => {
    let s = open(createSimulation("documents-empty"), "create");
    expect(currentDevelopment(s.plugins)?.kind).toBe("source");
    expect(s.documents.sources).toEqual([]);
    s = plugins(s, sendPluginRequest);
    s = plugins(s, (p) => applyPluginOutcome(p, "failed"));
    expect(s.documents.sources).toEqual([]);
    s = plugins(s, (p) => {
      currentDevelopment(p)!.draft = "Retry with the agreed folder.";
      sendPluginRequest(p);
    });
    for (const phase of ["checking", "waiting", "adopted"] as const)
      s = plugins(s, (p) => applyPluginOutcome(p, phase));
    const id = currentDevelopment(s.plugins)!.packages.find(
      (item) => item.kind === "source",
    )!.id;
    expect(s.documents.sources.map((source) => source.id)).toEqual([id]);
    expect(results(s.documents)).toHaveLength(0);
    expect(s.documents.sources[0].paused).toBe(true);
    startDocumentAction(s.documents, "refresh", id);
    expect(s.documents.pending).toBeNull();
    s = plugins(s, (p) => {
      const connection = currentDevelopment(p)!.packages.find(
        (item) => item.kind === "connector",
      )!;
      startConnectionAttempt(p, connection.id);
      finishConnectionAttempt(p, true);
    });
    expect(s.documents.sources[0].paused).toBe(false);
    expect(results(s.documents)).toHaveLength(1);
    const before = clone(s.documents);
    s = plugins(s, (p) => applyPluginOutcome(p, "adopted"));
    expect(s.documents).toEqual(before);
    s = plugins(s, (p) => {
      p.selected = id;
      startPluginDevelopment(p);
      sendPluginRequest(p);
    });
    for (const phase of ["checking", "waiting", "adopted"] as const)
      s = plugins(s, (p) => applyPluginOutcome(p, phase));
    expect(s.documents).toEqual(before);
    expect(s.plugins.plugins.find((p) => p.id === id)?.version).toBe(2);
  });
  it("disables updates without deleting known documents and requires explicit dependent re-enabling", () => {
    let s = createSimulation("documents-find");
    const before = results(s.documents);
    s = plugins(s, (p) => {
      p.target = "cloud-connection";
      disablePlugin(p);
    });
    expect(
      s.documents.sources.find((source) => source.id === "drive")?.paused,
    ).toBe(true);
    expect(results(s.documents)).toEqual(before);
    startDocumentAction(s.documents, "refresh", "drive");
    expect(s.documents.pending).toBeNull();
    selectDocument(
      s.documents,
      s.documents.documents.find(
        (d) => d.source === "drive" && d.availability === "available",
      )!.id,
    );
    expect(s.documents.opening).toBeNull();
    expect(s.documents.preview).toBe("error");
    s = plugins(s, (p) => enablePlugin(p, "cloud-connection"));
    expect(
      s.documents.sources.find((source) => source.id === "drive")?.paused,
    ).toBe(true);
    s = plugins(s, (p) => enablePlugin(p, "drive"));
    expect(
      s.documents.sources.find((source) => source.id === "drive")?.paused,
    ).toBe(false);
  });
  it.each(["cancel", "finish", "stop"] as const)(
    "keeps source refresh and nonmodal disabling coherent on %s",
    (outcome) => {
      let s = createSimulation("documents-find");
      const docs = clone(s.documents);
      docs.nextOutcome = "wait";
      startDocumentAction(docs, "refresh", "drive");
      s = reduceSimulation(s, {
        type: "documents",
        state: docs,
        workspaceId: s.snapshot.current!.id,
      });
      s = plugins(s, (p) => {
        p.target = "cloud-connection";
        startPluginDisable(p);
      });
      expect(s.plugins.disableOperation?.phase).toBe("waiting");
      expect(s.documents.pending?.id).toBe("drive");
      expect(
        s.documents.sources.find((source) => source.id === "drive")?.paused,
      ).toBe(true);
      if (outcome === "cancel") {
        s = plugins(s, cancelPluginDisable);
        expect(s.documents.pending?.id).toBe("drive");
        expect(
          s.documents.sources.find((source) => source.id === "drive")?.paused,
        ).toBe(false);
      } else {
        if (outcome === "stop") s = plugins(s, stopPluginDisable);
        s = reduceSimulation(s, {
          type: "plugin-action",
          action: "finish",
          workspaceId: s.snapshot.current!.id,
        });
        expect(s.documents.pending).toBeNull();
        expect(s.plugins.plugins.find((p) => p.id === "drive")?.enabled).toBe(
          false,
        );
        expect(s.plugins.plugins.find((p) => p.id === "drive")?.running).toBe(
          0,
        );
      }
      expect(s.plugins.disableOperation).toBeNull();
    },
  );
  it.each([false, true])(
    "retains or aborts an in-flight source refresh explicitly (abort=%s)",
    (abort) => {
      let s = createSimulation("documents-find");
      const docs = clone(s.documents);
      docs.nextOutcome = "wait";
      startDocumentAction(docs, "refresh", "drive");
      s = reduceSimulation(s, {
        type: "documents",
        state: docs,
        workspaceId: s.snapshot.current!.id,
      });
      expect(s.plugins.plugins.find((p) => p.id === "drive")?.running).toBe(1);
      s = abort
        ? reduceSimulation(s, {
            type: "plugin-action",
            action: "abort",
            id: "drive",
            workspaceId: s.snapshot.current!.id,
          })
        : plugins(s, (p) => {
            p.target = "drive";
            disablePlugin(p);
          });
      expect(!!s.documents.pending).toBe(!abort);
      finishDocumentAction(s.documents, true, "source");
      expect(results(s.documents).some((d) => d.id === "new-invoice")).toBe(
        !abort,
      );
    },
  );
  it.each([false, true])(
    "finishes running plugin actions without dropping a refresh (disabled=%s)",
    (disabled) => {
      let s = createSimulation("documents-find");
      s.documents.nextOutcome = "wait";
      startDocumentAction(s.documents, "refresh", "drive");
      s = plugins(s, (p) => {
        if (disabled) {
          p.target = "drive";
          disablePlugin(p);
        }
      });
      s = reduceSimulation(s, {
        type: "plugin-action",
        action: "finish",
        workspaceId: s.snapshot.current!.id,
      });
      expect(s.documents.pending).toBeNull();
      expect(
        s.documents.sources.find((source) => source.id === "drive")?.checked,
      ).toBe("Just now");
      expect(results(s.documents).some((d) => d.id === "new-invoice")).toBe(
        true,
      );
      expect(s.plugins.plugins.find((p) => p.id === "drive")?.running).toBe(0);
    },
  );
  it("rejects stale refresh starts and completions after disabling a source", () => {
    const initial = createSimulation("documents-find");
    const late = clone(initial.documents);
    late.nextOutcome = "wait";
    startDocumentAction(late, "refresh", "drive");
    const disabled = plugins(initial, (p) => {
      p.target = "drive";
      disablePlugin(p);
    });
    const send = () =>
      reduceSimulation(disabled, {
        type: "documents",
        base: initial.documents,
        state: late,
        workspaceId: initial.snapshot.current!.id,
      });
    expect(send().documents).toEqual(disabled.documents);
    finishDocumentAction(late, true, "source");
    expect(send().documents).toEqual(disabled.documents);
    const draft = clone(initial.documents);
    draft.draftQuery = "My unsent query";
    expect(
      reduceSimulation(disabled, {
        type: "documents",
        base: initial.documents,
        state: draft,
        workspaceId: initial.snapshot.current!.id,
      }).documents.draftQuery,
    ).toBe(draft.draftQuery);
  });
  it.each([false, true])(
    "keeps cancelled refresh completions stale after re-enabling (new refresh=%s)",
    (restart) => {
      let initial = createSimulation("documents-find");
      initial.documents.nextOutcome = "wait";
      startDocumentAction(initial.documents, "refresh", "drive");
      initial = plugins(initial, () => {});
      let current = reduceSimulation(initial, {
        type: "plugin-action",
        action: "abort",
        id: "drive",
        workspaceId: initial.snapshot.current!.id,
      });
      const draft = clone(initial.documents);
      draft.draftQuery = "An unsent edit during refresh";
      current = reduceSimulation(current, {
        type: "documents",
        base: initial.documents,
        state: draft,
        workspaceId: initial.snapshot.current!.id,
      });
      expect(current.documents.draftQuery).toBe(draft.draftQuery);
      expect(current.documents.pending).toBeNull();
      current = plugins(current, (p) => enablePlugin(p, "drive"));
      if (restart) startDocumentAction(current.documents, "refresh", "drive");
      const late = clone(initial.documents);
      finishDocumentAction(late, true, "source");
      const result = reduceSimulation(current, {
        type: "documents",
        base: initial.documents,
        state: late,
        workspaceId: initial.snapshot.current!.id,
      });
      expect(result.documents).toEqual(current.documents);
      if (restart) {
        const completed = clone(result.documents);
        finishDocumentAction(completed, true, "source");
        const valid = reduceSimulation(result, {
          type: "documents",
          base: result.documents,
          state: completed,
          workspaceId: result.snapshot.current!.id,
        });
        expect(valid.documents.pending).toBeNull();
        expect(
          results(valid.documents).some((d) => d.id === "new-invoice"),
        ).toBe(true);
      }
    },
  );
  it("adopts a source only after its held refresh completes and dependencies are enabled", () => {
    let s = createSimulation("documents-find");
    s.documents.nextOutcome = "wait";
    startDocumentAction(s.documents, "refresh", "drive");
    s = plugins(s, (p) => {
      p.selected = "drive";
      startPluginDevelopment(p);
      sendPluginRequest(p);
      applyPluginOutcome(p, "checking");
      applyPluginOutcome(p, "waiting");
    });
    const waiting = clone(s.plugins);
    applyPluginOutcome(waiting, "adopted");
    expect(currentDevelopment(waiting)?.phase).toBe("waiting");
    s = reduceSimulation(s, {
      type: "plugin-action",
      action: "adopt",
      workspaceId: s.snapshot.current!.id,
    });
    expect(s.documents.pending).toBeNull();
    expect(currentDevelopment(s.plugins)?.phase).toBe("adopted");
    expect(results(s.documents).some((d) => d.id === "new-invoice")).toBe(true);
    s = plugins(s, (p) => {
      p.target = "cloud-connection";
      disablePlugin(p);
      p.selected = "drive";
      startPluginDevelopment(p);
      sendPluginRequest(p);
      applyPluginOutcome(p, "checking");
      applyPluginOutcome(p, "waiting");
    });
    s = reduceSimulation(s, {
      type: "plugin-action",
      action: "adopt",
      workspaceId: s.snapshot.current!.id,
    });
    expect(currentDevelopment(s.plugins)?.phase).toBe("failed");
    expect(s.plugins.plugins.find((p) => p.id === "drive")?.enabled).toBe(
      false,
    );
    expect(
      s.documents.sources.find((source) => source.id === "drive")?.paused,
    ).toBe(true);
  });
  it("completes source refresh independently of pending document opening", () => {
    const s = createSimulation("documents-find");
    s.documents.nextOutcome = "wait";
    selectDocument(s.documents, "bike");
    startDocumentAction(s.documents, "refresh", "drive");
    finishDocumentAction(s.documents, true, "source");
    expect(s.documents.opening).toBe("bike");
    expect(s.documents.preview).toBe("loading");
    expect(s.documents.pending).toBeNull();
  });
  it("rejects late source navigation and plugin updates after switching workspaces", () => {
    const initial = createSimulation("documents-find");
    const changed = clone(initial.plugins);
    changed.target = "drive";
    disablePlugin(changed);
    const switched = reduceSimulation(initial, {
      type: "action",
      operation: { request: "other", action: "open", id: "sample-2" },
    });
    const late = reduceSimulation(switched, {
      type: "plugins",
      state: changed,
      workspaceId: initial.snapshot.current!.id,
    });
    expect(late.plugins).toEqual(switched.plugins);
    expect(late.documents).toEqual(switched.documents);
    expect(
      reduceSimulation(late, {
        type: "document-sources",
        action: "create",
        workspaceId: initial.snapshot.current!.id,
      }).feature,
    ).toBe(late.feature);
    const restored = reduceSimulation(late, {
      type: "action",
      operation: { request: "return", action: "open", id: "sample-1" },
    });
    expect(restored.documents).toEqual(initial.documents);
  });
  it("resets source development and pending refresh with their scenarios", () => {
    let s = open(createSimulation("documents-gather"), "create");
    s = plugins(s, sendPluginRequest);
    s.documents.nextOutcome = "wait";
    startDocumentAction(s.documents, "refresh", "drive");
    const reset = reduceSimulation(s, { type: "reset" });
    expect(reset.documents).toEqual(
      createSimulation("documents-gather").documents,
    );
    expect(reset.plugins.developments).toEqual([]);
    expect(reset.plugins.returnToDocuments).toBe(false);
    expect(reset.feature).toBe("documents");
  });
});
