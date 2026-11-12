import type { LayoutNode } from "../tree";

export function dimensions(node: LayoutNode): {
  width: number;
  height: number;
} {
  if (node.kind === "pane") return { width: 280, height: 240 };
  const a = dimensions(node.first);
  const b = dimensions(node.second);
  return node.axis === "row"
    ? { width: a.width + b.width + 10, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + 10 };
}
