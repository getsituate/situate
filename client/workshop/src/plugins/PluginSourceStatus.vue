<script setup lang="ts">
import { SituateButton } from "../ui";
import { c } from "./content";
import { c as documents } from "../documents/content";
import type { Source } from "../documents/model";
defineProps<{
  source: Source;
  enabled: boolean;
  refreshing: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{ refresh: [] }>();
</script>
<template>
  <div class="plugin-source-status">
    <p
      :role="
        refreshing || (enabled && source.status === 'error')
          ? 'status'
          : undefined
      "
    >
      {{
        refreshing
          ? documents.refreshing
          : !enabled || source.paused
            ? c.sourcePaused
            : source.status === "error"
              ? documents.sourceProblem
              : source.pending
                ? `${source.pending} · ${documents.preparing}`
                : source.status === "ready"
                  ? c.sourceReady
                  : documents.freshness
      }}
    </p>
    <small>{{ documents.lastChecked }}: {{ source.checked }}</small>
    <SituateButton
      variant="secondary"
      size="small"
      :disabled="!enabled || source.paused || busy"
      @click="emit('refresh')"
    >
      {{ refreshing ? documents.refreshing : documents.refresh }}
    </SituateButton>
  </div>
</template>
<style scoped>
.plugin-source-status {
  display: grid;
  justify-items: start;
  gap: 8px;
  margin-block: 16px;
}
.plugin-source-status p {
  margin: 0;
}
.plugin-source-status small {
  color: var(--situate-muted);
}
</style>
