import { Blob } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPluginModule, type PluginModule } from "./module-source";
import type { PluginSource } from "./types";

const source = (
  entry: string,
  modules: Record<string, string> = {},
): PluginSource => ({
  manifest: {
    schemaVersion: 2,
    id: "sample",
    name: "Sample",
    description: "Synthetic plugin",
    serviceEntry: "main.js",
    skills: [],
  },
  serviceEntry: entry,
  uiEntry: null,
  modules,
  skills: [],
});
let blobs: Map<string, Blob>;
const linked: PluginModule[] = [];
beforeEach(() => {
  blobs = new Map();
  vi.stubGlobal("Blob", Blob);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const url = `blob:module-${blobs.size}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => {
  for (const module of linked.splice(0)) module.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function link(input: PluginSource) {
  const module = createPluginModule(input, "service");
  linked.push(module);
  return module;
}

it("links nested imports, parent paths and re-exports, sharing one URL per module", async () => {
  const module = link(
    source(
      'import { value } from "./parts/index.js"; import "./shared.js"; export default () => value;',
      {
        "parts/index.js": 'export { value } from "../shared.js";',
        "shared.js": "export const value = 42;",
        "unused.js": "invalid unused JavaScript",
      },
    ),
  );
  expect(blobs.size).toBe(3);
  expect(await blobs.get("blob:module-0")!.text()).toBe(
    "export const value = 42;",
  );
  expect(await blobs.get("blob:module-1")!.text()).toBe(
    'export { value } from "blob:module-0";',
  );
  expect(await blobs.get(module.url)!.text()).toBe(
    'import { value } from "blob:module-1"; import "blob:module-0"; export default () => value;',
  );
  module.dispose();
  module.dispose();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
});

it("does not treat strings, comments, regular expressions or object methods as imports", async () => {
  const entry = String.raw`// import './missing.js'
const text = "import './missing.js'";
const pattern = /import\s+from/;
const methods = { import() {}, export() {} };
export default () => ({ text, pattern, methods });`;
  const module = link(source(entry));
  expect(await blobs.get(module.url)!.text()).toBe(entry);
});

it("resolves escaped specifiers without changing surrounding source", async () => {
  const module = link(
    source(String.raw`import './\u0061.js'; export default () => ({});`, {
      "a.js": "export const value = 1;",
    }),
  );
  expect(await blobs.get(module.url)!.text()).toBe(
    "import 'blob:module-0'; export default () => ({});",
  );
});

it.each([
  "vue",
  "/other.js",
  "https://example.invalid/remote.js",
  "data:text/javascript,export default 1",
  "file:///other.js",
  "blob:foreign",
  "../other.js",
  "./parts/../../other.js",
  "./helper",
  "./parts/",
  "./helper.js?version=1",
  "./helper.js#part",
  "./%2e%2e/other.js",
  "./a\\b.js",
])(
  "rejects imports outside the local explicit .js contract: %s",
  (specifier) => {
    expect(() => link(source(`import ${JSON.stringify(specifier)};`))).toThrow(
      "plugins.moduleImportInvalid",
    );
    expect(blobs.size).toBe(0);
  },
);

it.each([
  'export default () => import("./helper.js");',
  "export default (name) => import(name);",
  "export default import.meta.url;",
  'import value from "./helper.js" with { type: "json" };',
])("rejects unsupported import forms: %s", (entry) => {
  expect(() =>
    link(source(entry, { "helper.js": "export default 1;" })),
  ).toThrow("plugins.moduleImportUnsupported");
});

it("cleans partially linked graphs when a later import is missing", () => {
  expect(() =>
    link(
      source('import "./found.js"; import "./missing.js";', {
        "found.js": "export const value = 1;",
      }),
    ),
  ).toThrow("plugins.moduleNotFound");
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:module-0");
});

it.each<Record<string, string>>([
  { "helper.js": 'import "./main.js";' },
  {
    "helper.js": 'import "./nested.js";',
    "nested.js": 'export * from "./helper.js";',
  },
])(
  "rejects circular imports instead of recursively allocating modules",
  (modules) => {
    expect(() => link(source('import "./helper.js";', modules))).toThrow(
      "plugins.moduleCycle",
    );
    expect(blobs.size).toBe(0);
  },
);

it("does not resolve inherited properties as captured modules", () => {
  const modules = Object.create({ "helper.js": "export default 1;" });
  expect(() => link(source('import "./helper.js";', modules))).toThrow(
    "plugins.moduleNotFound",
  );
});

it("keeps fresh loads independent even for identical source", () => {
  const input = source('import "./helper.js"; export default () => ({});', {
    "helper.js": "export const state = {};",
  });
  const first = link(input),
    second = link(input);
  expect(first.url).not.toBe(second.url);
  expect(blobs.size).toBe(4);
  first.dispose();
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(second.url);
});

it.each([false, true])(
  "never links a service entry into the UI graph (transitive=%s)",
  (transitive) => {
    const input = source("export default () => ({ tools: [] });", {
      "shared.js": 'export * from "./main.js";',
    });
    input.manifest.uiEntry = "view.js";
    input.uiEntry = transitive
      ? 'import "./shared.js";'
      : 'import "./main.js";';
    expect(() => createPluginModule(input, "ui")).toThrow(
      "plugins.moduleImportInvalid",
    );
    expect(blobs.size).toBe(0);
  },
);

it("cleans linked modules when parsing a later module fails", () => {
  expect(() =>
    link(
      source('import "./found.js"; import "./broken.js";', {
        "found.js": "export default 1;",
        "broken.js": 'import "unterminated',
      }),
    ),
  ).toThrow(SyntaxError);
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:module-0");
});
