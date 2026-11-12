import { t } from "@situate/localization";
import type { PaneEdge } from "../tree";

export const edges: readonly PaneEdge[] = ["left", "right", "top", "bottom"];

export function edgeTitle(edge: PaneEdge): string {
  switch (edge) {
    case "left":
      return t("layoutUi.edges.left");
    case "right":
      return t("layoutUi.edges.right");
    case "top":
      return t("layoutUi.edges.top");
    case "bottom":
      return t("layoutUi.edges.bottom");
  }
}
