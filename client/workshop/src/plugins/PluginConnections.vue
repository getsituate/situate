<script setup lang="ts">
import { computed } from "vue";
import { SituateIcon, SituateButton } from "../ui";
import PluginCard from "./PluginCard.vue";
import { c } from "./content";
import { gmailCopy } from "./gmail-experiment";
import {
  connectionAvailability,
  hasConnectedAccess,
} from "./connection-readiness";
import { connectionConsumers, type PluginState } from "./model";
const props = defineProps<{ state: PluginState }>();
const emit = defineEmits<{
  detail: [id: string];
  uninstall: [id: string];
  develop: [id: string];
  inspect: [id: string, event: MouseEvent];
  disable: [id: string, event: MouseEvent];
  enable: [id: string];
}>();
function isExperimental(id: string) {
  return id === "gmail" && !!props.state.gmailExperiment;
}
const connections = computed(() =>
  props.state.plugins.filter(
    (plugin) =>
      plugin.kind === "connector" &&
      (plugin.id !== "gmail" || props.state.gmailExperiment?.enabled !== false),
  ),
);
</script>
<template>
  <section
    v-if="connections.length || !state.gmailExperiment"
    class="plugin-connections"
    :aria-label="c.connections"
  >
    <header class="plugin-connections-heading">
      <h2 class="plugin-collection-label">
        {{ c.connections }} <span>{{ connections.length }}</span>
      </h2>
      <p>{{ c.connectionsHelp }}</p>
    </header>
    <div class="plugin-connection-list plugin-card-grid">
      <PluginCard
        v-for="connection in connections"
        :key="connection.id"
        class="plugin-connector-row"
        :class="{ 'plugin-connector-compact': isExperimental(connection.id) }"
        :plugin="connection"
        :title-note="
          isExperimental(connection.id) ? gmailCopy.badge : undefined
        "
        :compact-actions="isExperimental(connection.id)"
        :illustrated="state.cardStyle === 'illustrated'"
        :settings-label="c.configure"
        :unavailable-help="c.connectionDisabled"
        @uninstall="emit('uninstall', connection.id)"
        @develop="emit('develop', connection.id)"
        @settings="emit('detail', connection.id)"
        @inspect="emit('inspect', connection.id, $event)"
        @toggle="
          connection.enabled
            ? emit('disable', connection.id, $event)
            : emit('enable', connection.id)
        "
      >
        <template #artwork>
          <div class="plugin-connection-mark" aria-hidden="true">
            <SituateIcon
              :name="connection.id === 'calendar' ? 'calendar' : 'plugins'"
            />
          </div>
        </template>
        <div class="plugin-connection-status">
          <span v-if="!isExperimental(connection.id)">{{
            c.assignment.codeAvailable
          }}</span>
          <span v-if="!isExperimental(connection.id)">{{
            connectionAvailability(state, connection.id) !== "ready"
              ? c.assignment.readiness[
                  connectionAvailability(state, connection.id)
                ]
              : hasConnectedAccess(state, connection.id)
                ? c.assignment.readyToUse
                : c.assignment.accountAccessNeeded
          }}</span>
          <span>{{
            c.connectedAccounts(
              (state.accounts[connection.id] ?? []).filter(
                (a) => a.status === "connected",
              ).length,
            )
          }}</span>
          <span
            v-if="
              state.accounts[connection.id]?.some((a) => a.status === 'expired')
            "
            >{{ c.accountExpired }}</span
          >
        </div>
        <div
          v-if="
            !isExperimental(connection.id) &&
            connectionConsumers(state, connection.id).length
          "
          class="plugin-dependency-links"
        >
          <span>{{ c.usedBy }}</span>
          <SituateButton
            variant="ghost"
            size="small"
            v-for="consumer in connectionConsumers(state, connection.id)"
            :key="consumer.id"
            class="plugin-text"
            @click="emit('detail', consumer.id)"
          >
            {{ consumer.name }}
          </SituateButton>
        </div>
        <p v-else-if="!isExperimental(connection.id)" class="plugin-muted">
          {{ c.noConsumers }}
        </p>
      </PluginCard>
    </div>
  </section>
</template>
<style scoped>
.plugin-connections {
  margin-top: 36px;
}
.plugin-connections-heading {
  margin-bottom: 20px;
}
.plugin-connections-heading p {
  max-width: 52ch;
  font-size: 14px;
  color: var(--situate-muted);
}
.plugin-connector-compact {
  align-self: start;
}
.plugin-connection-mark {
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  border-radius: var(--situate-radius-control);
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.plugin-connection-mark svg {
  width: 28px;
  height: 28px;
}
.plugin-connection-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--situate-space-1) var(--situate-space-3);
  margin-block-start: var(--situate-space-2);
  font-size: var(--situate-text-small);
  color: var(--situate-muted);
}
</style>
