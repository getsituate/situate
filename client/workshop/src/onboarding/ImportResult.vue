<script setup lang="ts">
import { SituateButton } from "../ui";
import ImportedFiles from "./ImportedFiles.vue";
import type { OnboardingAction, OnboardingState } from "./model";
import copy from "../localization/en.import-result.json";
defineProps<{ state: OnboardingState }>();
const emit = defineEmits<{ action: [action: OnboardingAction] }>();
</script>
<template>
  <section class="import-result">
    <p v-if="state.imported.length <= 50" class="intro">{{ copy.detail }}</p>
    <dl class="workspace-location">
      <dt>{{ copy.location }}</dt>
      <dd>{{ state.workspacePath }}</dd>
    </dl>
    <ImportedFiles
      :files="state.imported"
      :selected="state.importFile"
      :workspace-path="state.workspacePath"
      @select="emit('action', { type: 'view-import-file', key: $event })"
    />
    <footer>
      <div class="revisit">
        <SituateButton
          variant="plain"
          @click="
            emit('action', { type: 'open-source-chat', intent: 'changes' })
          "
        >
          {{ copy.changes }}
        </SituateButton>
        <SituateButton
          variant="plain"
          @click="
            emit('action', { type: 'open-source-chat', intent: 'additional' })
          "
        >
          {{ copy.additional }}
        </SituateButton>
      </div>
      <SituateButton
        :disabled="state.importState !== 'ready' || !state.imported.length"
        @click="emit('action', { type: 'continue-import-review' })"
        >{{ copy.continue }}</SituateButton
      >
    </footer>
  </section>
</template>
<style scoped>
.import-result {
  min-width: 0;
}
.intro {
  line-height: 1.6;
  margin: 0 0 16px;
}
.workspace-location {
  margin: 0 0 16px;
}
dt {
  color: var(--situate-muted);
  font-size: 13px;
}
dd {
  margin: 6px 0 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}
footer,
.revisit {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
footer {
  margin-top: 16px;
  padding-block: 12px;
  background: var(--situate-surface);
  border-top: 1px solid var(--situate-line);
  justify-content: space-between;
}
button {
  min-height: 44px;
  padding: 10px 16px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  border: 1px solid var(--situate-control-line);
  border-radius: 99px;
  font: inherit;
  cursor: pointer;
}
button:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
</style>
