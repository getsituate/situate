import { workspacePlugins } from "../layout/runtime";
import { workspaceChat } from "../ai/chat";

export async function announcePluginActivation(
  scope: string,
  pluginId: string,
  origin: string | undefined,
  runId: string,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) throw new Error("plugins.workspaceUnavailable");
  const runtime = await workspacePlugins(scope);
  if (!runtime || !isCurrent()) throw new Error("plugins.workspaceUnavailable");
  await runtime.refresh(pluginId);
  let ready: Promise<void>;
  do {
    ready = runtime.ready;
    await ready;
  } while (ready !== runtime.ready && isCurrent());
  if (!isCurrent()) throw new Error("plugins.workspaceUnavailable");
  const plugin = runtime.state.plugins.find((item) => item.id === pluginId);
  if (plugin?.status !== "loaded")
    throw new Error("plugins.activationLoadFailed");
  if (origin)
    await workspaceChat(scope, origin).notifyPluginAvailable(
      { pluginId, pluginName: plugin.manifest?.name || pluginId },
      runId,
    );
}
