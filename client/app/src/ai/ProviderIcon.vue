<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { SituateIcon } from "@situate/ui";
import openai from "./assets/providers/openai.svg";
import anthropic from "./assets/providers/anthropic.svg";
import openrouter from "./assets/providers/openrouter.svg";
const props = defineProps<{ provider: string }>();
const failed = ref(false);
const source = computed(() => {
  switch (props.provider) {
    case "openai":
    case "openai-codex":
      return openai;
    case "anthropic":
      return anthropic;
    case "openrouter":
      return openrouter;
    default:
      return undefined;
  }
});
watch(
  () => props.provider,
  () => {
    failed.value = false;
  },
);
</script>
<template>
  <span class="provider-icon" aria-hidden="true">
    <img
      v-if="source && !failed"
      :src="source"
      alt=""
      width="28"
      height="28"
      @error="failed = true"
    />
    <SituateIcon v-else name="plugins" />
  </span>
</template>
<style scoped>
.provider-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
}
img {
  display: block;
  width: 28px;
  height: 28px;
  object-fit: contain;
}
</style>
