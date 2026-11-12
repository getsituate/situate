import type { RuntimeEvent } from "./queue-runtime";

export interface PluginNotice {
  id: string;
  pluginName: string;
  timestamp: number;
}

export function pluginNotices(events: readonly RuntimeEvent[]): PluginNotice[] {
  return events.flatMap((event) => {
    if (
      event.type !== "plugin_available" ||
      !event.data ||
      typeof event.data !== "object"
    )
      return [];
    const data = event.data as Record<string, unknown>;
    if (
      typeof data.pluginName !== "string" ||
      !data.pluginName.trim() ||
      typeof data.timestamp !== "number" ||
      !Number.isFinite(data.timestamp) ||
      data.timestamp < 0
    )
      return [];
    return [
      { id: event.id, pluginName: data.pluginName, timestamp: data.timestamp },
    ];
  });
}
