<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { SituateButton, SituateCheckbox, SituateDialog } from "../ui";
import {
  disconnectGmail,
  gmailCopy as copy,
  gmailPermissions,
  gmailPermissionSummary,
  openGmailAccount,
  type GmailPermission,
} from "./gmail-experiment";
import {
  clonePluginState,
  connectionConsumers,
  type PluginState,
} from "./model";

const props = defineProps<{ state: PluginState }>();
const emit = defineEmits<{
  "update:state": [state: PluginState];
  settings: [];
  detail: [id: string];
}>();
const gmail = computed(() => props.state.gmailExperiment!);
const accounts = computed(() => props.state.accounts.gmail ?? []);
const selection = computed(() => gmail.value.selection);
const editing = computed(() =>
  accounts.value.find((account) => account.id === selection.value?.accountId),
);
const title = ref<HTMLElement>();
const validation = ref(false);
const disconnect = ref<string>();
const disconnecting = computed(() =>
  accounts.value.find((account) => account.id === disconnect.value),
);
const opener = ref<string>();
const disconnectOpener = ref<HTMLElement>();
const id = useId();
const editButtonId = (accountId: string | null) =>
  `${id}-edit-${accountId ?? "new"}`;
const reducing = computed(() => {
  const form = selection.value;
  return (
    !!form?.accountId &&
    (gmail.value.grants[form.accountId] ?? []).some(
      (permission) => !form.permissions.includes(permission),
    )
  );
});

function showDisconnect(accountId: string, event: MouseEvent) {
  disconnectOpener.value = event.currentTarget as HTMLElement;
  disconnect.value = accountId;
}

function update(change: (state: PluginState) => void) {
  const next = clonePluginState(props.state);
  change(next);
  emit("update:state", next);
}

watch(
  () => [!!selection.value, !!selection.value?.pending],
  async ([open, pending], [wasOpen, wasPending]) => {
    if (open === wasOpen && pending === wasPending) return;
    validation.value = false;
    await nextTick();
    if (gmail.value.error) return;
    if (!open) {
      const button = opener.value
        ? document.getElementById(opener.value)
        : null;
      (button ?? title.value)?.focus();
    } else if (wasPending && !pending)
      document.getElementById(`${id}-authorize`)?.focus();
    else title.value?.focus();
  },
);

function edit(accountId: string | null) {
  opener.value = editButtonId(accountId);
  update((s) => openGmailAccount(s, accountId));
}

function toggle(permission: GmailPermission, enabled: boolean) {
  validation.value = false;
  update((s) => {
    const form = s.gmailExperiment!.selection!;
    form.permissions = enabled
      ? [...form.permissions, permission]
      : form.permissions.filter((id) => id !== permission);
  });
}

async function authorize() {
  if (!selection.value?.permissions.length) {
    validation.value = true;
    await nextTick();
    document.getElementById(`${id}-metadata`)?.focus();
    return;
  }
  update((s) => {
    s.gmailExperiment!.selection!.pending = true;
  });
}

async function dismissError() {
  update((s) => {
    s.gmailExperiment!.error = null;
  });
  await nextTick();
  document.getElementById(`${id}-authorize`)?.focus();
}

async function closeDisconnect(confirmed = false) {
  const account = disconnect.value;
  disconnect.value = undefined;
  if (account && confirmed) update((s) => disconnectGmail(s, account));
  await nextTick();
  if (confirmed) title.value?.focus();
  else disconnectOpener.value?.focus();
}
</script>

<template>
  <section
    v-if="selection"
    class="gmail-connection"
    :aria-labelledby="`${id}-heading`"
  >
    <h1 :id="`${id}-heading`" ref="title" tabindex="-1">
      {{
        selection.pending
          ? "Waiting for Google"
          : editing
            ? copy.edit
            : copy.connect
      }}
    </h1>
    <p v-if="editing" class="gmail-context gmail-address">{{ editing.name }}</p>
    <div v-if="selection.pending" class="gmail-browser-step">
      <p role="status">
        Finish connecting in your browser, then return to Situate.
      </p>
      <SituateButton
        variant="secondary"
        @click="
          update((s) => {
            s.gmailExperiment!.selection!.pending = false;
          })
        "
        >Cancel sign-in</SituateButton
      >
    </div>
    <form v-else class="gmail-permissions" @submit.prevent="authorize">
      <p class="gmail-context">Choose what plugins can do with this account.</p>
      <p v-if="validation" :id="`${id}-validation`" class="gmail-validation">
        Select at least one permission to continue.
      </p>
      <div class="gmail-permission-groups">
        <fieldset
          v-for="group in gmailPermissions"
          :key="group.label"
          :class="{
            'gmail-deletion': group.items.some(
              (permission) => permission.id === 'delete',
            ),
          }"
        >
          <legend>{{ group.label }}</legend>
          <label
            v-for="permission in group.items"
            :key="permission.id"
            class="gmail-permission"
            :for="`${id}-${permission.id}`"
          >
            <SituateCheckbox
              :id="`${id}-${permission.id}`"
              :model-value="selection.permissions.includes(permission.id)"
              :aria-invalid="
                validation && permission.id === 'metadata' ? true : undefined
              "
              :aria-describedby="
                validation && permission.id === 'metadata'
                  ? `${id}-validation`
                  : 'detail' in permission
                    ? `${id}-${permission.id}-detail`
                    : undefined
              "
              @update:model-value="toggle(permission.id, $event)"
            />
            <span
              >{{ permission.label
              }}<small
                v-if="'detail' in permission"
                :id="`${id}-${permission.id}-detail`"
                >{{ permission.detail }}</small
              ></span
            >
          </label>
        </fieldset>
      </div>
      <div class="gmail-form-actions">
        <p v-if="reducing">
          Reducing permissions can require reconnecting this account in other
          workspaces.
        </p>
        <SituateButton :id="`${id}-authorize`" type="submit">{{
          copy.continue
        }}</SituateButton>
      </div>
    </form>
  </section>
  <section v-else class="gmail-connection" :aria-labelledby="`${id}-accounts`">
    <div class="gmail-heading">
      <h2 :id="`${id}-accounts`" ref="title" tabindex="-1">
        Connected accounts
      </h2>
      <SituateButton
        v-if="gmail.enabled && accounts.length"
        :id="editButtonId(null)"
        @click="edit(null)"
      >
        {{ copy.connect }}
      </SituateButton>
    </div>
    <div v-if="!gmail.enabled" class="gmail-pause" role="status">
      <p>
        Gmail is paused on this Mac. Enable Gmail to use connected accounts in
        plugins.
      </p>
      <SituateButton variant="secondary" @click="emit('settings')"
        >Open experimental features</SituateButton
      >
    </div>
    <div v-else-if="!accounts.length" class="gmail-empty">
      <p>No Gmail accounts connected.</p>
      <SituateButton :id="editButtonId(null)" @click="edit(null)">
        {{ copy.connect }}
      </SituateButton>
    </div>
    <div v-if="accounts.length" class="gmail-account-list">
      <article
        v-for="account in accounts"
        :key="account.id"
        class="gmail-account"
      >
        <div class="gmail-account-info">
          <div class="gmail-account-label">
            <h3>{{ account.name }}</h3>
            <p class="gmail-context">
              {{
                gmailPermissionSummary(gmail.grants[account.id] ?? []) ||
                "No permissions granted"
              }}
            </p>
            <p
              v-if="!gmail.enabled || account.status === 'expired'"
              class="gmail-account-status"
            >
              {{ !gmail.enabled ? "Paused" : "Reconnect required" }}
            </p>
            <p v-if="gmail.partialAccount === account.id" role="status">
              {{ copy.restricted }}
            </p>
          </div>
        </div>
        <div class="gmail-row-actions">
          <SituateButton
            v-if="gmail.enabled"
            variant="secondary"
            size="small"
            :aria-label="`${account.status === 'expired' ? copy.reconnect : copy.edit}: ${account.name}`"
            :id="editButtonId(account.id)"
            @click="edit(account.id)"
          >
            {{ account.status === "expired" ? copy.reconnect : copy.edit }}
          </SituateButton>
          <SituateButton
            variant="ghost"
            size="small"
            :aria-label="`Disconnect ${account.name}`"
            @click="showDisconnect(account.id, $event)"
            >Disconnect</SituateButton
          >
        </div>
      </article>
    </div>
    <div
      v-if="connectionConsumers(state, 'gmail').length"
      class="gmail-consumers"
    >
      <h3>Used by</h3>
      <SituateButton
        v-for="plugin in connectionConsumers(state, 'gmail')"
        :key="plugin.id"
        variant="ghost"
        size="small"
        @click="emit('detail', plugin.id)"
        >{{ plugin.name }}</SituateButton
      >
    </div>
  </section>
  <SituateDialog
    :open="!!gmail.error"
    :aria-labelledby="`${id}-error`"
    :aria-describedby="`${id}-error-message`"
    @cancel.prevent="dismissError"
  >
    <template #header
      ><h2 :id="`${id}-error`">Couldn’t connect to Gmail</h2></template
    >
    <p v-if="gmail.error" :id="`${id}-error-message`">
      {{ copy.errors[gmail.error] }}
    </p>
    <template #actions
      ><SituateButton variant="secondary" autofocus @click="dismissError"
        >Close</SituateButton
      ></template
    >
  </SituateDialog>
  <SituateDialog
    :open="!!disconnecting"
    :aria-labelledby="`${id}-disconnect`"
    :aria-describedby="`${id}-disconnect-message`"
    @cancel.prevent="closeDisconnect()"
  >
    <template #header
      ><h2 :id="`${id}-disconnect`">{{ copy.disconnect }}?</h2></template
    >
    <p :id="`${id}-disconnect-message`">
      Plugins in this workspace will lose access to {{ disconnecting?.name }}.
      Google may also revoke access to the same account in other workspaces.
    </p>
    <template #actions>
      <SituateButton variant="secondary" autofocus @click="closeDisconnect()"
        >Cancel</SituateButton
      >
      <SituateButton variant="danger" @click="closeDisconnect(true)">{{
        copy.disconnect
      }}</SituateButton>
    </template>
  </SituateDialog>
</template>

<style scoped>
.gmail-connection {
  container-type: inline-size;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.gmail-connection h1 {
  inline-size: fit-content;
}
.gmail-connection :is(h1, h2, h3, p) {
  margin: 0;
}
.gmail-heading,
.gmail-account,
.gmail-row-actions,
.gmail-consumers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--situate-space-2) var(--situate-space-3);
}
.gmail-heading,
.gmail-account {
  justify-content: space-between;
}
.gmail-heading h2,
.gmail-consumers h3 {
  font-size: var(--situate-text-body);
  font-weight: 650;
}
.gmail-heading + :is(.gmail-account-list, .gmail-empty, .gmail-pause) {
  margin-block-start: var(--situate-space-4);
}
.gmail-empty,
.gmail-pause,
.gmail-browser-step {
  display: grid;
  justify-items: start;
  gap: var(--situate-space-4);
  padding: var(--situate-space-6);
  background: var(--situate-paper);
  border-radius: var(--situate-space-4);
}
.gmail-connection .gmail-address {
  margin-block-start: var(--situate-space-1);
}
.gmail-browser-step {
  margin-block-start: var(--situate-space-4);
}
.gmail-account-list {
  display: grid;
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-space-4);
}
.gmail-account {
  padding: var(--situate-space-4);
  column-gap: var(--situate-space-6);
}
.gmail-account + .gmail-account {
  border-block-start: 1px solid var(--situate-line);
}
.gmail-account-info {
  flex: 1 1 18rem;
  min-inline-size: 0;
}
.gmail-account-label {
  display: grid;
  gap: var(--situate-space-1);
  align-self: center;
}
.gmail-account h3 {
  font-size: var(--situate-text-body);
  font-weight: 650;
  line-height: 1.4;
}
.gmail-context,
.gmail-account p,
.gmail-consumers h3 {
  color: var(--situate-muted);
}
.gmail-account .gmail-account-status {
  color: var(--situate-ink);
  font-weight: 650;
}
.gmail-consumers {
  margin-block-start: var(--situate-space-6);
}
.gmail-address,
.gmail-account p {
  font-size: var(--situate-text-small);
}
.gmail-permissions {
  margin-block-start: var(--situate-space-4);
}
.gmail-permission-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--situate-space-6);
  margin-block-start: var(--situate-space-6);
}
.gmail-permissions fieldset {
  min-inline-size: 0;
  margin: 0;
  border: 0;
  border-block-start: 1px solid var(--situate-line);
  padding: var(--situate-space-2) 0 0;
}
.gmail-permissions legend {
  padding-inline: 0 var(--situate-space-2);
  font-size: var(--situate-text-body);
  font-weight: 650;
}
.gmail-permissions .gmail-deletion {
  grid-column: 1 / -1;
}
.gmail-permission {
  display: flex;
  gap: var(--situate-space-3);
  align-items: start;
  min-block-size: 44px;
  padding-block: var(--situate-space-2);
  line-height: 1.4;
  box-sizing: border-box;
  cursor: pointer;
}
.gmail-permission input {
  flex: none;
  inline-size: 1.125rem;
  block-size: 1.125rem;
  margin: 0.15em 0 0;
}
.gmail-permission small {
  display: block;
  margin-block-start: var(--situate-space-1);
  color: var(--situate-muted);
  font-size: var(--situate-text-small);
}
.gmail-form-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--situate-space-3) var(--situate-space-6);
  margin-block-start: var(--situate-space-6);
  border-block-start: 1px solid var(--situate-line);
  padding-block-start: var(--situate-space-4);
}
.gmail-form-actions p {
  flex: 1 1 14rem;
  color: var(--situate-ink);
  font-size: var(--situate-text-small);
}
.gmail-permissions .gmail-validation {
  margin-block-start: var(--situate-space-3);
  font-weight: 650;
}
@container (max-width: 32rem) {
  .gmail-permission-groups {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
