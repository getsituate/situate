export function themePopupHost(anchor: HTMLElement | null | undefined) {
  return anchor?.closest<HTMLElement>(
    "[data-theme-surface], [data-theme-defaults]",
  );
}
