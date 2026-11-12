import { invoke } from "@tauri-apps/api/core";
import { nextTick } from "vue";
import { workspacePlugins, workspaceUi } from "../../src/layout/runtime";
import {
  createPluginChanges,
  type ChangeCheckArguments,
} from "../../src/plugins/change-checks";
import type { NativeServiceEntry } from "../../src/plugins/types";
import type { PluginRuntime } from "../../src/plugins/runtime";
import { workspaceChat, workspaceConversations } from "../../src/ai/chat";
import { withPluginCheckFocus } from "./native-plugin-focus";

interface SmokeCheckOptions {
  scope: string;
  conversation: string;
  runId: string;
}
export type NativeChecks = ReturnType<typeof createPluginChanges>;
export interface NativeService {
  descriptor: NativeServiceEntry;
  invoke(name: string, args: unknown, signal?: AbortSignal): Promise<unknown>;
}
declare global {
  interface Window {
    nativePluginChecks?: (options: SmokeCheckOptions) => Promise<NativeChecks>;
    nativePluginRuntime?: (scope: string) => Promise<PluginRuntime>;
    nativePluginService?: (
      scope: string,
      pluginId: string,
    ) => Promise<NativeService>;
    nativePluginConversation?: (scope: string) => { ids: string[]; id: string };
  }
}
window.nativePluginConversation = (scope) => {
  const conversations = workspaceConversations(scope);
  const id = conversations.state.selected;
  if (!id) throw new Error("No selected conversation");
  return { ids: conversations.state.conversations.map((item) => item.id), id };
};
export async function nativePluginRuntime(scope: string) {
  const runtime = await workspacePlugins(scope);
  if (!runtime) throw new Error("Plugin runtime unavailable");
  await runtime.ready;
  return runtime;
}
window.nativePluginService = async (scope, pluginId) => {
  const snapshot = await invoke<{ plugins: NativeServiceEntry[] }>(
    "plugin_executor",
    { scope, request: { operation: "snapshot" } },
  );
  const descriptor = snapshot.plugins.find(
    (plugin) => plugin.pluginId === pluginId,
  );
  if (!descriptor) throw new Error("Native plugin service unavailable");
  return {
    descriptor,
    async invoke(exportName, args, signal) {
      signal?.throwIfAborted();
      if (!descriptor.exports.includes(exportName))
        throw new Error("Native plugin export unavailable");
      let cancellation: Promise<unknown> | undefined;
      const abort = () => {
        cancellation ??= invoke("plugin_executor", {
          scope,
          request: { operation: "stop" },
        });
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const result = await invoke<{
          outcome: string;
          value?: unknown;
          error?: string;
        }>("plugin_executor", {
          scope,
          request: {
            operation: "invoke",
            pluginId,
            exportName,
            args,
            generation: descriptor.generation,
          },
        });
        await cancellation;
        if (signal?.aborted) throw new Error("plugins.executionCancelled");
        if (result.outcome !== "completed")
          throw new Error(result.error ?? result.outcome);
        return result.value;
      } catch (error) {
        await cancellation;
        if (signal?.aborted)
          throw new Error("plugins.executionCancelled", { cause: error });
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  };
};
export async function nativePluginChecks(
  options: SmokeCheckOptions,
): Promise<NativeChecks> {
  const ui = workspaceUi(options.scope);
  const isCurrent = () =>
    ui.plugins !== undefined && workspacePlugins(options.scope) === ui.plugins;
  const changes = createPluginChanges({
    ...options,
    isCurrent,
    onAvailable: async (plugins) => {
      const runtime = await nativePluginRuntime(options.scope);
      await runtime.refreshGroup(plugins.map((plugin) => plugin.pluginId));
      const record = await invoke<{
        development?: { originConversationId?: string };
      }>("ai_conversation_read", {
        scope: options.scope,
        conversation: options.conversation,
      });
      for (const plugin of plugins) {
        if (
          runtime.state.plugins.find((entry) => entry.id === plugin.pluginId)
            ?.status !== "loaded"
        )
          throw new Error("plugins.activationLoadFailed");
        if (record.development?.originConversationId)
          await workspaceChat(
            options.scope,
            record.development.originConversationId,
          ).notifyPluginAvailable({
            pluginId: plugin.pluginId,
            pluginName:
              runtime.state.plugins.find(
                (entry) => entry.id === plugin.pluginId,
              )?.manifest?.name ?? plugin.pluginId,
          });
      }
    },
  });
  return {
    ...changes,
    async check(id: string, args: ChangeCheckArguments, signal?: AbortSignal) {
      await ui.session.load();
      await nextTick();
      if (!ui.session.state.document)
        throw new Error("Plugin check workspace layout unavailable");
      const before = JSON.stringify(ui.session.state.document.layout);
      const result = await withPluginCheckFocus(() =>
        changes.check(id, args, signal),
      );
      if (JSON.stringify(ui.session.state.document.layout) !== before)
        throw new Error(
          "Plugin checks changed the workspace layout or navigation history",
        );
      if (
        [...ui.registry.definitions.keys()].some((id) =>
          id.startsWith("plugin-check:"),
        )
      )
        throw new Error("Plugin checks registered a workspace view");
      return result;
    },
  };
}
