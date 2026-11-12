<script setup lang="ts">
import { SituateButton } from "../ui";
import { f } from "./flow-content";
import type { OnboardingState } from "./model";
defineProps<{ state: OnboardingState }>();
defineEmits<{ open: [] }>();
</script>
<template>
  <aside class="import-status" :aria-label="f.importTitle">
    <p role="status">
      {{ f.importStates[state.importState]
      }}<small>{{ f.availableCount(state.imported.length) }}</small>
    </p>
    <SituateButton variant="plain" @click="$emit('open')">{{
      f.importConversation
    }}</SituateButton>
  </aside>
</template>
<style scoped>
.import-status {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 20px;
  padding: 8px 20px;
  border-top: 1px solid var(--situate-line);
  background: var(--situate-surface);
  color: var(--situate-ink);
  flex: none;
}
p {
  margin: 0;
  font-size: 0.8125rem;
}
small {
  display: block;
  color: var(--situate-muted);
  margin-top: 3px;
}
button {
  font: inherit;
  font-size: 0.8125rem;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--situate-control-line);
  background: var(--situate-surface);
  color: var(--situate-ink);
  border-radius: 18px;
  cursor: pointer;
}
button:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
@media (max-width: 600px) {
  .import-status {
    gap: 10px;
    padding: 8px 12px;
    justify-content: space-between;
  }
  button {
    max-width: 145px;
  }
}
</style>
