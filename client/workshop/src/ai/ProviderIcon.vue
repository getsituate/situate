<script setup lang="ts">
import { computed, ref, watch } from "vue";
import SituateIcon from "../ui/SituateIcon.vue";
import { providerLogos } from "./provider-logos";

const props = defineProps<{ provider: string }>();
const failed = ref(false);
const source = computed(() => providerLogos.get(props.provider));
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
.provider-icon img {
  display: block;
  width: 28px;
  height: 28px;
  object-fit: contain;
}
</style>
