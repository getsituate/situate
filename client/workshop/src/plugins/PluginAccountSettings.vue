<script setup lang="ts">
import { SituateButton, SituateCheckbox } from "../ui";
import { computed, useId } from "vue";
import { c } from "./content";
import type { ConnectionAccount } from "./fixtures";
import {
  gmailPermissionSummary,
  type GmailPermission,
} from "./gmail-experiment";
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
  gmailAccount: [id: string];
  select: [pluginId: string, accountId: string, selected: boolean];
}>();
const accountListId = useId();
const requiredGmailPermission = computed<GmailPermission>(() =>
  props.plugin.id === "status-report" ? "send" : "read",
);
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
function gmailAccountIssue(account: ConnectionAccount) {
  const gmail = props.state.gmailExperiment;
  if (!gmail) return "";
  if (!gmail.enabled) return "Gmail paused";
  if (account.status === "expired") return c.accountExpired;
  if (gmail.grants[account.id]?.includes(requiredGmailPermission.value))
    return "";
  return requiredGmailPermission.value === "send"
    ? "Sending not allowed"
    : "Reading not allowed";
}
</script>
<template>
  <section
    v-if="plugin.kind === 'connector'"
    class="plugin-accounts"
    :aria-label="c.accounts"
  >
    <div class="plugin-account-section-heading">
      <h2>{{ c.accounts }}</h2>
      <SituateButton
        v-if="!pending"
        variant="secondary"
        size="small"
        :disabled="setupUnavailable"
        @click="emit('connect', plugin.id)"
        >{{ c.connectAccount }}</SituateButton
      >
    </div>
    <div
      v-if="availability !== 'ready'"
      class="connection-readiness"
      role="status"
    >
      <strong>{{ c.assignment.readiness[availability] }}</strong>
      <p>{{ c.assignment.readinessDetails[availability] }}</p>
    </div>
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
    <p v-else-if="state.connectionError" role="alert">
      {{ state.connectionError }}
    </p>
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
    <fieldset v-for="connector in dependencies" :key="connector.id">
      <legend>{{ connector.name }}</legend>
      <div
        v-for="account in state.accounts[connector.id] ?? []"
        :key="account.id"
        class="plugin-account-row"
      >
        <label
          class="plugin-account-choice"
          :for="`${accountListId}-${connector.id}-${account.id}`"
        >
          <SituateCheckbox
            :id="`${accountListId}-${connector.id}-${account.id}`"
            :model-value="
              state.accountSelections[plugin.id]?.includes(account.id) ?? false
            "
            @update:model-value="emit('select', plugin.id, account.id, $event)"
          />
          <span
            >{{ account.name }}
            <template v-if="connector.id === 'gmail' && state.gmailExperiment">
              <small>{{
                gmailPermissionSummary(
                  state.gmailExperiment.grants[account.id] ?? [],
                )
              }}</small>
              <small v-if="gmailAccountIssue(account)">{{
                gmailAccountIssue(account)
              }}</small>
            </template>
            <small v-else-if="account.status === 'expired'">{{
              c.accountExpired
            }}</small>
          </span>
        </label>
        <SituateButton
          v-if="
            connector.id === 'gmail' &&
            state.gmailExperiment?.enabled &&
            state.accountSelections[plugin.id]?.includes(account.id) &&
            gmailAccountIssue(account)
          "
          variant="secondary"
          size="small"
          :aria-label="`Open Gmail account · ${account.name}`"
          @click="emit('gmailAccount', account.id)"
          >Open account</SituateButton
        >
      </div>
      <p v-if="!state.accounts[connector.id]?.length">{{ c.noAccounts }}</p>
      <SituateButton
        v-if="
          connector.id !== 'gmail' ||
          state.gmailExperiment?.enabled !== false ||
          state.accounts.gmail?.length
        "
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
  min-inline-size: 0;
}
.plugin-accounts p {
  font-size: var(--situate-text-small);
  max-inline-size: 60ch;
}
.plugin-account-section-heading,
.plugin-account-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--situate-space-2) var(--situate-space-3);
  border-block-end: 1px solid var(--situate-line);
}
.plugin-account-section-heading {
  padding-block-end: var(--situate-space-3);
}
.plugin-account-row {
  padding-block: var(--situate-space-3);
}
.plugin-account-row small {
  display: block;
  color: var(--situate-muted);
  font-size: var(--situate-text-small);
  margin-block-start: var(--situate-space-1);
}
.plugin-account-consumers,
.plugin-accounts fieldset {
  margin-block-start: var(--situate-space-6);
}
.plugin-accounts fieldset {
  margin-inline: 0;
  padding: 0;
  border: 0;
  min-inline-size: 0;
}
.plugin-accounts legend {
  padding: 0 0 var(--situate-space-2);
  inline-size: 100%;
  border-block-end: 1px solid var(--situate-line);
  font-size: var(--situate-text-small);
  font-weight: 600;
}
.plugin-account-choice {
  display: flex;
  align-items: start;
  gap: var(--situate-space-3);
  flex: 1 1 14rem;
  min-inline-size: 0;
  min-block-size: 44px;
  padding-block: var(--situate-space-2);
  box-sizing: border-box;
  line-height: 1.4;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.plugin-account-choice input {
  margin: 0.2em 0 0;
  inline-size: 1rem;
  block-size: 1rem;
  flex: none;
}
.plugin-accounts fieldset > .situate-button {
  margin-block-start: var(--situate-space-2);
}
</style>
