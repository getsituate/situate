import type { MessageKey } from "@situate/localization";

export const accents = [
  "violet",
  "cobalt",
  "sky",
  "tangerine",
  "peach",
  "lemon",
] as const;
export type Accent = (typeof accents)[number];
export const accentLabels = {
  violet: "settings.appearance.violet",
  cobalt: "settings.appearance.cobalt",
  sky: "settings.appearance.sky",
  tangerine: "settings.appearance.tangerine",
  peach: "settings.appearance.peach",
  lemon: "settings.appearance.lemon",
} as const satisfies Record<Accent, MessageKey>;

export const companionAccents = {
  violet: "peach",
  cobalt: "peach",
  sky: "peach",
  tangerine: "sky",
  peach: "sky",
  lemon: "sky",
} as const satisfies Record<Accent, Accent>;

export interface AppearanceSnapshot {
  accent: Accent;
  writable: boolean;
  revision: string | null;
}
export function isAppearanceSnapshot(
  value: unknown,
): value is AppearanceSnapshot {
  if (!value || typeof value !== "object") return false;
  return (
    "accent" in value &&
    accents.some((accent) => accent === value.accent) &&
    "writable" in value &&
    typeof value.writable === "boolean" &&
    "revision" in value &&
    (value.revision === null ||
      (typeof value.revision === "string" && value.revision.length > 0))
  );
}

export function accentStyle(accent: Accent) {
  const color = `var(--situate-${accent})`;
  const companion = companionAccents[accent];
  const contentColor = `var(--situate-${companion})`;
  const contentStrength = companion === "sky" ? 36 : 52;
  const dark = accent === "violet" || accent === "cobalt";
  const strong =
    accent === "violet"
      ? "var(--situate-violet-deep)"
      : accent === "cobalt"
        ? `color-mix(in srgb, ${color} 85%, var(--situate-ink))`
        : `color-mix(in srgb, ${color} 35%, var(--situate-ink))`;
  return {
    "--situate-content-accent": contentColor,
    "--situate-content-tint": `color-mix(in srgb, ${contentColor} ${contentStrength}%, var(--situate-surface))`,
    "--situate-content-wash": `color-mix(in srgb, ${contentColor} 25%, var(--situate-surface))`,
    "--situate-accent": color,
    "--situate-accent-strong": strong,
    "--situate-accent-on": dark
      ? "var(--situate-surface)"
      : "var(--situate-ink)",
    "--situate-accent-edge": dark ? color : strong,
    "--situate-accent-soft":
      accent === "violet"
        ? "var(--situate-lilac)"
        : `color-mix(in srgb, ${color} 18%, var(--situate-surface))`,
  };
}
