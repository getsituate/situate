import { t } from "@situate/localization";
import defaults from "../../../contracts/keyboard-shortcuts.json";
import type { LayoutAction } from "./actions";
import type { ShortcutPlatform } from "./shortcut-keys";

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
