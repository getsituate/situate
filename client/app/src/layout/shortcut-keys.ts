export type ShortcutPlatform = "macos" | "windows";

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
