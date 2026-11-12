import { onBeforeUnmount, onMounted, type Ref } from "vue";

export function useDialogFocus(form: Ref<HTMLElement | undefined>) {
  let observer: ResizeObserver | undefined;
  let frame = 0;
  onMounted(() => {
    const dialog = form.value?.closest("dialog");
    if (!dialog || typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (form.value?.contains(document.activeElement)) {
          document.activeElement?.scrollIntoView({
            block: "nearest",
            inline: "nearest",
          });
        }
      });
    });
    observer.observe(dialog);
  });
  onBeforeUnmount(() => {
    observer?.disconnect();
    cancelAnimationFrame(frame);
  });
}
