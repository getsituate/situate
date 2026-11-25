import type { LayoutAction, LayoutActionResult } from "../layout/actions";
import type { ViewTarget } from "../layout/navigation";
import type { UiCoordinator } from "../layout/registry";
import type { NavigationTicket } from "../layout/session";
import type { PaneEdge } from "../layout/tree";
import type {
  ShortcutDefaults,
  WorkspaceShortcuts,
} from "../layout/workspace-shortcuts";

export interface PluginShortcutDefinition {
  id: string;
  title: string;
  defaults?: ShortcutDefaults;
  run(): void | Promise<void>;
}

declare const paneTarget: unique symbol;
export type PluginPaneTarget = { readonly [paneTarget]: true };
export type PluginLayoutResult =
  | { readonly status: "applied"; readonly pane: PluginPaneTarget }
  | Exclude<LayoutActionResult, { status: "applied" }>;
type View = Extract<ViewTarget, { kind: "view" }>;
export interface PluginLayout {
  createTab(): Promise<PluginLayoutResult>;
  switchTab(direction: "next" | "previous"): Promise<PluginLayoutResult>;
  splitPane(edge: PaneEdge): Promise<PluginLayoutResult>;
  focusPane(direction: PaneEdge): Promise<PluginLayoutResult>;
  openInPane(pane: PluginPaneTarget, target: View): Promise<boolean>;
}

export function pluginLayout(
  coordinator?: UiCoordinator,
  shortcuts?: WorkspaceShortcuts,
  available: () => boolean = () => false,
): PluginLayout {
  const tickets = new WeakMap<PluginPaneTarget, NavigationTicket>();
  const isCurrent = () => available() && shortcuts?.isActive() === true;
  async function run(action: LayoutAction): Promise<PluginLayoutResult> {
    if (!shortcuts || !isCurrent()) return { status: "unavailable" };
    const result = await shortcuts.runLayout(action, isCurrent);
    if (result.status !== "applied") return result;
    const pane = Object.freeze({}) as PluginPaneTarget;
    tickets.set(pane, result.destination);
    return { status: "applied", pane };
  }
  function direction(edge: PaneEdge): PaneEdge {
    if (
      edge !== "left" &&
      edge !== "right" &&
      edge !== "top" &&
      edge !== "bottom"
    )
      throw new Error("plugins.invalidContributions");
    return edge;
  }
  return {
    createTab: () => run({ type: "create-tab" }),
    switchTab: async (step) => {
      if (step !== "next" && step !== "previous")
        throw new Error("plugins.invalidContributions");
      return run({ type: "cycle-tab", delta: step === "next" ? 1 : -1 });
    },
    splitPane: async (edge) =>
      run({ type: "split-pane", edge: direction(edge) }),
    focusPane: async (edge) =>
      run({ type: "focus-pane", direction: direction(edge) }),
    async openInPane(pane, target) {
      const ticket = tickets.get(pane);
      if (!ticket || !isCurrent() || target?.kind !== "view") return false;
      return (await coordinator?.open(target, ticket, { isCurrent })) ?? false;
    },
  };
}
