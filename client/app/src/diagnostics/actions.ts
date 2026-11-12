import type { LayoutIntent } from "../layout/model";

export function layoutAction(intent: LayoutIntent): string {
  if (intent.type === "close-pane") return "close";
  if (intent.type === "retain-presentation") return "navigate";
  return intent.type;
}
