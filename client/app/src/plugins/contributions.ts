import type { ViewDefinition } from "../layout/registry";
import type { Component } from "vue";
import type { PluginUiContributions, PluginToolDescriptor } from "./types";

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
export function validateUiContributions(
  value: unknown,
  pluginId: string,
): PluginUiContributions {
  if (!object(value)) invalid();
  if (
    Object.keys(value).some(
      (key) => !["views", "settings", "dispose", "components"].includes(key),
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
  const views = [
    ...((value.views ?? []) as ViewDefinition[]),
    ...(value.settings === undefined ? [] : [value.settings as ViewDefinition]),
  ];
  const ids = new Set<string>();
  for (const view of views) {
    if (
      !object(view) ||
      typeof view.id !== "string" ||
      !view.id.startsWith(`${pluginId}:`) ||
      view.id.length === pluginId.length + 1 ||
      ids.has(view.id) ||
      typeof view.title !== "function" ||
      typeof view.icon !== "string" ||
      !view.icon ||
      !component(view.component) ||
      (view.reveal !== undefined && typeof view.reveal !== "function")
    )
      invalid();
    ids.add(view.id);
  }
  return {
    ...(value.components === undefined
      ? {}
      : {
          components: value.components as Record<string, Component>,
        }),
    views: (value.views ?? []) as ViewDefinition[],
    ...(value.settings === undefined
      ? {}
      : { settings: value.settings as ViewDefinition }),
    ...(value.dispose === undefined
      ? {}
      : { dispose: value.dispose as () => void | Promise<void> }),
  };
}
