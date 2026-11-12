import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  pluginToolPrefix,
  validateToolDescriptors,
  validateUiContributions,
} from "./contributions";

const tool = {
  name: "plugin_0123456789abcdef_lookup",
  description: "Synthetic lookup",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};
const view = {
  id: "demo:main",
  title: () => "Main",
  icon: "folder",
  component: { render: () => null },
};

describe("plugin contribution boundaries", () => {
  it.each([
    { tools: [] },
    { exports: { run: () => null } },
    { views: [{ ...view, id: "other:main" }] },
    { views: [{ ...view, title: "Main" }] },
    { views: [{ ...view, component: null }] },
    { views: [view], settings: view },
    { components: { invalid: null } },
    { dispose: true },
  ])("rejects invalid UI contributions: %j", (value) => {
    expect(() => validateUiContributions(value, "demo")).toThrow(
      "plugins.invalidContributions",
    );
  });

  it("preserves ordinary views, settings and explicit component exports", () => {
    const component = { render: () => null };
    const dispose = vi.fn();
    expect(
      validateUiContributions(
        {
          views: [view],
          settings: { ...view, id: "demo:settings" },
          components: { Card: component },
          dispose,
        },
        "demo",
      ),
    ).toEqual({
      views: [view],
      settings: { ...view, id: "demo:settings" },
      components: { Card: component },
      dispose,
    });
  });

  it.each([
    [{ ...tool, name: "invalid:name" }],
    [{ ...tool, name: "a".repeat(65) }],
    [
      {
        ...tool,
        parameters: { type: "object", properties: { query: "string" } },
      },
    ],
    [{ ...tool, parameters: { type: "object", required: [2] } }],
    [tool, tool],
  ])("rejects invalid or duplicate descriptors: %j", (...tools) => {
    expect(() => validateToolDescriptors(tools, new Set())).toThrow(
      "plugins.invalidContributions",
    );
  });

  it("rejects collisions and copies only serializable definition fields", () => {
    expect(() => validateToolDescriptors([tool], new Set([tool.name]))).toThrow(
      "plugins.invalidContributions",
    );
    const descriptors = validateToolDescriptors(
      [{ ...tool, execute: () => null, pluginId: "demo" }],
      new Set(),
    );
    expect(descriptors).toEqual([tool]);
    expect(descriptors[0].parameters).not.toBe(tool.parameters);
    expect(() => structuredClone(descriptors)).not.toThrow();
  });

  it("uses the bounded SHA-256 namespace", async () => {
    vi.stubGlobal("crypto", webcrypto);
    expect(await pluginToolPrefix("demo")).toBe("plugin_2a97516c354b6884_");
  });
});
