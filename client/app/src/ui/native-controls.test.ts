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
  "menu",
  "progress",
]);
const sharedRoles = new Set(["menu", "switch", "progressbar", "tooltip"]);

function controls(node: RootNode | TemplateChildNode): string[] {
  const own: string[] = [];
  if (node.type === NodeTypes.ELEMENT && nativeControls.has(node.tag)) {
    const filePicker =
      node.tag === "input" &&
      node.props.some(
        (prop) =>
          prop.type === NodeTypes.ATTRIBUTE &&
          prop.name === "type" &&
          prop.value?.content === "file",
      );
    own.push(filePicker ? "input[type=file]" : node.tag);
  }
  if (node.type === NodeTypes.ELEMENT && /^[a-z]/.test(node.tag)) {
    for (const prop of node.props) {
      if (prop.type !== NodeTypes.ATTRIBUTE) continue;
      if (prop.name === "role" && sharedRoles.has(prop.value?.content ?? ""))
        own.push(`${node.tag}[role=${prop.value!.content}]`);
      if (prop.name === "popover") own.push(`${node.tag}[popover]`);
    }
  }
  if (node.type === NodeTypes.ROOT || node.type === NodeTypes.ELEMENT) {
    return [...own, ...node.children.flatMap(controls)];
  }
  return own;
}

describe("client UI boundary", () => {
  it("uses the UI library except for the native attachment picker", () => {
    const exceptions: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      const { descriptor, errors } = parseSfc(source);
      expect(errors, path).toEqual([]);
      if (!descriptor.template) continue;
      const found = controls(parse(descriptor.template.content));
      if (found.length) exceptions.push(`${path}: ${found.join(", ")}`);
    }
    expect(exceptions).toEqual([
      "../components/ChatComposer.vue: input[type=file]",
    ]);
  });
});
