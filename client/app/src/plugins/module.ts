import type { PluginUiHost } from "./types";

export async function loadHostModules(): Promise<
  Pick<PluginUiHost, "vue" | "ui">
> {
  const [vue, { ui }] = await Promise.all([
    import("./host-vue"),
    import("./ui"),
  ]);
  return { vue, ui };
}

export function importPluginModule(
  url: string,
): Promise<{ default?: unknown }> {
  return import(/* @vite-ignore */ url);
}
