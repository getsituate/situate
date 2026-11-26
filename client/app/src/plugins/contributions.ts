import { isIconName } from "@situate/ui/icons";
import type { ViewDefinition } from "../layout/registry";
import type { Component } from "vue";
import { validCombination } from "../layout/shortcut-keys";
import type { PluginShortcutDefinition } from "./layout-actions";
import type { PluginUiContributions, PluginToolDescriptor } from "./types";
import {
  parseThemeVariables,
  type ThemeDefinition,
  type ThemePreview,
} from "../settings/theme-tokens";

function invalid(): never {
  throw new Error("plugins.invalidContributions");
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function schema(value: unknown): boolean {
  if (!object(value) || value.type !== "object") return false;
  const types = new Set([
    "object",
    "array",
    "string",
    "number",
    "integer",
    "boolean",
    "null",
  ]);
  function check(node: unknown): boolean {
    if (typeof node === "boolean") return true;
    if (!object(node)) return false;
    if (
      node.type !== undefined &&
      !(typeof node.type === "string"
        ? types.has(node.type)
        : Array.isArray(node.type) &&
          node.type.length > 0 &&
          node.type.every((type) => types.has(type)))
    )
      return false;
    for (const key of [
      "properties",
      "patternProperties",
      "$defs",
      "definitions",
    ]) {
      if (
        node[key] !== undefined &&
        (!object(node[key]) || !Object.values(node[key]).every(check))
      )
        return false;
    }
    for (const key of [
      "additionalProperties",
      "unevaluatedProperties",
      "items",
      "contains",
      "not",
      "if",
      "then",
      "else",
    ]) {
      if (node[key] !== undefined && !check(node[key])) return false;
    }
    for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
      if (
        node[key] !== undefined &&
        (!Array.isArray(node[key]) || !node[key].every(check))
      )
        return false;
    }
    if (
      node.required !== undefined &&
      (!Array.isArray(node.required) ||
        node.required.some((key) => typeof key !== "string") ||
        new Set(node.required).size !== node.required.length)
    )
      return false;
    if (
      node.enum !== undefined &&
      (!Array.isArray(node.enum) || node.enum.length === 0)
    )
      return false;
    if (node.$ref !== undefined && typeof node.$ref !== "string") return false;
    return true;
  }
  try {
    JSON.stringify(value, (_key, item) => {
      if (
        typeof item === "function" ||
        typeof item === "undefined" ||
        typeof item === "symbol" ||
        (typeof item === "number" && !Number.isFinite(item))
      )
        invalid();
      return item;
    });
    return check(value);
  } catch {
    return false;
  }
}
export async function pluginToolPrefix(pluginId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(pluginId),
  );
  const encoded = Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `plugin_${encoded}_`;
}
export function validateToolDescriptors(
  value: unknown,
  occupiedTools: ReadonlySet<string>,
): PluginToolDescriptor[] {
  if (!Array.isArray(value)) invalid();
  const names = new Set(occupiedTools);
  return value.map((tool) => {
    if (
      !object(tool) ||
      typeof tool.name !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name) ||
      typeof tool.description !== "string" ||
      !schema(tool.parameters) ||
      names.has(tool.name)
    )
      invalid();
    names.add(tool.name);
    return {
      name: tool.name,
      description: tool.description,
      parameters: structuredClone(tool.parameters) as Record<string, unknown>,
    };
  });
}
function component(value: unknown): value is Component {
  return object(value) || typeof value === "function";
}
function themePreview(value: unknown): ThemePreview | undefined {
  if (value === undefined) return undefined;
  if (
    !object(value) ||
    Object.keys(value).some((name) => name !== "color" && name !== "icon")
  )
    invalid();
  const preview: ThemePreview = {};
  if (value.color !== undefined) {
    if (typeof value.color !== "string" || !value.color.trim()) invalid();
    preview.color = value.color;
  }
  if (value.icon !== undefined) {
    if (isIconName(value.icon)) preview.icon = value.icon;
    else {
      const icon = value.icon;
      if (
        !object(icon) ||
        typeof icon.path !== "string" ||
        !/^[Mm][\d\s.,+eEaAcChHlLmMqQsStTvVzZ-]+$/.test(icon.path.trim())
      )
        invalid();
      preview.icon = { path: icon.path.trim() };
    }
  }
  return preview;
}
function hasPluginUi(value: PluginUiContributions): boolean {
  return !!(
    value.views?.length ||
    value.shortcuts?.length ||
    value.themes?.length ||
    Object.keys(value.components ?? {}).length
  );
}

export function validateUiContributions(
  value: unknown,
  pluginId: string,
  requireViewIcons = false,
  providerOnly = false,
): PluginUiContributions {
  if (!object(value)) invalid();
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "views",
          "settings",
          "dispose",
          "components",
          "shortcuts",
          "themes",
        ].includes(key),
    )
  )
    invalid();
  if (value.dispose !== undefined && typeof value.dispose !== "function")
    invalid();
  if (value.views !== undefined && !Array.isArray(value.views)) invalid();
  if (
    value.components !== undefined &&
    (!object(value.components) ||
      Object.entries(value.components).some(
        ([name, value]) =>
          !/^[a-zA-Z0-9_-]{1,64}$/.test(name) || !component(value),
      ))
  )
    invalid();
  const ids = new Set<string>();
  function validateView(view: unknown): ViewDefinition {
    if (
      !object(view) ||
      typeof view.id !== "string" ||
      !view.id.startsWith(`${pluginId}:`) ||
      view.id.length === pluginId.length + 1 ||
      ids.has(view.id) ||
      typeof view.title !== "function" ||
      !component(view.component) ||
      (view.reveal !== undefined && typeof view.reveal !== "function") ||
      (view.availability !== undefined &&
        typeof view.availability !== "function")
    )
      invalid();
    ids.add(view.id);
    const icon = view.icon;
    const validIcon = isIconName(icon);
    if (requireViewIcons && !validIcon)
      throw new Error("plugins.viewIconRequired");
    return { ...view, icon: validIcon ? icon : "plugins" } as ViewDefinition;
  }
  const shortcutIds = new Set<string>();
  if (
    value.shortcuts !== undefined &&
    (!Array.isArray(value.shortcuts) || value.shortcuts.length > 64)
  )
    invalid();
  function validateShortcut(item: unknown): PluginShortcutDefinition {
    if (
      !object(item) ||
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9_.-]{1,128}$/u.test(item.id) ||
      shortcutIds.has(item.id) ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      item.title.length > 128 ||
      typeof item.run !== "function"
    )
      invalid();
    const defaults = item.defaults;
    if (
      defaults !== undefined &&
      (!object(defaults) ||
        Object.entries(defaults).some(
          ([os, keys]) =>
            (os !== "macos" && os !== "windows") ||
            typeof keys !== "string" ||
            !validCombination(keys, os),
        ))
    )
      invalid();
    shortcutIds.add(item.id);
    return {
      id: item.id,
      title: item.title.trim(),
      run: item.run as PluginShortcutDefinition["run"],
      defaults: defaults
        ? ({ ...defaults } as PluginShortcutDefinition["defaults"])
        : undefined,
    };
  }
  const themeIds = new Set<string>();
  if (
    value.themes !== undefined &&
    (!Array.isArray(value.themes) || value.themes.length > 16)
  )
    invalid();
  const themes = Array.from(value.themes ?? [], (theme): ThemeDefinition => {
    if (
      !object(theme) ||
      typeof theme.id !== "string" ||
      !/^[A-Za-z0-9_.-]{1,64}$/.test(theme.id) ||
      themeIds.has(theme.id) ||
      typeof theme.title !== "string" ||
      !theme.title.trim() ||
      theme.title.length > 128
    )
      invalid();
    const variables = parseThemeVariables(theme.variables);
    if (!variables) invalid();
    const preview = themePreview(theme.preview);
    const { brandAssets } = theme;
    if (
      brandAssets !== undefined &&
      brandAssets !== "on-light" &&
      brandAssets !== "on-dark"
    )
      invalid();
    themeIds.add(theme.id);
    return {
      id: theme.id,
      title: theme.title.trim(),
      variables,
      ...(preview ? { preview } : {}),
      ...(brandAssets ? { brandAssets } : {}),
    };
  });
  const contributions = {
    ...(themes.length ? { themes } : {}),
    ...(value.shortcuts === undefined
      ? {}
      : { shortcuts: Array.from(value.shortcuts, validateShortcut) }),
    ...(value.components === undefined
      ? {}
      : {
          components: value.components as Record<string, Component>,
        }),
    views: Array.from(value.views ?? [], validateView),
    ...(value.settings === undefined
      ? {}
      : { settings: validateView(value.settings) }),
    ...(value.dispose === undefined
      ? {}
      : { dispose: value.dispose as () => void | Promise<void> }),
  };
  if (providerOnly && hasPluginUi(contributions))
    throw new Error("plugins.providerContributions");
  return contributions;
}
