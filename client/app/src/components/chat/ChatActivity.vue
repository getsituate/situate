<script setup lang="ts">
import { SituateButton } from "@situate/ui";
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { t } from "@situate/localization";

const MiniBendPlayful = defineAsyncComponent(
  () => import("./bend/MiniBendPlayful.vue"),
);
const props = defineProps<{
  comment?: string;
  compacting?: boolean;
  suspended?: boolean;
}>();
const paused = ref(false);
const root = ref<HTMLElement>();
const covered = ref(false);
const suspended = computed(() => props.suspended || covered.value);
let observer: MutationObserver | undefined;
function updateCoverage() {
  covered.value = [
    ...document.querySelectorAll(
      'dialog[open], [role="dialog"][aria-modal="true"]',
    ),
  ].some((dialog) => !dialog.contains(root.value!));
}
const fallbackPhrases = computed(() => [
  t("chat.activityWorking"),
  t("chat.activityProcessing"),
  t("chat.activityOngoing"),
  t("chat.activityWaiting"),
]);
const fallback = ref(Math.floor(Math.random() * 4));
const phrase = computed(() =>
  props.compacting
    ? t("chat.compacting")
    : props.comment?.trim() || fallbackPhrases.value[fallback.value],
);
const revealed = ref(phrase.value);
let rotation: ReturnType<typeof setTimeout> | undefined;
let typing: ReturnType<typeof setTimeout> | undefined;
let media: MediaQueryList | undefined;
function reveal() {
  clearTimeout(typing);
  const text = phrase.value;
  if (
    !media ||
    media.matches ||
    paused.value ||
    suspended.value ||
    document.visibilityState !== "visible"
  ) {
    revealed.value = text;
    return;
  }
  const characters = Array.from(text);
  let count = 0;
  const step = Math.max(1, Math.ceil(characters.length / 36));
  function tick() {
    count += step;
    revealed.value = characters.slice(0, count).join("");
    if (count < characters.length) typing = setTimeout(tick, 24);
  }
  tick();
}
function reconcile() {
  clearTimeout(rotation);
  clearTimeout(typing);
  revealed.value = phrase.value;
  if (suspended.value || paused.value || document.visibilityState !== "visible")
    return;
  if (!props.comment?.trim() && !props.compacting)
    rotation = setTimeout(() => {
      fallback.value =
        (fallback.value +
          1 +
          Math.floor(Math.random() * (fallbackPhrases.value.length - 1))) %
        fallbackPhrases.value.length;
    }, 9000);
}
watch(
  () => [phrase.value, suspended.value, paused.value],
  (value, previous) => {
    reconcile();
    if (value[0] !== previous[0]) reveal();
  },
);
onMounted(() => {
  updateCoverage();
  observer = new MutationObserver(updateCoverage);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open", "aria-modal"],
  });
  media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  media?.addEventListener("change", reconcile);
  document.addEventListener("visibilitychange", reconcile);
  reconcile();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  clearTimeout(rotation);
  clearTimeout(typing);
  media?.removeEventListener("change", reconcile);
  document.removeEventListener("visibilitychange", reconcile);
});
</script>

<template>
  <div ref="root" class="chat-activity">
    <span
      class="sr-only"
      role="status"
      aria-atomic="true"
      data-localization-content="external"
      >{{ phrase }}</span
    >
    <SituateButton
      variant="plain"
      type="button"
      class="bend-toggle"
      :aria-pressed="paused"
      :aria-label="
        paused ? t('chat.resumeAnimation') : t('chat.pauseAnimation')
      "
      @click="paused = !paused"
    >
      <MiniBendPlayful busy variant="mixed" :paused="paused || suspended" />
    </SituateButton>
    <div class="comment-space">
      <span class="activity-comment" aria-hidden="true"
        ><span class="comment-reserve" data-localization-content="external">{{
          phrase
        }}</span
        ><span class="comment-reveal" data-localization-content="external">{{
          revealed
        }}</span></span
      >
    </div>
  </div>
</template>

<style scoped>
.chat-activity {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 6px;
  min-height: 44px;
}
.bend-toggle {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--situate-violet-deep);
  --mini-bend-playful-size: 28px;
}
.bend-toggle[aria-pressed="true"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.bend-toggle:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
.comment-space {
  min-width: 0;
  flex: 1;
}
.comment-reserve {
  visibility: hidden;
}
.comment-reveal {
  position: absolute;
  inset: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.activity-comment {
  position: relative;
  display: block;
  font-size: 12px;
  line-height: 1.45;
  color: var(--situate-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
