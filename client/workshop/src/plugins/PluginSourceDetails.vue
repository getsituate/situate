<script setup lang="ts">
import { SituateButton } from "../ui";
import { c } from "./content";
import { c as documents } from "../documents/content";
import type { DocumentsState, Source } from "../documents/model";
import type { Plugin, PluginState } from "./model";
import PluginSourceStatus from "./PluginSourceStatus.vue";
defineProps<{
  plugin: Plugin;
  source: Source;
  state: PluginState;
  documentsState: DocumentsState;
}>();
const emit = defineEmits<{
  refresh: [id: string];
  detail: [id: string];
  documents: [];
  develop: [id: string];
}>();
</script>
<template>
  <section class="plugin-source-details" :aria-label="c.sourceKind">
    <h2>{{ c.sourceKind }}</h2>
    <p>{{ plugin.description }}</p>
    <PluginSourceStatus
      :source="source"
      :enabled="plugin.enabled"
      :busy="!!documentsState.pending"
      :refreshing="documentsState.pending?.id === source.id"
      @refresh="emit('refresh', source.id)"
    />
    <h3>{{ c.sourceScope }}</h3>
    <dl>
      <dt>{{ documents.scope }}</dt>
      <dd>{{ source.included }}</dd>
      <dt>{{ documents.excluded }}</dt>
      <dd>{{ source.excluded }}</dd>
      <dt>{{ documents.rules }}</dt>
      <dd>{{ source.rules }}</dd>
    </dl>
    <div v-if="plugin.dependencies.length" class="plugin-dependency-links">
      <span>{{ c.usesLabel }}</span>
      <SituateButton
        variant="ghost"
        size="small"
        v-for="id in plugin.dependencies"
        :key="id"
        class="plugin-text"
        @click="emit('detail', id)"
      >
        {{ state.plugins.find((p) => p.id === id)?.name ?? id }}
      </SituateButton>
    </div>
    <p v-else class="plugin-muted">{{ c.sourceStandalone }}</p>
    <div class="plugin-actions">
      <SituateButton
        variant="secondary"
        size="small"
        @click="emit('develop', plugin.id)"
      >
        {{ c.develop }} ↗
      </SituateButton>
      <SituateButton
        variant="ghost"
        size="small"
        class="plugin-text"
        @click="emit('documents')"
      >
        {{ c.viewDocuments }} →
      </SituateButton>
    </div>
  </section>
</template>
<style scoped>
.plugin-source-details {
  max-width: 64ch;
}
.plugin-source-details dl {
  display: grid;
  gap: 8px;
  margin-block: 16px 24px;
}
.plugin-source-details dt {
  font-size: 13px;
  color: var(--situate-muted);
}
.plugin-source-details dd {
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
</style>
