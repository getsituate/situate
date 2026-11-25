import { t } from "@situate/localization";
import defaults from "../../../contracts/keyboard-shortcuts.json";
import type { LayoutAction } from "./actions";

export type ShortcutPlatform = "macos" | "windows";
export type ShortcutAction = LayoutAction | { readonly type: "new-chat" };

type BuiltinShortcut = {
  readonly id: keyof typeof defaults;
  readonly title: () => string;
  readonly group: "tabs" | "panes" | "chat";
  readonly action: ShortcutAction;
  readonly defaults: Readonly<Record<ShortcutPlatform, string>>;
};

export const builtinShortcuts: readonly BuiltinShortcut[] = [
  {
    id: "layout.new-tab",
    title: () => t("shortcuts.actions.newTab"),
    group: "tabs",
    action: { type: "create-tab" },
    defaults: defaults["layout.new-tab"],
  },
  {
    id: "layout.close-tab",
    title: () => t("layoutUi.closeTab"),
    group: "tabs",
    action: { type: "close-tab" },
    defaults: defaults["layout.close-tab"],
  },
  {
    id: "layout.next-tab",
    title: () => t("shortcuts.actions.nextTab"),
    group: "tabs",
    action: { type: "cycle-tab", delta: 1 },
    defaults: defaults["layout.next-tab"],
  },
  {
    id: "layout.previous-tab",
    title: () => t("shortcuts.actions.previousTab"),
    group: "tabs",
    action: { type: "cycle-tab", delta: -1 },
    defaults: defaults["layout.previous-tab"],
  },
  {
    id: "layout.split-left",
    title: () => t("shortcuts.actions.splitLeft"),
    group: "panes",
    action: { type: "split-pane", edge: "left" },
    defaults: defaults["layout.split-left"],
  },
  {
    id: "layout.split-right",
    title: () => t("shortcuts.actions.splitRight"),
    group: "panes",
    action: { type: "split-pane", edge: "right" },
    defaults: defaults["layout.split-right"],
  },
  {
    id: "layout.split-up",
    title: () => t("shortcuts.actions.splitUp"),
    group: "panes",
    action: { type: "split-pane", edge: "top" },
    defaults: defaults["layout.split-up"],
  },
  {
    id: "layout.split-down",
    title: () => t("shortcuts.actions.splitDown"),
    group: "panes",
    action: { type: "split-pane", edge: "bottom" },
    defaults: defaults["layout.split-down"],
  },
  {
    id: "layout.close-pane",
    title: () => t("layoutUi.closePane"),
    group: "panes",
    action: { type: "close-active-view" },
    defaults: defaults["layout.close-pane"],
  },
  {
    id: "layout.focus-left",
    title: () => t("shortcuts.actions.focusLeft"),
    group: "panes",
    action: { type: "focus-pane", direction: "left" },
    defaults: defaults["layout.focus-left"],
  },
  {
    id: "layout.focus-right",
    title: () => t("shortcuts.actions.focusRight"),
    group: "panes",
    action: { type: "focus-pane", direction: "right" },
    defaults: defaults["layout.focus-right"],
  },
  {
    id: "layout.focus-up",
    title: () => t("shortcuts.actions.focusUp"),
    group: "panes",
    action: { type: "focus-pane", direction: "top" },
    defaults: defaults["layout.focus-up"],
  },
  {
    id: "layout.focus-down",
    title: () => t("shortcuts.actions.focusDown"),
    group: "panes",
    action: { type: "focus-pane", direction: "bottom" },
    defaults: defaults["layout.focus-down"],
  },
  {
    id: "chat.new",
    title: () => t("navigation.newChat"),
    group: "chat",
    action: { type: "new-chat" },
    defaults: defaults["chat.new"],
  },
];

export function shortcutPlatform(
  userAgent: string,
): ShortcutPlatform | undefined {
  if (/\bWindows NT\b/u.test(userAgent)) return "windows";
  if (/\bMacintosh\b/u.test(userAgent)) return "macos";
}

export function validCombination(
  binding: string,
  platform: ShortcutPlatform,
): boolean {
  if (binding.length > 80) return false;
  const parts = binding.split("+");
  const key = parts.pop() ?? "";
  const order = ["Control", "Alt", "Shift", "Meta"];
  if (
    !parts.some((part) => part !== "Shift") ||
    parts.some(
      (part, index) =>
        !order.includes(part) ||
        (index > 0 && order.indexOf(parts[index - 1]!) >= order.indexOf(part)),
    )
  )
    return false;
  const arrow = /^Arrow(?:Left|Right|Up|Down)$/u.test(key);
  const printable =
    Array.from(key).length === 1 &&
    !/[\p{C}\s]/u.test(key) &&
    key.toUpperCase() === key;
  if (
    !arrow &&
    !printable &&
    !/^(?:Space|Plus|Tab|Enter|Backspace|Delete|Home|End|PageUp|PageDown|F(?:[1-9]|1[0-9]|2[0-4]))$/u.test(
      key,
    )
  )
    return false;
  if (platform === "macos")
    return ![
      "Meta+Q",
      "Meta+Tab",
      "Shift+Meta+Tab",
      "Meta+Space",
      "Alt+Meta+Space",
    ].includes(binding);
  return (
    !parts.includes("Meta") &&
    !["Alt+Tab", "Alt+Shift+Tab", "Alt+F4"].includes(binding) &&
    !(parts.includes("Control") && parts.includes("Alt") && !arrow)
  );
}

export function keyCombination(event: KeyboardEvent): string | undefined {
  if (
    event.isComposing ||
    event.getModifierState("AltGraph") ||
    (!event.ctrlKey && !event.altKey && !event.metaKey) ||
    [
      "Control",
      "Alt",
      "Shift",
      "Meta",
      "Dead",
      "Unidentified",
      "Process",
    ].includes(event.key)
  )
    return;
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [
    event.ctrlKey && "Control",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Meta",
    key === "+" ? "Plus" : key === " " ? "Space" : key,
  ]
    .filter(Boolean)
    .join("+");
}
