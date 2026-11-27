<script setup lang="ts">
import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AttachmentPreviewTarget } from "../../ai/attachment-runtime";
import { referenceKey } from "../../files/content-reference";

const props = defineProps<{
  scope?: string;
  enabled: boolean;
  target: AttachmentPreviewTarget;
  name: string;
}>();
const source = ref("");
watch(
  [
    () => props.scope,
    () => props.enabled,
    () =>
      props.target.kind === "attachment"
        ? props.target.id
        : referenceKey(props.target.reference),
  ],
  async (_value, _previous, cleanup) => {
    let current = true;
    cleanup(() => {
      current = false;
    });
    source.value = "";
    if (!props.scope || !props.enabled) return;
    try {
      const data = await invoke<string>("ai_attachment_preview", {
        scope: props.scope,
        target: props.target,
      });
      if (current) source.value = data;
    } catch {
      // The file remains attached when a thumbnail is unavailable.
    }
  },
  { immediate: true },
);
</script>

<template>
  <img v-if="source" :src="source" :alt="name" @error="source = ''" />
  <slot v-else />
</template>

<style scoped>
img {
  display: block;
  width: 64px;
  height: 42px;
  max-width: 100%;
  margin: var(--situate-space-1);
  object-fit: cover;
  border-radius: var(--situate-radius-small);
}
</style>
