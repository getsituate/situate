<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import { localizeError, t } from "@situate/localization";
import {
  SituateDialog,
  SituateButton,
  SituateDialogActions,
  SituateIcon,
  SituateInfoButton,
  SituateInput,
  SituateSelect,
  SituateLoading,
} from "@situate/ui";
import ProviderIcon from "./ProviderIcon.vue";
import AiSetup from "./AiSetup.vue";
import {
  forgetConnection,
  getStatus,
  listConnections,
  removeConnection,
  renameConnection,
  selectConnection,
  type Config,
  type Status,
} from "./api";
const id = useId();
const props = defineProps<{ scope: string; disabled?: boolean }>();
const emit = defineEmits<{ changed: []; editing: [value: boolean] }>();
const connections = ref<Status[]>([]);
const selected = ref<string>();
const loading = ref(false);
const busy = ref(false);
const error = ref<unknown>("");
const editing = ref(false);
const reconnect = ref<Config>();
const confirmation = ref<{
  action: "manage" | "rename" | "forget" | "remove";
  config: Config;
}>();
const name = ref("");
const nameError = ref(false);
const dialogControl =
  useTemplateRef<InstanceType<typeof SituateDialog>>("dialogControl");
const dialog = computed(() => dialogControl.value?.element);
const title = useTemplateRef<HTMLElement>("title");
let returnFocus: HTMLElement | null = null;
let revision = 0;
const blocked = computed(() => busy.value || loading.value || props.disabled);
function providerName(config: Config): string {
  switch (config.provider) {
    case "openai":
      return t("ai.providers.openai");
    case "anthropic":
      return t("ai.providers.anthropic");
    case "openrouter":
      return t("ai.providers.openrouter");
    case "custom":
      return t("ai.compatibleEndpoint");
    default:
      return config.provider;
  }
}
function label(config: Config): string {
  return config.label || providerName(config);
}
function authentication(config: Config): string {
  return config.auth === "oauth" ? t("ai.browserMethod") : t("ai.apiKeyMethod");
}
async function refresh(): Promise<void> {
  const request = ++revision;
  loading.value = true;
  error.value = "";
  try {
    const [items, status] = await Promise.all([
      listConnections(props.scope),
      getStatus(props.scope),
    ]);
    if (request !== revision) return;
    connections.value = items;
    selected.value = status.config?.connectionId;
  } catch (reason) {
    if (request === revision) error.value = reason;
  } finally {
    if (request === revision) loading.value = false;
  }
}
watch(
  () => props.scope,
  () => {
    connections.value = [];
    selected.value = undefined;
    editing.value = false;
    confirmation.value = undefined;
    dialog.value?.close();
    void refresh();
  },
  { immediate: true },
);
watch(editing, (value) => emit("editing", value));
onBeforeUnmount(() => {
  revision++;
  dialog.value?.close();
});
function edit(config?: Config, event?: MouseEvent): void {
  reconnect.value = config;
  if (event) returnFocus = event.currentTarget as HTMLElement;
  dialog.value?.close();
  confirmation.value = undefined;
  editing.value = true;
}
async function closeEditor(): Promise<void> {
  editing.value = false;
  await nextTick();
  if (returnFocus?.isConnected) returnFocus.focus();
  else title.value?.focus();
}
async function connected(): Promise<void> {
  await closeEditor();
  await refresh();
  emit("changed");
}
async function select(event: Event): Promise<void> {
  const control = event.target as HTMLSelectElement;
  const id = control.value;
  control.value = selected.value ?? "";
  if (blocked.value || !id) return;
  const scope = props.scope;
  busy.value = true;
  error.value = "";
  try {
    await selectConnection(scope, id);
    if (scope !== props.scope) return;
    await refresh();
    emit("changed");
  } catch (reason) {
    if (scope === props.scope) error.value = reason;
  } finally {
    busy.value = false;
  }
}
async function confirm(
  action: NonNullable<typeof confirmation.value>["action"],
  config: Config,
  event?: MouseEvent,
): Promise<void> {
  if (event) returnFocus = event.currentTarget as HTMLElement;
  confirmation.value = { action, config };
  name.value = label(config);
  nameError.value = false;
  error.value = "";
  await nextTick();
  if (!dialog.value?.open) dialog.value?.showModal();
  if (action === "rename") dialog.value?.querySelector("input")?.focus();
}
function cancel(): void {
  dialog.value?.close();
  confirmation.value = undefined;
  if (returnFocus?.isConnected) returnFocus.focus();
  else title.value?.focus();
}
async function apply(): Promise<void> {
  const pending = confirmation.value;
  if (!pending?.config.connectionId || blocked.value) return;
  if (
    pending.action === "rename" &&
    (!name.value.trim() ||
      connections.value.some(
        (item) =>
          item.config?.connectionId !== pending.config.connectionId &&
          item.config &&
          label(item.config).toLocaleLowerCase() ===
            name.value.trim().toLocaleLowerCase(),
      ))
  ) {
    nameError.value = true;
    dialog.value?.querySelector("input")?.focus();
    return;
  }
  const scope = props.scope;
  busy.value = true;
  error.value = "";
  try {
    if (pending.action === "rename")
      await renameConnection(
        scope,
        pending.config.connectionId,
        name.value.trim(),
      );
    else if (pending.action === "forget")
      await forgetConnection(scope, pending.config.connectionId);
    else if (pending.action === "remove")
      await removeConnection(scope, pending.config.connectionId);
    else return;
    if (scope !== props.scope) return;
    cancel();
    await refresh();
    emit("changed");
  } catch (reason) {
    if (scope === props.scope) error.value = reason;
  } finally {
    busy.value = false;
  }
}
const confirmationTitle = computed(() => {
  switch (confirmation.value?.action) {
    case "manage":
      return t("ai.connections.manage");
    case "rename":
      return t("ai.connections.rename");
    case "forget":
      return t("ai.connections.forget");
    case "remove":
      return t("ai.connections.remove");
    default:
      return "";
  }
});
</script>
<template>
  <section
    class="connections"
    :aria-labelledby="editing ? undefined : `connections-heading--${id}`"
  >
    <AiSetup
      v-if="editing"
      :key="reconnect?.connectionId ?? 'new'"
      :scope="scope"
      workspace-name=""
      embedded
      :connection="reconnect"
      @done="closeEditor"
      @connected="connected"
    />
    <template v-else>
      <div class="connections-heading">
        <div class="connections-title">
          <h3 :id="`connections-heading--${id}`" ref="title" tabindex="-1">
            {{ t("ai.connections.title") }}
          </h3>
          <SituateInfoButton
            :label="t('ai.connections.info')"
            :text="t('ai.connections.deviceScope')"
          />
        </div>
        <SituateButton
          class="add-connection"
          size="small"
          :disabled="blocked || !!error"
          @click="edit(undefined, $event)"
        >
          <SituateIcon name="plus" />
          {{ t("ai.connections.add") }}
        </SituateButton>
      </div>
      <SituateLoading
        v-if="loading && !connections.length"
        placement="inline"
        pending
        :label="t('localization.loading')"
      />
      <p v-else-if="!loading && !connections.length && !error">
        {{ t("ai.connections.empty") }}
      </p>
      <ul :aria-busy="loading || busy">
        <li v-for="item in connections" :key="item.config?.connectionId">
          <template v-if="item.config">
            <ProviderIcon :provider="item.config.provider" />
            <div class="connection-description">
              <strong data-localization-content="user">{{
                label(item.config)
              }}</strong>
              <span data-localization-content="identity">{{
                providerName(item.config)
              }}</span>
              <span v-if="item.config.connectionId === selected">{{
                t("ai.connections.selected")
              }}</span>
              <span v-if="item.reason" role="status">{{
                localizeError(item.reason)
              }}</span>
              <span v-else
                >{{
                  item.available
                    ? t("ai.connections.ready")
                    : t("ai.connections.signInNeeded")
                }}
                · {{ authentication(item.config) }}</span
              >
              <span
                v-if="item.config.endpoint"
                data-localization-content="user"
                >{{ item.config.endpoint }}</span
              >
            </div>
            <div class="connection-actions">
              <SituateButton
                variant="ghost"
                size="small"
                type="button"
                :disabled="blocked"
                @click="confirm('manage', item.config, $event)"
              >
                {{ t("ai.connections.manage") }}
              </SituateButton>
              <SituateButton
                variant="ghost"
                size="small"
                type="button"
                :disabled="blocked"
                @click="confirm('rename', item.config, $event)"
              >
                {{ t("ai.connections.rename") }}
              </SituateButton>
              <SituateButton
                variant="ghost"
                size="small"
                type="button"
                :disabled="blocked"
                @click="confirm('remove', item.config, $event)"
              >
                {{ t("ai.connections.disconnect") }}
              </SituateButton>
            </div>
          </template>
        </li>
      </ul>
      <div v-if="error && !confirmation" role="alert">
        <p>{{ localizeError(error) }}</p>
        <SituateButton
          class="connection-retry"
          variant="ghost"
          size="small"
          type="button"
          :disabled="blocked"
          @click="refresh"
        >
          {{ t("localization.retry") }}
        </SituateButton>
      </div>
      <section
        class="chat-connection"
        :aria-labelledby="`chat-connection-heading--${id}`"
      >
        <h3 :id="`chat-connection-heading--${id}`">
          {{ t("settings.ai.chat") }}
        </h3>
        <div class="setting-row">
          <label :for="`chat-connection--${id}`">{{
            t("ai.connections.chat")
          }}</label>
          <SituateSelect
            :id="`chat-connection--${id}`"
            :value="selected ?? ''"
            :disabled="blocked || !connections.length"
            @change="select"
          >
            <option value="" disabled>
              {{ t("ai.connections.noSelection") }}
            </option>
            <option
              v-for="item in connections"
              :key="item.config?.connectionId"
              :value="item.config?.connectionId"
              data-localization-content="user"
            >
              {{ item.config ? label(item.config) : "" }}
            </option>
          </SituateSelect>
        </div>
      </section>
    </template>
    <SituateDialog
      ref="dialogControl"
      :aria-labelledby="`connection-confirm-title--${id}`"
      @cancel.prevent="!busy && cancel()"
    >
      <h3 :id="`connection-confirm-title--${id}`">{{ confirmationTitle }}</h3>
      <template v-if="confirmation">
        <p data-localization-content="user">{{ label(confirmation.config) }}</p>
        <template v-if="confirmation.action === 'manage'">
          <p data-localization-content="identity">
            {{ providerName(confirmation.config) }}
          </p>
          <p>{{ authentication(confirmation.config) }}</p>
          <p
            v-if="confirmation.config.endpoint"
            data-localization-content="user"
          >
            {{ confirmation.config.endpoint }}
          </p>
          <SituateDialogActions
            ><SituateButton
              variant="primary"
              type="button"
              @click="edit(confirmation.config)"
            >
              {{ t("ai.connections.reconnect") }}
            </SituateButton>
            <SituateButton
              variant="secondary"
              type="button"
              @click="confirm('forget', confirmation.config)"
            >
              {{ t("ai.connections.forget") }}
            </SituateButton>
            <SituateButton
              variant="secondary"
              type="button"
              autofocus
              @click="cancel"
            >
              {{ t("ai.closeModelChooser") }}
            </SituateButton>
          </SituateDialogActions>
        </template>
        <form v-else @submit.prevent="apply">
          <template v-if="confirmation.action === 'rename'">
            <label :for="`connection-name--${id}`">{{
              t("ai.connections.name")
            }}</label>
            <SituateInput
              :id="`connection-name--${id}`"
              v-model="name"
              maxlength="120"
              :disabled="busy"
              :aria-invalid="nameError || undefined"
              :aria-describedby="
                nameError ? `connection-name-error--${id}` : undefined
              "
              @input="nameError = false"
            />
            <p
              v-if="nameError"
              :id="`connection-name-error--${id}`"
              role="alert"
            >
              {{ t("ai.connections.uniqueName") }}
            </p>
          </template>
          <template v-else>
            <p>
              {{
                confirmation.action === "forget"
                  ? t("ai.connections.forgetEffect")
                  : t("ai.connections.removeEffect")
              }}
            </p>
            <p>{{ t("ai.connections.providerPermissions") }}</p>
          </template>
          <p v-if="error" role="alert">{{ localizeError(error) }}</p>
          <SituateDialogActions
            ><SituateButton
              variant="secondary"
              type="button"
              :disabled="busy"
              autofocus
              @click="cancel"
            >
              {{ t("navigation.cancel") }}</SituateButton
            ><SituateButton
              :variant="confirmation.action === 'rename' ? 'primary' : 'danger'"
              type="submit"
              :disabled="blocked"
            >
              {{ confirmationTitle }}
            </SituateButton>
          </SituateDialogActions>
        </form>
      </template>
    </SituateDialog>
  </section>
</template>
<style scoped>
.connections {
  min-width: 0;
}
.connections-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--situate-space-3);
}
.connections-title,
.add-connection {
  display: inline-flex;
  align-items: center;
}
.add-connection {
  justify-content: center;
  gap: var(--situate-space-2);
}
.add-connection .situate-icon {
  width: 16px;
  height: 16px;
}
h3 {
  font-size: 16px;
  margin: 0;
}
ul {
  margin: 16px 0 32px;
  padding: 0;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 20px 0;
  border-bottom: 1px solid var(--situate-line);
}
.provider-icon {
  width: 28px;
  height: 28px;
}
.connection-description {
  display: grid;
  gap: 6px;
  min-width: 0;
  font-size: 14px;
}
.connection-description span {
  font-size: 13px;
  color: var(--situate-muted);
}
p,
span,
strong {
  overflow-wrap: anywhere;
}
.connection-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
:is(.connection-actions button, .connection-retry) {
  min-height: 44px;
  padding: 4px;
  font: inherit;
  font-size: 13px;
  border: 0;
  color: inherit;
  background: transparent;
  text-decoration: underline;
  text-underline-offset: 4px;
  cursor: pointer;
}
:is(.connection-actions button, .connection-retry):disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.chat-connection h3 {
  margin-bottom: 12px;
}
input {
  width: 100%;
  margin-top: 8px;
  padding: 8px;
}
@media (max-width: 700px) {
  li {
    grid-template-columns: 32px minmax(0, 1fr);
  }
  .connection-actions {
    grid-column: 2;
  }
}
</style>
