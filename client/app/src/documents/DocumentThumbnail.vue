<script setup lang="ts">
import { ref, watch } from "vue";
import { SituateIcon } from "@situate/ui";

const props = defineProps<{
  thumbnailKey: string;
  format: string;
  image?: Blob;
  observe: (element: Element, key: string) => () => void;
}>();
const element = ref<HTMLElement>();
const url = ref<string>();
watch([element, () => props.thumbnailKey], ([target, key], _, onCleanup) => {
  if (target) onCleanup(props.observe(target, key));
});
watch(
  () => props.image,
  (image, _, onCleanup) => {
    url.value = image ? URL.createObjectURL(image) : undefined;
    const created = url.value;
    if (created) onCleanup(() => URL.revokeObjectURL(created));
  },
  { immediate: true },
);
</script>

<template>
  <span ref="element" class="doc-thumbnail" aria-hidden="true">
    <img v-if="url" :src="url" alt="" @error="url = undefined" />
    <template v-else
      ><SituateIcon name="notes" /><span>{{ format }}</span></template
    >
  </span>
</template>
