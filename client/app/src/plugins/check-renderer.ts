import { createPluginPreview } from "./preview";
import { createPluginModule, type PluginModule } from "./module-source";
import { importPluginModule, loadHostModules } from "./module";
import { validateUiContributions } from "./contributions";
import {
  validPreviewRequest,
  type PreviewRequest,
} from "./check-renderer-client";
import type {
  PluginSource,
  PluginUiContributions,
  PluginUiHost,
} from "./types";

export function startCheckRenderer(
  invoke: (
    command: "plugin_preview_ack" | "plugin_preview_service",
    args: Record<string, unknown>,
  ) => Promise<unknown>,
): void {
  if (window.__situatePreviewRequest) return;
  type Session = {
    preview: ReturnType<typeof createPluginPreview>;
    modules: PluginModule[];
    contributions: PluginUiContributions[];
    active: boolean;
    capturesPending: number;
    closeRequested: boolean;
  };
  const sessions = new Map<string, Session>();
  const seen = new Set<string>();
  let queue = Promise.resolve();
  const key = (request: Pick<PreviewRequest, "generation" | "invocationId">) =>
    JSON.stringify([request.generation, request.invocationId]);
  async function close(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    if (session.capturesPending) {
      session.closeRequested = true;
      session.active = false;
      return;
    }
    sessions.delete(id);
    session.active = false;
    let failure: unknown;
    try {
      try {
        session.preview.dispose();
      } catch (error) {
        failure = error;
      }
      for (const contributions of session.contributions.reverse()) {
        try {
          await contributions.dispose?.();
        } catch (error) {
          failure ??= error;
        }
      }
    } finally {
      for (const linked of session.modules) linked.dispose();
    }
    if (failure !== undefined) throw failure;
  }
  async function run(request: PreviewRequest): Promise<unknown> {
    const id = key(request);
    if (request.operation === "previewClose") {
      await close(id);
      return true;
    }
    if (request.operation === "previewOpen") {
      if (typeof request.args.viewId !== "string")
        throw new Error("plugins.previewInvalidArguments");
      let session = sessions.get(id);
      if (!session) {
        if (sessions.size) throw new Error("plugins.previewUnavailable");
        const source = request.args.source;
        if (!source) throw new Error("plugins.previewUnavailable");
        session = {
          active: true,
          capturesPending: 0,
          closeRequested: false,
          modules: [],
          contributions: [],
          preview: createPluginPreview({
            requireCurrent: () => {
              if (!session?.active)
                throw new Error("plugins.executionCancelled");
            },
            capture: async () => {
              throw new Error("plugins.previewUnavailable");
            },
          }),
        };
        sessions.set(id, session);
        const owned = session;
        try {
          const sources = new Map(
            (request.args.sources ?? []).map((entry) => [
              entry.manifest.id,
              entry,
            ]),
          );
          sources.set(source.manifest.id, source);
          const loaded = new Map<string, PluginUiContributions>();
          const loading = new Set<string>();
          const modules = await loadHostModules();
          async function load(
            current: PluginSource,
          ): Promise<PluginUiContributions> {
            const pluginId = current.manifest.id;
            const existing = loaded.get(pluginId);
            if (existing) return existing;
            if (loading.has(pluginId))
              throw new Error("plugins.invalidContributions");
            loading.add(pluginId);
            for (const dependency of current.manifest.dependencies ?? []) {
              const dependencySource = sources.get(dependency);
              if (!dependencySource)
                throw new Error("plugins.invalidContributions");
              await load(dependencySource);
            }
            let contributions: PluginUiContributions = {};
            if (current.uiEntry !== null) {
              const linked = createPluginModule(current, "ui");
              owned.modules.push(linked);
              const imported = await importPluginModule(linked.url);
              if (typeof imported.default !== "function")
                throw new Error("plugins.invalidContributions");
              const call = (
                name: string,
                args: unknown,
                dependency?: string,
              ) => {
                if (!owned.active)
                  throw new Error("plugins.executionCancelled");
                return invoke("plugin_preview_service", {
                  generation: request.generation,
                  invocationId: request.invocationId,
                  pluginId,
                  dependency,
                  name,
                  args,
                });
              };
              const host: PluginUiHost = {
                ...modules,
                navigation: owned.preview.navigation,
                service: { invoke: (name, args) => call(name, args) },
                dependencies: {
                  invoke: (dependency, name, args) => {
                    if (!current.manifest.dependencies?.includes(dependency))
                      throw new Error("plugins.invalidContributions");
                    return call(name, args, dependency);
                  },
                  component: (dependency, name) => {
                    if (!current.manifest.dependencies?.includes(dependency))
                      throw new Error("plugins.invalidContributions");
                    const components = loaded.get(dependency)?.components;
                    if (!components || !Object.hasOwn(components, name))
                      throw new Error("plugins.invalidContributions");
                    return components[name]!;
                  },
                },
              };
              const returned = await imported.default(host);
              if (returned && typeof returned.dispose === "function")
                owned.contributions.push({ dispose: () => returned.dispose() });
              contributions = validateUiContributions(returned, pluginId);
            }
            loaded.set(pluginId, contributions);
            loading.delete(pluginId);
            return contributions;
          }
          owned.preview.setContributions(await load(source));
        } catch (error) {
          await close(id);
          throw error;
        }
      }
      if (!session.active || session.capturesPending)
        throw new Error("plugins.previewUnavailable");
      await session.preview.open(request.args.viewId);
      session.preview.check();
      return true;
    }
    const session = sessions.get(id);
    if (!session || !session.active || session.capturesPending)
      throw new Error("plugins.previewUnavailable");
    const { action, selector, value } = request.args;
    switch (action) {
      case "read":
        return session.preview.read(selector);
      case "click":
        if (typeof selector !== "string")
          throw new Error("plugins.previewInvalidArguments");
        await session.preview.click(selector);
        return true;
      case "fill":
        if (typeof selector !== "string" || typeof value !== "string")
          throw new Error("plugins.previewInvalidArguments");
        await session.preview.fill(selector, value);
        return true;
      case "capture": {
        const rect = await session.preview.captureRect();
        session.capturesPending++;
        return { rect };
      }
      default:
        throw new Error("plugins.previewInvalidArguments");
    }
  }
  window.__situatePreviewCaptureFinished = (identity) => {
    if (
      !identity ||
      !Number.isSafeInteger(identity.generation) ||
      identity.generation < 0 ||
      typeof identity.invocationId !== "string"
    )
      return;
    queue = queue
      .then(async () => {
        const id = key(identity);
        const session = sessions.get(id);
        if (!session?.capturesPending) return;
        session.capturesPending--;
        if (session.closeRequested) await close(id);
      })
      .catch(() => undefined);
  };
  window.__situatePreviewRequest = (request: PreviewRequest) => {
    if (!validPreviewRequest(request)) return;
    const receipt = JSON.stringify([
      request.generation,
      request.invocationId,
      request.requestId,
    ]);
    if (seen.has(receipt)) return;
    seen.add(receipt);
    queue = queue.then(async () => {
      let value: unknown;
      let error: string | undefined;
      try {
        value = await run(request);
      } catch {
        error = "plugins.previewUnavailable";
      }
      await invoke("plugin_preview_ack", {
        generation: request.generation,
        invocationId: request.invocationId,
        requestId: request.requestId,
        ...(error ? { error } : { value }),
      }).catch(() => undefined);
    });
  };
}

declare global {
  interface Window {
    __situatePreviewRequest?: (request: PreviewRequest) => void;
    __situatePreviewCaptureFinished?: (identity: {
      generation: number;
      invocationId: string;
    }) => void;
  }
}
