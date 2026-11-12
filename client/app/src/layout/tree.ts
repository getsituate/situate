export type PaneEdge = "left" | "right" | "top" | "bottom";

export type LayoutNode =
  | { readonly kind: "pane"; readonly id: string }
  | {
      readonly kind: "split";
      readonly id: string;
      readonly axis: "row" | "column";
      readonly ratio: number;
      readonly first: LayoutNode;
      readonly second: LayoutNode;
    };

export function paneOrder(node: LayoutNode): string[] {
  return node.kind === "pane"
    ? [node.id]
    : [...paneOrder(node.first), ...paneOrder(node.second)];
}

export function insertPane(
  node: LayoutNode,
  targetId: string,
  paneId: string,
  edge: PaneEdge,
  splitId: string,
): LayoutNode {
  if (node.kind === "pane") {
    if (node.id !== targetId) return node;
    const added: LayoutNode = { kind: "pane", id: paneId };
    const before = edge === "left" || edge === "top";
    return {
      kind: "split",
      id: splitId,
      axis: edge === "left" || edge === "right" ? "row" : "column",
      ratio: 0.5,
      first: before ? added : node,
      second: before ? node : added,
    };
  }
  const first = insertPane(node.first, targetId, paneId, edge, splitId);
  const second = insertPane(node.second, targetId, paneId, edge, splitId);
  return first === node.first && second === node.second
    ? node
    : { ...node, first, second };
}

export function removePane(
  node: LayoutNode,
  paneId: string,
): LayoutNode | null {
  if (node.kind === "pane") return node.id === paneId ? null : node;
  const first = removePane(node.first, paneId);
  const second = removePane(node.second, paneId);
  if (!first) return second;
  if (!second) return first;
  return first === node.first && second === node.second
    ? node
    : { ...node, first, second };
}

export function resizeSplit(
  node: LayoutNode,
  splitId: string,
  ratio: number,
): LayoutNode {
  if (
    node.kind === "pane" ||
    !Number.isFinite(ratio) ||
    ratio <= 0 ||
    ratio >= 1
  )
    return node;
  if (node.id === splitId)
    return ratio === node.ratio ? node : { ...node, ratio };
  const first = resizeSplit(node.first, splitId, ratio);
  const second = resizeSplit(node.second, splitId, ratio);
  return first === node.first && second === node.second
    ? node
    : { ...node, first, second };
}
