import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";
import { finaleDuration, type FinaleState } from "./score";

export function useFinalePlayback(
  root: Ref<HTMLElement | undefined>,
  state: () => FinaleState,
  disabled: () => boolean,
  finished: () => void,
  duration = finaleDuration,
) {
  const elapsed = ref(0),
    reduced = ref(false);
  const time = computed(() =>
    reduced.value || disabled() ? duration : (state().timeMs ?? elapsed.value),
  );
  let alive = false,
    visible = true,
    completed = false;
  let request: number | undefined, last: number | undefined;
  let preference: MediaQueryList | undefined;
  let intersection: IntersectionObserver | undefined;
  let modal: MutationObserver | undefined;
  function stop() {
    if (request !== undefined) cancelAnimationFrame(request);
    request = undefined;
    last = undefined;
  }
  function finish() {
    if (!alive || completed || state().status !== "playing") return;
    completed = true;
    elapsed.value = duration;
    stop();
    finished();
  }
  function tick(now: number) {
    request = undefined;
    if (!alive) return;
    if (last !== undefined)
      elapsed.value = Math.min(
        duration,
        elapsed.value + Math.max(0, now - last),
      );
    last = now;
    if (elapsed.value >= duration) finish();
    else request = requestAnimationFrame(tick);
  }
  function reconcile() {
    if (!alive) return;
    reduced.value = preference?.matches ?? false;
    if (state().status !== "playing" || completed) {
      stop();
      return;
    }
    if (state().timeMs !== null) {
      stop();
      return;
    }
    if (reduced.value || disabled()) {
      finish();
      return;
    }
    if (
      state().paused ||
      !visible ||
      document.visibilityState !== "visible" ||
      document.querySelector('dialog[open], [aria-modal="true"]')
    )
      stop();
    else if (request === undefined) request = requestAnimationFrame(tick);
  }
  watch(
    () => [state().status, state().run],
    ([status, run], [previous, priorRun]) => {
      if (status === "playing" && (previous !== status || priorRun !== run)) {
        stop();
        completed = false;
        elapsed.value = 0;
      }
      reconcile();
    },
  );
  watch(() => [state().timeMs, state().paused, disabled()], reconcile);
  onMounted(() => {
    alive = true;
    preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    preference?.addEventListener("change", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    if (typeof IntersectionObserver !== "undefined") {
      intersection = new IntersectionObserver((entries) => {
        const entry = entries.find((e) => e.target === root.value);
        if (entry) {
          visible = entry.isIntersecting;
          reconcile();
        }
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
    preference?.removeEventListener("change", reconcile);
    document.removeEventListener("visibilitychange", reconcile);
  });
  return { time, reduced, finish };
}
