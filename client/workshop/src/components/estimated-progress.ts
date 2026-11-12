import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";

export const progressInspectionLimit = 120_000;
export function estimatedProgress(timeMs: number) {
  const time = Number.isFinite(timeMs)
    ? Math.max(0, Math.min(progressInspectionLimit, timeMs))
    : 0;
  return 0.08 + 0.86 * (1 - Math.exp(-time / 22_000));
}

export function useEstimatedProgress(
  root: Ref<HTMLElement | undefined>,
  paused: () => boolean,
  inspectedTime: () => number | null,
) {
  const elapsed = ref(0);
  const reduced = ref(false);
  const visible = ref(false);
  const hidden = ref(true);
  const covered = ref(false);
  const suspended = computed(
    () =>
      paused() ||
      reduced.value ||
      !visible.value ||
      hidden.value ||
      covered.value ||
      inspectedTime() !== null,
  );
  const time = computed(() => inspectedTime() ?? elapsed.value);
  let alive = false;
  let frame: number | undefined;
  let last: number | undefined;
  let media: MediaQueryList | undefined;
  let intersection: IntersectionObserver | undefined;
  let modal: MutationObserver | undefined;
  function stop() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    last = undefined;
  }
  function tick(now: number) {
    frame = undefined;
    if (!alive || suspended.value) {
      stop();
      return;
    }
    if (last !== undefined)
      elapsed.value = Math.min(
        progressInspectionLimit,
        elapsed.value + Math.max(0, now - last),
      );
    last = now;
    if (elapsed.value < progressInspectionLimit)
      frame = requestAnimationFrame(tick);
  }
  function reconcile() {
    if (!alive) return;
    reduced.value = media?.matches ?? true;
    hidden.value = document.visibilityState !== "visible";
    covered.value = !!document.querySelector(
      'dialog[open], [aria-modal="true"]',
    );
    if (suspended.value) stop();
    else if (frame === undefined && elapsed.value < progressInspectionLimit)
      frame = requestAnimationFrame(tick);
  }
  watch(() => [paused(), inspectedTime()], reconcile, { flush: "sync" });
  onMounted(() => {
    alive = true;
    media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    media?.addEventListener("change", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    if (typeof IntersectionObserver !== "undefined") {
      intersection = new IntersectionObserver((entries) => {
        const entry = entries.find((item) => item.target === root.value);
        if (!entry) return;
        visible.value =
          entry.isIntersecting &&
          entry.intersectionRect.width > 0 &&
          entry.intersectionRect.height > 0;
        reconcile();
      });
      if (root.value) intersection.observe(root.value);
    }
    modal = new MutationObserver(reconcile);
    modal.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open", "aria-modal"],
    });
    reconcile();
  });
  onBeforeUnmount(() => {
    alive = false;
    stop();
    intersection?.disconnect();
    modal?.disconnect();
    media?.removeEventListener("change", reconcile);
    document.removeEventListener("visibilitychange", reconcile);
  });
  return { time, suspended };
}
