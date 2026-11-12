import { parse as parseSfc } from "@vue/compiler-sfc";
import {
  NodeTypes,
  parse,
  type RootNode,
  type TemplateChildNode,
} from "@vue/compiler-dom";
import { describe, expect, it } from "vitest";

const sources = import.meta.glob<string>("../**/*.vue", {
  query: "?raw",
  import: "default",
  eager: true,
});
const nativeControls = new Set([
  "button",
  "input",
  "textarea",
  "select",
  "dialog",
  "details",
  "summary",
  "progress",
]);
const sharedRoles = new Set(["menu", "switch", "tooltip", "progressbar"]);

function controls(node: RootNode | TemplateChildNode): string[] {
  const own = "tag" in node && nativeControls.has(node.tag) ? [node.tag] : [];
  if (node.type === NodeTypes.ELEMENT) {
    for (const prop of node.props) {
      if (
        prop.type === NodeTypes.ATTRIBUTE &&
        prop.name === "role" &&
        prop.value &&
        sharedRoles.has(prop.value.content)
      ) {
        own.push(`role=${prop.value.content}`);
      }
    }
  }
  if (node.type === NodeTypes.ROOT || node.type === NodeTypes.ELEMENT) {
    return [...own, ...node.children.flatMap(controls)];
  }
  return own;
}

describe("workshop UI boundary", () => {
  it("keeps native control implementations in the UI library", () => {
    const exceptions: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      if (path.startsWith("../ui/")) continue;
      const { descriptor, errors } = parseSfc(source);
      expect(errors, path).toEqual([]);
      if (!descriptor.template) continue;
      const found = controls(parse(descriptor.template.content));
      if (found.length)
        exceptions.push(`${path}: ${[...new Set(found)].join(", ")}`);
    }
    expect(exceptions).toEqual([]);
  });
});
