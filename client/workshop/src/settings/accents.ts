export const accents = [
  "violet",
  "cobalt",
  "sky",
  "tangerine",
  "peach",
  "lemon",
] as const;
export type Accent = (typeof accents)[number];

export const companionAccents = {
  violet: "peach",
  cobalt: "peach",
  sky: "peach",
  tangerine: "sky",
  peach: "sky",
  lemon: "sky",
} as const satisfies Record<Accent, Accent>;

export function contentAccentStyle(accent: Accent) {
  const companion = companionAccents[accent];
  const color = `var(--situate-${companion})`;
  const tint = companion === "sky" ? 36 : 52;
  return {
    "--situate-content-accent": color,
    "--situate-content-tint": `color-mix(in srgb, ${color} ${tint}%, var(--situate-surface))`,
    "--situate-content-wash": `color-mix(in srgb, ${color} 25%, var(--situate-surface))`,
  };
}

export function accentStyle(accent: Accent) {
  const color = `var(--situate-${accent})`;
  const dark = accent === "violet" || accent === "cobalt";
  const strong =
    accent === "violet"
      ? "var(--situate-violet-deep)"
      : accent === "cobalt"
        ? `color-mix(in srgb, ${color} 85%, var(--situate-ink))`
        : `color-mix(in srgb, ${color} 35%, var(--situate-ink))`;
  return {
    ...contentAccentStyle(accent),
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
