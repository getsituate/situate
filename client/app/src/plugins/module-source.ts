import { parse } from "es-module-lexer/js";
import type { PluginSource } from "./types";

export interface PluginModule {
  url: string;
  dispose(): void;
}

function resolveModule(importer: string, specifier: string): string {
  if (!specifier.startsWith("./") && !specifier.startsWith("../"))
    throw new Error("plugins.moduleImportInvalid");
  const parts = importer.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("plugins.moduleImportInvalid");
      parts.pop();
    } else {
      if (!/^[A-Za-z0-9_.-]+$/.test(part))
        throw new Error("plugins.moduleImportInvalid");
      parts.push(part);
    }
  }
  const path = parts.join("/");
  if (!path.toLowerCase().endsWith(".js"))
    throw new Error("plugins.moduleImportInvalid");
  return path;
}

// Blob URLs have no directory base; link only the captured package's module graph.
export function createPluginModule(
  source: PluginSource,
  entry: "service" | "ui",
): PluginModule {
  const entryPath =
    entry === "service"
      ? source.manifest.serviceEntry
      : source.manifest.uiEntry;
  const urls = new Map<string, string>();
  const visiting = new Set<string>();
  const dispose = () => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  };
  function link(path: string): string {
    const otherEntry =
      entry === "ui" ? source.manifest.serviceEntry : source.manifest.uiEntry;
    if (otherEntry && path === otherEntry)
      throw new Error("plugins.moduleImportInvalid");
    if (visiting.has(path)) throw new Error("plugins.moduleCycle");
    const existing = urls.get(path);
    if (existing) return existing;
    const text =
      path === source.manifest.serviceEntry
        ? source.serviceEntry
        : path === source.manifest.uiEntry
          ? source.uiEntry
          : Object.hasOwn(source.modules ?? {}, path)
            ? source.modules![path]
            : undefined;
    if (typeof text !== "string") throw new Error("plugins.moduleNotFound");
    visiting.add(path);
    let rewritten = "";
    let end = 0;
    let imports;
    try {
      [imports] = parse(text);
    } catch {
      throw new SyntaxError("plugins.checkSyntaxError");
    }
    for (const imported of imports) {
      if (imported.t !== 1 || imported.a !== -1 || imported.n === undefined)
        throw new Error("plugins.moduleImportUnsupported");
      const url = link(resolveModule(path, imported.n));
      rewritten += text.slice(end, imported.s) + url;
      end = imported.e;
    }
    rewritten += text.slice(end);
    const url = URL.createObjectURL(
      new Blob([rewritten], { type: "text/javascript" }),
    );
    urls.set(path, url);
    visiting.delete(path);
    return url;
  }
  try {
    if (!entryPath) throw new Error("plugins.moduleNotFound");
    return { url: link(entryPath), dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
