<script setup lang="ts">
import { ref, watch } from "vue";
import { t } from "@situate/localization";
import type { ImageContent } from "../../ai/contracts";
import { attachmentImageSource } from "../../ai/api";

const props = defineProps<{
  scope: string;
  image: ImageContent;
  name?: string;
}>();
const source = ref("");
const failed = ref(false);
watch(
  () => [props.scope, props.image.data, props.image.mimeType] as const,
  async (_value, _previous, cleanup) => {
    let current = true;
    let resolved = "";
    cleanup(() => {
      current = false;
      if (resolved.startsWith("blob:")) URL.revokeObjectURL(resolved);
    });
    source.value = "";
    failed.value = false;
    try {
      resolved = await attachmentImageSource(props.scope, props.image);
      if (!current) {
        if (resolved.startsWith("blob:")) URL.revokeObjectURL(resolved);
        return;
      }
      source.value = resolved;
    } catch {
      if (current) failed.value = true;
    }
  },
  { immediate: true },
);
</script>

<template>
  <figure class="chat-image">
    <img
      v-if="source && !failed"
      :src="source"
      :alt="name || t('chat.image')"
      loading="lazy"
      @error="failed = true"
    />
    <p v-if="failed" role="status">{{ t("chat.attachmentUnavailable") }}</p>
    <figcaption v-if="name" data-localization-content="user">
      {{ name }}
    </figcaption>
  </figure>
</template>

<style scoped>
.chat-image {
  margin: 12px 0;
  min-width: 0;
}
img {
  display: block;
  max-width: 100%;
  max-height: 480px;
  object-fit: contain;
  border-radius: 10px;
}
figcaption,
p {
  margin: 5px 0;
  font-size: var(--situate-text-caption);
  color: var(--situate-muted);
  overflow-wrap: anywhere;
}
</style>
