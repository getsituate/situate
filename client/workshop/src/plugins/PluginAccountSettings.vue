<script setup lang="ts">
import { SituateButton, SituateCheckbox } from "../ui";
import { computed } from "vue";
import { c } from "./content";
import { connectionAvailability } from "./connection-readiness";
import {
  connectorDependencies,
  connectionConsumers,
  type Plugin,
  type PluginState,
} from "./model";
const props = defineProps<{ plugin: Plugin; state: PluginState }>();
const emit = defineEmits<{
  detail: [id: string];
  connect: [connectorId: string, accountId?: string];
  cancel: [];
  select: [pluginId: string, accountId: string, selected: boolean];
}>();
const dependencies = computed(() =>
  connectorDependencies(props.state, props.plugin),
);
const availability = computed(() =>
  connectionAvailability(props.state, props.plugin.id),
);
const setupUnavailable = computed(() =>
  ["unsupported", "not-implemented"].includes(availability.value),
);
const pending = computed(
  () => props.state.connectionAttempt?.connectorId === props.plugin.id,
);
</script>
<template>
  <section
    v-if="plugin.kind === 'connector'"
    class="plugin-accounts"
    :aria-label="c.accounts"
  >
    <div class="connection-readiness" role="status">
      <strong>{{ c.assignment.readiness[availability] }}</strong>
      <p>{{ c.assignment.readinessDetails[availability] }}</p>
    </div>
    <h2>{{ c.accounts }}</h2>
    <p class="plugin-muted">{{ c.accountsHelp }}</p>
    <div
      v-for="account in state.accounts[plugin.id] ?? []"
      :key="account.id"
      class="plugin-account-row"
    >
      <div>
        <strong>{{ account.name }}</strong
        ><small>{{
          account.status === "connected" ? c.accountReady : c.accountExpired
        }}</small>
      </div>
      <SituateButton
        variant="secondary"
        size="small"
        v-if="account.status === 'expired'"
        :disabled="pending || setupUnavailable"
        @click="emit('connect', plugin.id, account.id)"
      >
        {{ c.reconnectAccount }}
      </SituateButton>
    </div>
    <p v-if="!state.accounts[plugin.id]?.length">{{ c.noAccountsHelp }}</p>
    <template v-if="pending"
      ><p role="status">{{ c.connectionPending }}</p>
      <SituateButton
        variant="ghost"
        size="small"
        class="plugin-text"
        @click="emit('cancel')"
      >
        {{ c.cancel }}
      </SituateButton></template
    >
    <template v-else
      ><p v-if="state.connectionError" role="alert">
        {{ state.connectionError }}
      </p>
      <SituateButton
        variant="secondary"
        size="small"
        :disabled="setupUnavailable"
        @click="emit('connect', plugin.id)"
      >
        {{ c.connectAccount }}
      </SituateButton></template
    >
    <section class="plugin-account-consumers" :aria-label="c.usedBy">
      <h2>{{ c.usedBy }}</h2>
      <div class="plugin-dependency-links">
        <SituateButton
          variant="ghost"
          size="small"
          v-for="consumer in connectionConsumers(state, plugin.id)"
          :key="consumer.id"
          class="plugin-text"
          @click="emit('detail', consumer.id)"
        >
          {{ consumer.name }}
        </SituateButton>
      </div>
      <p
        v-if="!connectionConsumers(state, plugin.id).length"
        class="plugin-muted"
      >
        {{ c.noConsumers }}
      </p>
    </section>
  </section>
  <section
    v-else-if="dependencies.length"
    class="plugin-accounts"
    :aria-label="c.selectedAccounts"
  >
    <h2>{{ c.selectedAccounts }}</h2>
    <p class="plugin-muted">{{ c.selectedAccountsHelp }}</p>
    <fieldset v-for="connector in dependencies" :key="connector.id">
      <legend>{{ connector.name }}</legend>
      <label
        v-for="account in state.accounts[connector.id] ?? []"
        :key="account.id"
        class="plugin-account-choice"
      >
        <SituateCheckbox
          type="checkbox"
          :checked="
            state.accountSelections[plugin.id]?.includes(account.id) ?? false
          "
          @change="
            emit(
              'select',
              plugin.id,
              account.id,
              ($event.target as HTMLInputElement).checked,
            )
          "
        />
        <span
          >{{ account.name
          }}<small v-if="account.status === 'expired'">{{
            c.accountExpired
          }}</small></span
        >
      </label>
      <p v-if="!state.accounts[connector.id]?.length">{{ c.noAccounts }}</p>
      <SituateButton
        variant="ghost"
        size="small"
        class="plugin-text"
        @click="emit('detail', connector.id)"
      >
        {{ c.configure }} · {{ connector.name }}
      </SituateButton>
    </fieldset>
  </section>
</template>
<style scoped>
.plugin-accounts {
  margin-top: 24px;
}
.plugin-accounts:first-child {
  margin-top: 0;
}
.plugin-accounts p {
  font-size: 14px;
  max-width: 60ch;
}
.plugin-account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--situate-line);
  margin-bottom: 12px;
  font-size: 14px;
}
.plugin-account-row small,
.plugin-account-choice small {
  display: block;
  color: var(--situate-muted);
  font-size: 13px;
  margin-top: 4px;
}
.plugin-accounts button {
  font-size: 14px;
}
.plugin-account-consumers {
  margin-top: 32px;
}
fieldset {
  margin: 24px 0 0;
  padding: 16px 0 0;
  border: 0;
  border-top: 1px solid var(--situate-line);
  min-width: 0;
}
legend {
  padding-right: 16px;
  font-weight: 600;
}
.plugin-account-choice {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  font-size: 14px;
}
.plugin-account-choice input {
  width: 20px;
  height: 20px;
  accent-color: var(--situate-accent-strong, var(--situate-violet-deep));
  flex-shrink: 0;
}
@container (max-width: 400px) {
  .plugin-account-row {
    flex-wrap: wrap;
  }
}
</style>
