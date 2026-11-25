import copy from "../localization/en.keyboard-shortcuts.json" with { type: "json" };
import type { PlatformId } from "../workshop/platform/model";

export { copy as shortcutCopy };

type Action = keyof typeof copy.actions;
type Group = keyof typeof copy.groups;
export type ShortcutOverrides = Partial<
  Record<PlatformId, Partial<Record<Action, string>>>
>;

const groups: Record<Group, Action[]> = {
  tabs: ["newTab", "nextTab", "previousTab"],
  panes: [
    "splitLeft",
    "splitRight",
    "focusLeft",
    "focusRight",
    "focusUp",
    "focusDown",
  ],
  general: ["search", "chat", "settings", "sidebar"],
};

const examples = {
  mac: {
    newTab: "Meta+T",
    nextTab: "Control+Tab",
    previousTab: "Control+Shift+Tab",
    splitLeft: "Control+Meta+Shift+ArrowLeft",
    splitRight: "Control+Meta+Shift+ArrowRight",
    focusLeft: "Control+Meta+ArrowLeft",
    focusRight: "Control+Meta+ArrowRight",
    focusUp: "Control+Meta+ArrowUp",
    focusDown: "Control+Meta+ArrowDown",
    search: "Meta+K",
    chat: "Meta+Shift+N",
    settings: "Meta+,",
    sidebar: "Meta+Shift+B",
  },
  windows: {
    newTab: "Control+T",
    nextTab: "Control+Tab",
    previousTab: "Control+Shift+Tab",
    splitLeft: "Control+Alt+Shift+ArrowLeft",
    splitRight: "Control+Alt+Shift+ArrowRight",
    focusLeft: "Control+Alt+ArrowLeft",
    focusRight: "Control+Alt+ArrowRight",
    focusUp: "Control+Alt+ArrowUp",
    focusDown: "Control+Alt+ArrowDown",
    search: "Control+K",
    chat: "Control+Shift+N",
    settings: "Control+,",
    sidebar: "Control+Shift+B",
  },
} satisfies Record<string, Record<Action, string>>;

function appleKeyboard(platform: PlatformId) {
  return platform === "mac" || platform === "ios";
}

export function shortcutGroups(
  platform: PlatformId,
  overrides: ShortcutOverrides,
) {
  const defaults = examples[appleKeyboard(platform) ? "mac" : "windows"];
  return (Object.keys(groups) as Group[]).map((id) => ({
    id,
    name: copy.groups[id],
    actions: groups[id].map((action) => ({
      id: action,
      name: copy.actions[action],
      original: defaults[action],
      keys: overrides[platform]?.[action] ?? defaults[action],
    })),
  }));
}

export function shortcutModifiers(platform: PlatformId) {
  return appleKeyboard(platform) ? copy.macModifiers : copy.otherModifiers;
}

export function shortcutKeys(binding: string, platform: PlatformId) {
  const apple = appleKeyboard(platform);
  const keys: Record<string, [string, string]> = {
    Control: [apple ? "⌃" : copy.keys.Ctrl, copy.keys.Control],
    Meta: apple
      ? ["⌘", copy.keys.Command]
      : platform === "windows"
        ? [copy.keys.Windows, copy.keys.Windows]
        : [copy.keys.Super, copy.keys.Super],
    Alt: apple ? ["⌥", copy.keys.Option] : [copy.keys.Alt, copy.keys.Alt],
    Shift: [apple ? "⇧" : copy.keys.Shift, copy.keys.Shift],
    ArrowLeft: ["←", copy.keys.ArrowLeft],
    ArrowRight: ["→", copy.keys.ArrowRight],
    ArrowUp: ["↑", copy.keys.ArrowUp],
    ArrowDown: ["↓", copy.keys.ArrowDown],
    Plus: ["+", copy.keys.Plus],
    Space: [copy.keys.Space, copy.keys.Space],
  };
  return binding
    ? binding.split("+").map((key) => keys[key] ?? [key, key])
    : [];
}

export function captureShortcut(event: KeyboardEvent): string | null {
  const { key, ctrlKey, metaKey, altKey, shiftKey } = event;
  if (
    event.isComposing ||
    event.getModifierState("AltGraph") ||
    [
      "Escape",
      "Dead",
      "Unidentified",
      "Control",
      "Meta",
      "Alt",
      "Shift",
      "AltGraph",
    ].includes(key) ||
    (key === "Tab" && !ctrlKey && !metaKey && !altKey)
  )
    return null;
  event.preventDefault();
  if (!ctrlKey && !metaKey && !altKey) return "";
  return [
    ctrlKey ? "Control" : "",
    metaKey ? "Meta" : "",
    altKey ? "Alt" : "",
    shiftKey ? "Shift" : "",
    key === "+"
      ? "Plus"
      : key === " "
        ? "Space"
        : key.length === 1
          ? key.toUpperCase()
          : key,
  ]
    .filter(Boolean)
    .join("+");
}
