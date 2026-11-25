import { t, localizeError } from "@situate/localization";
import type { PluginUiHost } from "./types";

export async function loadHostModules(): Promise<
  Pick<PluginUiHost, "vue" | "ui" | "localization">
> {
  const [vue, { ui }] = await Promise.all([
    import("./host-vue"),
    import("./ui"),
    import("@situate/localization/plugin-management"),
  ]);
  return { vue, ui, localization: { text: t, error: localizeError } };
}

export function importPluginModule(
  url: string,
): Promise<{ default?: unknown }> {
  return import(/* @vite-ignore */ url);
}
