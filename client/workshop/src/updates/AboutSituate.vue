<script setup lang="ts">
import { SituateButton } from "../ui";
import copy from "../localization/en.updates.json" with { type: "json" };
import type { UpdateState, UpdateAction } from "./model";
defineProps<{ state: UpdateState }>();
const emit = defineEmits<{ action: [action: UpdateAction] }>();
function openHistory(event: MouseEvent) {
  (event.currentTarget as HTMLElement).focus();
  emit("action", { type: "show-notes" });
}
</script>

<template>
  <section class="about-situate">
    <p>{{ copy.version.replace("{version}", state.installed) }}</p>
    <SituateButton variant="secondary" @click="openHistory">{{
      copy.readNotes
    }}</SituateButton>
  </section>
</template>

<style scoped>
.about-situate p {
  margin: 0 0 24px;
  color: var(--situate-muted);
  font-variant-numeric: tabular-nums;
}
</style>
