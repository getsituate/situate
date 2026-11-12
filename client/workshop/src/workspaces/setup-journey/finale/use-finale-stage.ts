import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";
import { finaleFrame, type Rect } from "./score";

export function useFinaleStage(
  root: Ref<HTMLElement | undefined>,
  art: Ref<HTMLElement | undefined>,
  time: () => number | undefined,
) {
  const size = ref({ width: 1280, height: 900 });
  const origin = ref<{ rect: Rect; width: number; height: number }>();
  const scroll = ref(0);
  let observer: ResizeObserver | undefined;
  function measure(capture: boolean) {
    const host = root.value?.getBoundingClientRect();
    if (!host || !host.width || !host.height) return;
    size.value = { width: host.width, height: host.height };
    if (capture) {
      const image = art.value?.querySelector("svg")?.getBoundingClientRect();
      origin.value = {
        rect: image?.width
          ? {
              x: image.x - host.x,
              y: image.y - host.y,
              width: image.width,
              height: image.height,
            }
          : { x: host.width / 2, y: host.height + 16, width: 0, height: 0 },
        width: host.width,
        height: host.height,
      };
      scroll.value = root.value?.scrollTop ?? 0;
    }
  }
  watch(
    () => time() !== undefined,
    (active) => {
      if (active) {
        measure(true);
        if (root.value) root.value.scrollTop = 0;
      } else void nextTick(() => measure(true));
    },
  );
  onMounted(() => {
    measure(time() === undefined);
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => measure(time() === undefined));
      if (root.value) observer.observe(root.value);
      if (art.value) observer.observe(art.value);
    }
  });
  onBeforeUnmount(() => observer?.disconnect());
  const frame = computed(() => {
    const t = time();
    const start = origin.value;
    return t === undefined
      ? undefined
      : finaleFrame(
          t,
          size.value,
          start
            ? {
                x: (start.rect.x * size.value.width) / start.width,
                y: (start.rect.y * size.value.height) / start.height,
                width: (start.rect.width * size.value.width) / start.width,
                height: (start.rect.height * size.value.width) / start.width,
              }
            : undefined,
        );
  });
  return {
    frame,
    scroll,
    placeholderHeight: computed(() => origin.value?.rect.height ?? 0),
  };
}
