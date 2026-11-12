<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
const props = defineProps<{ id?: string; message: string }>();
const announcement = ref("");
const delivered = new Set(props.id ? [props.id] : []);
let delivery = 0;
watch(
  () => props.id,
  async (id) => {
    const current = ++delivery;
    announcement.value = "";
    if (!id || delivered.has(id)) return;
    delivered.add(id);
    const message = props.message;
    await nextTick();
    if (current === delivery && props.id === id) announcement.value = message;
  },
);
onBeforeUnmount(() => {
  ++delivery;
});
</script>

<template>
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {{ announcement }}
  </div>
</template>
