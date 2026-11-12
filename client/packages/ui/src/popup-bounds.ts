import "./popup-bounds.css";

export function popupBounds(element: HTMLElement) {
  const viewport = window.visualViewport;
  const style = getComputedStyle(element);
  const inset = (side: string) =>
    Number.parseFloat(style.getPropertyValue(`--situate-popup-safe-${side}`)) ||
    0;
  return {
    left: Math.max(viewport?.offsetLeft ?? 0, inset("left")) + 8,
    top: Math.max(viewport?.offsetTop ?? 0, inset("top")) + 8,
    right:
      Math.min(
        (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth),
        window.innerWidth - inset("right"),
      ) - 8,
    bottom:
      Math.min(
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
        window.innerHeight - inset("bottom"),
      ) - 8,
  };
}
