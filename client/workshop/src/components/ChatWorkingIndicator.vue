<script setup lang="ts">
import { SituateButton } from "../ui";
import { ref } from "vue";
import MiniBendPlayful from "../mini-bend-playful/MiniBendPlayful.vue";
import type { Variant } from "../mini-bend-playful/gestures";
import { chatContent as c } from "./chat-content";
withDefaults(
  defineProps<{
    comment: string;
    covered?: boolean;
    variant?: Variant;
    status?: string;
  }>(),
  { covered: false, variant: "mixed" },
);
const paused = ref(false);
const emit = defineEmits<{ pause: [paused: boolean] }>();
function toggle() {
  paused.value = !paused.value;
  emit("pause", paused.value);
}
</script>
<template>
  <div class="bend-status">
    <SituateButton
      variant="plain"
      class="bend-motion"
      :aria-label="paused ? c.resumeAnimation : c.pauseAnimation"
      :aria-pressed="paused"
      @click="toggle"
    >
      <MiniBendPlayful busy :paused="paused || covered" :variant="variant" />
    </SituateButton>
    <span class="sr-only" role="status">{{ status ?? c.working }}</span>
    <span class="bend-comment" :title="comment">{{ comment }}</span>
  </div>
</template>
<style scoped>
.bend-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px 0;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-size: 12px;
  min-width: 0;
}
.bend-comment {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--situate-muted);
  font-size: 12px;
}
.bend-motion {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  min-height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  padding: 0;
  --mini-bend-playful-size: 28px;
}
.bend-motion[aria-pressed="true"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
</style>
