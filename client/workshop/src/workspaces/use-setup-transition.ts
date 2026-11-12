import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";
import { transitionDuration, transitionFrame } from "./setup-transition";
import { openingDuration, openingFrame } from "./setup-journey/opening";

export function useSetupTransition(
  root: Ref<HTMLElement | undefined>,
  paused: () => boolean,
  inspectedTime: () => number | null,
  inspectedOpening: () => number | null = () => null,
) {
  const mode = ref<"step" | "opening">("step");
  const duration = computed(() =>
    mode.value === "opening" ? openingDuration : transitionDuration,
  );
  const inspection = () =>
    mode.value === "opening" ? inspectedOpening() : inspectedTime();
  const elapsed = ref(transitionDuration);
  const from = ref(0),
    to = ref(1);
  const reduced = ref(false);
  let alive = false,
    visible = true;
  let raf: number | undefined, last: number | undefined;
  let preference: MediaQueryList | undefined;
  let intersection: IntersectionObserver | undefined;
  let modals: MutationObserver | undefined;
  const time = computed(() =>
    reduced.value || paused()
      ? duration.value
      : (inspection() ?? elapsed.value),
  );
  const frame = computed(() =>
    transitionFrame(time.value, from.value, to.value),
  );
  const opening = computed(() =>
    mode.value === "opening" ? openingFrame(time.value) : undefined,
  );
  const active = computed(() => time.value < duration.value);
  function stop() {
    if (raf !== undefined) cancelAnimationFrame(raf);
    raf = undefined;
    last = undefined;
  }
  function tick(now: number) {
    raf = undefined;
    if (!alive) return;
    if (last !== undefined)
      elapsed.value = Math.min(
        duration.value,
        elapsed.value + Math.max(0, now - last),
      );
    last = now;
    if (elapsed.value < duration.value) raf = requestAnimationFrame(tick);
    else stop();
  }
  function reconcile() {
    if (!alive) return;
    reduced.value = preference?.matches ?? false;
    if (reduced.value || paused()) {
      elapsed.value = duration.value;
      stop();
      return;
    }
    if (
      inspection() !== null ||
      elapsed.value >= duration.value ||
      !visible ||
      document.visibilityState !== "visible" ||
      document.querySelector('dialog[open], [aria-modal="true"]')
    )
      stop();
    else if (raf === undefined) raf = requestAnimationFrame(tick);
  }
  function start(
    previous: number,
    next: number,
    kind: "step" | "opening" = "step",
  ) {
    stop();
    mode.value = kind;
    from.value = previous;
    to.value = next;
    elapsed.value = 0;
    reconcile();
  }
  function finish() {
    elapsed.value = duration.value;
    stop();
  }
  const startOpening = () => start(0, 0, "opening");
  watch([paused, inspectedTime, inspectedOpening], reconcile);
  onMounted(() => {
    alive = true;
    preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    preference?.addEventListener("change", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    if (typeof IntersectionObserver !== "undefined") {
      intersection = new IntersectionObserver((entries) => {
        const entry = entries.find((item) => item.target === root.value);
        if (entry) {
          visible = entry.isIntersecting;
          reconcile();
        }
      });
      if (root.value) intersection.observe(root.value);
    }
    modals = new MutationObserver(reconcile);
    modals.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "aria-modal"],
    });
    reconcile();
  });
  onBeforeUnmount(() => {
    alive = false;
    stop();
    intersection?.disconnect();
    modals?.disconnect();
    preference?.removeEventListener("change", reconcile);
    document.removeEventListener("visibilitychange", reconcile);
  });
  return { frame, opening, mode, active, start, startOpening, finish };
}
