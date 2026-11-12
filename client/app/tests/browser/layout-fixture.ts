import type { Page } from "@playwright/test";
import { emptyLayout, reduceLayout } from "../../src/layout/model";

export interface StoredLayout {
  revision: string | null;
  data: unknown;
  pluginIncarnations?: Record<string, string>;
}
export function legacyChatLayout(): StoredLayout {
  let sequence = 0;
  return {
    revision: "saved-layout",
    data: {
      version: 1,
      layout: reduceLayout(
        emptyLayout(),
        {
          type: "open",
          target: { kind: "conversation", conversationId: "legacy" },
        },
        () => `saved-${++sequence}`,
      ),
      pinnedViews: ["files"],
    },
  };
}

export interface LayoutFixtureOptions {
  records?: Record<string, StoredLayout>;
  loadError?: string;
  saveError?: string;
}
type Request =
  | { command: "load"; workspaceId: string }
  | { command: "stored"; workspaceId: string }
  | {
      command: "save";
      workspaceId: string;
      expectedRevision: string | null;
      data: unknown;
      pluginIncarnations?: Record<string, string>;
    }
  | { command: "replace"; workspaceId: string; record: StoredLayout }
  | { command: "failLoad"; error: string | null }
  | { command: "failSave"; error: string | null };

declare global {
  interface Window {
    __layoutTest: {
      load(workspaceId: string): Promise<StoredLayout>;
      save(
        workspaceId: string,
        expectedRevision: string | null,
        data: unknown,
        pluginIncarnations?: Record<string, string>,
      ): Promise<StoredLayout>;
      stored(workspaceId: string): Promise<StoredLayout>;
      replace(workspaceId: string, record: StoredLayout): Promise<void>;
      failLoad(error: string | null): Promise<void>;
      failSave(error: string | null): Promise<void>;
    };
  }
}

export async function layoutFixture(
  page: Page,
  options: LayoutFixtureOptions = {},
): Promise<void> {
  const records = new Map(
    Object.entries(structuredClone(options.records ?? {})),
  );
  let loadError = options.loadError;
  let saveError = options.saveError;
  let sequence = 0;
  await page.exposeBinding("__layoutStorage", (_source, request: Request) => {
    if (request.command === "failLoad") {
      loadError = request.error ?? undefined;
      return;
    }
    if (request.command === "failSave") {
      saveError = request.error ?? undefined;
      return;
    }
    if (request.command === "replace") {
      records.set(request.workspaceId, structuredClone(request.record));
      return;
    }
    const record = records.get(request.workspaceId) ?? {
      revision: null,
      data: null,
    };
    if (request.command === "stored") return structuredClone(record);
    if (request.command === "load") {
      if (loadError) throw new Error(loadError);
      return structuredClone(record);
    }
    if (saveError) throw new Error(saveError);
    if (request.expectedRevision !== record.revision)
      throw new Error("native.layout.storage.conflict");
    const saved = {
      revision: `fixture-layout-${++sequence}`,
      data: structuredClone(request.data),
      ...(request.pluginIncarnations
        ? { pluginIncarnations: structuredClone(request.pluginIncarnations) }
        : {}),
    };
    records.set(request.workspaceId, saved);
    return structuredClone(saved);
  });
  await page.addInitScript(() => {
    const call = (request: Request) =>
      Reflect.get(window, "__layoutStorage")(request);
    window.__layoutTest = {
      load: (workspaceId) => call({ command: "load", workspaceId }),
      save: (workspaceId, expectedRevision, data, pluginIncarnations) =>
        call({
          command: "save",
          workspaceId,
          expectedRevision,
          data,
          pluginIncarnations,
        }),
      stored: (workspaceId) => call({ command: "stored", workspaceId }),
      replace: (workspaceId, record) =>
        call({ command: "replace", workspaceId, record }),
      failLoad: (error) => call({ command: "failLoad", error }),
      failSave: (error) => call({ command: "failSave", error }),
    };
  });
}
