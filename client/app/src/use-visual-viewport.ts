import { onBeforeUnmount, onMounted } from "vue";

export function useVisualViewport(): void {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  function update(): void {
    // WKWebView's keyboard resizes the visual viewport, not the CSS layout viewport.
    // Pinch zoom must keep the layout intact rather than reflowing into the zoomed area.
    const occluded =
      viewport && viewport.scale === 1 && viewport.height < window.innerHeight;
    if (occluded) {
      root.style.setProperty("--app-viewport-height", `${viewport.height}px`);
      root.style.setProperty("--app-viewport-top", `${viewport.offsetTop}px`);
      root.style.setProperty("--app-safe-area-bottom", "0px");
    } else {
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-top");
      root.style.removeProperty("--app-safe-area-bottom");
    }
  }
  onMounted(() => {
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
  });
  onBeforeUnmount(() => {
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    root.style.removeProperty("--app-viewport-height");
    root.style.removeProperty("--app-viewport-top");
    root.style.removeProperty("--app-safe-area-bottom");
  });
}
