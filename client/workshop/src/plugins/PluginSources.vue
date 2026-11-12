<script setup lang="ts">
import { computed } from "vue";
import { SituateIcon, SituateButton } from "../ui";
import PluginCard from "./PluginCard.vue";
import PluginSourceStatus from "./PluginSourceStatus.vue";
import { c } from "./content";
import { canEnablePlugin, type PluginState } from "./model";
import type { DocumentsState } from "../documents/model";
const props = defineProps<{ state: PluginState; documents: DocumentsState }>();
const emit = defineEmits<{
  create: [];
  detail: [id: string];
  uninstall: [id: string];
  develop: [id: string];
  inspect: [id: string, event: MouseEvent];
  disable: [id: string, event: MouseEvent];
  enable: [id: string];
  refresh: [id: string];
}>();
const sources = computed(() =>
  props.state.plugins
    .filter((p) => p.kind === "source")
    .flatMap((plugin) => {
      const source = props.documents.sources.find((s) => s.id === plugin.id);
      return source ? [{ plugin, source }] : [];
    }),
);
</script>
<template>
  <section class="plugin-sources" :aria-label="c.sources">
    <header class="plugin-sources-heading">
      <div>
        <h2
          class="plugin-collection-label"
          tabindex="-1"
          data-source-list-heading
        >
          {{ c.sources }} <span>{{ sources.length }}</span>
        </h2>
        <p class="plugin-muted">{{ c.sourcesHelp }}</p>
      </div>
      <SituateButton variant="secondary" size="small" @click="emit('create')">
        {{ c.createSource }}
      </SituateButton>
    </header>
    <p v-if="!sources.length" class="plugin-muted">{{ c.noSourcesHelp }}</p>
    <div class="plugin-card-grid">
      <PluginCard
        v-for="{ plugin, source } in sources"
        :key="plugin.id"
        :plugin="plugin"
        :illustrated="state.cardStyle === 'illustrated'"
        :can-enable="canEnablePlugin(state, plugin)"
        :settings-label="c.configure"
        :unavailable-help="c.sourceDisabled"
        @uninstall="emit('uninstall', plugin.id)"
        @develop="emit('develop', plugin.id)"
        @settings="emit('detail', plugin.id)"
        @inspect="emit('inspect', plugin.id, $event)"
        @toggle="
          plugin.enabled
            ? emit('disable', plugin.id, $event)
            : emit('enable', plugin.id)
        "
      >
        <template #artwork
          ><div class="plugin-source-mark" aria-hidden="true">
            <SituateIcon name="notes" /></div
        ></template>
        <PluginSourceStatus
          :source="source"
          :enabled="plugin.enabled"
          :busy="!!documents.pending"
          :refreshing="documents.pending?.id === source.id"
          @refresh="emit('refresh', source.id)"
        />
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
        <template #notice
          ><p
            v-if="!plugin.enabled && !canEnablePlugin(state, plugin)"
            class="plugin-muted"
          >
            {{ c.dependencyHelp }}
          </p></template
        >
      </PluginCard>
    </div>
  </section>
</template>
<style scoped>
.plugin-sources {
  margin-top: 36px;
}
.plugin-sources-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.plugin-sources-heading p {
  max-width: 52ch;
  font-size: 14px;
}
.plugin-source-mark {
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  border-radius: var(--situate-radius-control);
  background: var(--situate-lilac);
  color: var(--situate-violet-deep);
}
.plugin-source-mark svg {
  width: 28px;
  height: 28px;
}
</style>
