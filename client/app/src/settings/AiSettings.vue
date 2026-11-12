<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  ref,
  useId,
  watch,
} from "vue";
import { t, localizeError } from "@situate/localization";
import { getStatus, refreshModels, type Status } from "../ai/api";
import { useModelCatalog } from "../ai/useModelCatalog";
import {
  workspaceAiSettings,
  type ThinkingLevel,
  type WorkspaceAiSettings,
} from "../ai/settings";
import {
  modelChoice,
  commentThinking,
  recommendedChoice,
  supportedThinkingLevels,
  modelAvailability,
} from "../ai/recommendations";
import {
  SituateButton,
  SituateSwitch,
  SituateDisclosure,
  SituateInput,
  SituateSelect,
} from "@situate/ui";
import { refreshWorkspaceChats, workspaceChatActivity } from "../ai/chat";
const AiConnections = defineAsyncComponent(
  () => import("../ai/AiConnections.vue"),
);
function thinkingLabel(level: ThinkingLevel): string {
  switch (level) {
    case "off":
      return t("settings.ai.thinking.off");
    case "minimal":
      return t("settings.ai.thinking.minimal");
    case "low":
      return t("settings.ai.thinking.low");
    case "medium":
      return t("settings.ai.thinking.medium");
    case "high":
      return t("settings.ai.thinking.high");
    case "xhigh":
      return t("settings.ai.thinking.xhigh");
  }
}
const props = defineProps<{ workspaceScope?: string }>();
const emit = defineEmits<{
  saved: [settings: WorkspaceAiSettings];
  connect: [];
}>();
const service = computed(() =>
  props.workspaceScope
    ? workspaceAiSettings(
        props.workspaceScope,
        status.value?.config?.connectionId,
      )
    : null,
);
const status = ref<Status | null>(null);
const editingConnection = ref(false);
const refreshingModels = ref(false);
const refreshError = ref<unknown>("");
const refreshBlocked = computed(() => {
  const activity = props.workspaceScope
    ? workspaceChatActivity(props.workspaceScope)
    : null;
  return (
    !status.value?.config ||
    refreshingModels.value ||
    service.value?.state.saving ||
    service.value?.state.loading ||
    activity?.running ||
    activity?.selectingModel
  );
});
async function discoverModels(): Promise<void> {
  const scope = props.workspaceScope;
  if (!scope || refreshBlocked.value) return;
  const request = ++revision;
  refreshingModels.value = true;
  refreshError.value = "";
  try {
    const loaded = await refreshModels(
      scope,
      status.value?.config?.connectionId,
    );
    if (!alive || request !== revision || scope !== props.workspaceScope)
      return;
    status.value = loaded;
    await workspaceAiSettings(scope, loaded.config?.connectionId).refresh();
    if (alive && request === revision && scope === props.workspaceScope)
      await refreshWorkspaceChats(scope);
  } catch (reason) {
    if (alive && request === revision && scope === props.workspaceScope)
      refreshError.value = reason;
  } finally {
    if (alive && request === revision && scope === props.workspaceScope)
      refreshingModels.value = false;
  }
}
watch(
  () => props.workspaceScope,
  () => {
    refreshingModels.value = false;
    refreshError.value = "";
  },
);
async function connectionsChanged(): Promise<void> {
  const scope = props.workspaceScope;
  await refresh();
  if (alive && scope && scope === props.workspaceScope) {
    await refreshWorkspaceChats(scope);
    if (
      alive &&
      scope === props.workspaceScope &&
      service.value?.state.settings
    )
      emit("saved", service.value.state.settings);
  }
}
const statusError = ref(false);
let revision = 0;
let alive = true;
onBeforeUnmount(() => {
  alive = false;
  revision++;
});
async function refresh(): Promise<void> {
  const scope = props.workspaceScope;
  const request = ++revision;
  refreshingModels.value = false;
  status.value = null;
  statusError.value = false;
  if (!scope) return;
  try {
    const loaded = await getStatus(scope);
    if (!alive || request !== revision) return;
    status.value = loaded;
    await workspaceAiSettings(scope, loaded.config?.connectionId).refresh();
  } catch {
    if (request === revision) statusError.value = true;
  }
}
watch(() => props.workspaceScope, refresh, { immediate: true });
const { catalog, loading, failed, reload } = useModelCatalog(
  () => !!status.value?.config,
);
const models = computed(() =>
  status.value?.config
    ? (catalog.value?.availableChatModels(
        status.value.config,
        status.value.catalog,
      ) ?? [])
    : [],
);
const commentModels = computed(() =>
  models.value.filter((model) => {
    try {
      commentThinking(status.value!.config!, model.id, model);
      return true;
    } catch {
      return false;
    }
  }),
);
const settings = computed(() => service.value?.state.settings);
const disabled = computed(
  () =>
    !settings.value ||
    !status.value?.available ||
    !!(
      service.value?.state.error ||
      service.value?.state.loading ||
      service.value?.state.saving ||
      loading.value ||
      refreshingModels.value
    ),
);
const levels = computed(() => {
  if (!settings.value?.chat || !status.value?.config) return [];
  try {
    return supportedThinkingLevels(
      status.value.config,
      settings.value.chat.model === "recommended"
        ? (status.value.selectedModel ?? "")
        : settings.value.chat.model,
    );
  } catch {
    return [];
  }
});
const availability = computed(() =>
  modelAvailability(
    status.value?.catalog,
    catalog.value && !loading.value && !failed.value ? models.value : undefined,
  ),
);
const recommendations = computed(() => ({
  chat: status.value?.config
    ? recommendedChoice(status.value.config, "chat", availability.value)
    : null,
  comment: status.value?.config
    ? recommendedChoice(status.value.config, "comment", availability.value)
    : null,
}));
const customModelListId = useId();
const customSuggestions = computed(() =>
  status.value?.config?.provider === "custom" &&
  status.value.catalog?.source === "provider"
    ? [...new Set(status.value.catalog.models)]
    : [],
);
const customChat = ref("");
const customComment = ref("");
async function save(value: WorkspaceAiSettings): Promise<void> {
  const active = service.value;
  if (disabled.value || !active) return;
  if ((await active.save(value)) && alive && active === service.value) {
    const scope = props.workspaceScope;
    if (scope) {
      try {
        const loaded = await getStatus(scope);
        if (alive && active === service.value) status.value = loaded;
      } catch {
        if (alive && active === service.value) statusError.value = true;
      }
      if (alive && active === service.value) await refreshWorkspaceChats(scope);
    }
    if (alive && active === service.value)
      emit("saved", active.state.settings!);
  }
}
async function select(kind: "chat" | "comment", value: string): Promise<void> {
  if (!settings.value || !status.value?.config || !value) return;
  const choice =
    value === "recommended"
      ? {
          model: "recommended",
          thinking: "recommended" as const,
          catalogRevision: null,
        }
      : {
          ...modelChoice(status.value.config, value, settings.value[kind]),
          thinking:
            kind === "comment"
              ? commentThinking(status.value.config, value)
              : ("recommended" as const),
        };
  await save({ ...settings.value, [kind]: choice });
}
function selectEvent(kind: "chat" | "comment", event: Event): void {
  const control = event.target as HTMLSelectElement;
  const value = control.value;
  control.value = settings.value?.[kind]?.model ?? "";
  void select(kind, value);
}
function toggle(
  key: "generatedComments" | "showInlineModel",
  event: Event,
): void {
  if (!settings.value) return;
  const control = event.target as HTMLInputElement;
  const checked = control.checked;
  control.checked = settings.value[key];
  void save({ ...settings.value, [key]: checked });
}
function thinking(event: Event): void {
  const control = event.target as HTMLSelectElement;
  const value = control.value as ThinkingLevel | "recommended";
  control.value = settings.value?.chat?.thinking ?? "";
  if (
    settings.value?.chat &&
    (value === "recommended" || levels.value.includes(value))
  )
    void save({
      ...settings.value,
      chat: { ...settings.value.chat, thinking: value },
    });
}
</script>
<template>
  <div
    :key="workspaceScope"
    class="ai-settings"
    :aria-busy="service?.state.loading || service?.state.saving"
  >
    <AiConnections
      v-if="workspaceScope"
      :key="workspaceScope"
      :scope="workspaceScope"
      :disabled="service?.state.saving || refreshingModels"
      @changed="connectionsChanged"
      @editing="editingConnection = $event"
    />
    <div v-show="!editingConnection">
      <datalist v-if="customSuggestions.length" :id="customModelListId">
        <option
          v-for="id in customSuggestions"
          :key="id"
          :value="id"
          data-localization-content="identity"
        />
      </datalist>
      <div
        v-if="
          statusError || status?.modelError || service?.state.error || failed
        "
        class="settings-error"
        role="alert"
      >
        <p>
          {{
            status?.modelError
              ? localizeError(status.modelError)
              : t("ai.modelChoicesCouldNotBeRead")
          }}
        </p>
        <SituateButton
          variant="ghost"
          size="small"
          type="button"
          :disabled="service?.state.saving"
          @click="failed ? reload() : refresh()"
        >
          {{ t("localization.retry") }}
        </SituateButton>
      </div>
      <div class="setting-row">
        <label for="settings-inline">{{
          t("settings.ai.showInlineModel")
        }}</label
        ><SituateSwitch
          id="settings-inline"
          :checked="settings?.showInlineModel ?? false"
          :disabled="disabled"
          @change="toggle('showInlineModel', $event)"
        />
      </div>
      <SituateDisclosure
        class="advanced-settings"
        :label="t('settings.ai.advanced')"
      >
        <div v-if="status?.config" class="model-discovery">
          <SituateButton
            variant="ghost"
            size="small"
            type="button"
            :disabled="refreshBlocked"
            @click="discoverModels"
          >
            {{ t("ai.models.refresh") }}
          </SituateButton>
          <p v-if="refreshingModels" role="status">
            {{ t("ai.models.refreshing") }}
          </p>
          <p v-if="refreshError" role="alert">
            {{ localizeError(refreshError) }}
          </p>
          <p v-if="status.catalog?.source === 'unknown'" role="alert">
            {{ t("ai.models.lookupFailed") }}
          </p>
          <p v-else-if="status.catalog?.source === 'account'">
            {{ t("ai.models.account") }}
          </p>
          <p v-else-if="status.catalog?.source === 'provider'">
            {{ t("ai.models.provider") }}
          </p>
          <p v-else>{{ t("ai.models.static") }}</p>
          <p
            v-if="
              status.config.provider !== 'custom' &&
              (status.catalog?.source === 'account' ||
                status.catalog?.source === 'provider') &&
              catalog &&
              !loading &&
              !models.length
            "
            role="status"
          >
            {{ t("ai.models.empty") }}
          </p>
        </div>
        <section class="settings-group" aria-labelledby="ai-chat-heading">
          <h3 id="ai-chat-heading">{{ t("settings.ai.chatModel") }}</h3>
          <div class="setting-row">
            <label for="settings-chat-model">{{ t("ai.model") }}</label>
            <form
              v-if="status?.config?.provider === 'custom'"
              @submit.prevent="select('chat', customChat)"
            >
              <SituateInput
                id="settings-chat-model"
                v-model="customChat"
                :list="customSuggestions.length ? customModelListId : undefined"
                :placeholder="
                  settings?.chat?.model && settings.chat.model !== 'recommended'
                    ? t('model.selectedLabel', { name: settings.chat.model })
                    : t('ai.modelID')
                "
                :disabled="disabled"
                maxlength="256"
              /><SituateButton
                variant="ghost"
                size="small"
                :disabled="disabled"
                type="submit"
              >
                {{ t("ai.useModelID") }}
              </SituateButton>
            </form>
            <SituateSelect
              v-else
              id="settings-chat-model"
              :value="settings?.chat?.model ?? ''"
              :disabled="disabled"
              @change="selectEvent('chat', $event)"
            >
              <option value="" disabled>{{ t("ai.chooseAModel") }}</option>
              <option
                v-if="
                  settings?.chat &&
                  settings.chat.model !== 'recommended' &&
                  !models.some((model) => model.id === settings?.chat?.model)
                "
                :value="settings.chat.model"
                :disabled="!!status?.modelError"
                data-localization-content="identity"
              >
                {{ settings.chat.model }}
              </option>
              <option
                v-if="
                  recommendations.chat ||
                  settings?.chat?.model === 'recommended'
                "
                value="recommended"
                :disabled="!recommendations.chat"
              >
                {{ t("settings.ai.recommended") }}
              </option>
              <option
                v-for="model in models"
                :key="model.id"
                :value="model.id"
                data-localization-content="identity"
              >
                {{ model.name }}
              </option>
            </SituateSelect>
          </div>
          <div class="setting-row">
            <label for="settings-thinking">{{
              t("settings.ai.thinking")
            }}</label
            ><SituateSelect
              id="settings-thinking"
              :value="settings?.chat?.thinking ?? 'recommended'"
              :disabled="disabled || levels.length < 2"
              :aria-describedby="
                levels.length < 2 || !status?.available
                  ? 'thinking-unavailable'
                  : undefined
              "
              @change="thinking"
              ><option value="recommended">
                {{ t("settings.ai.recommended") }}
              </option>
              <option v-for="level in levels" :key="level" :value="level">
                {{ thinkingLabel(level) }}
              </option></SituateSelect
            >
          </div>
          <p
            v-if="levels.length < 2 || !status?.available"
            id="thinking-unavailable"
            class="thinking-explanation"
          >
            {{
              !status?.available
                ? t("settings.ai.thinking.noAccess")
                : status?.config?.endpoint
                  ? t("settings.ai.thinking.unknown")
                  : t("settings.ai.thinking.unsupported")
            }}
          </p>
        </section>
        <section class="settings-group" aria-labelledby="ai-comments-heading">
          <h3 id="ai-comments-heading">{{ t("settings.ai.smallModel") }}</h3>
          <p id="small-model-help">{{ t("settings.ai.smallModelHelp") }}</p>
          <div class="setting-row">
            <label for="settings-generated">{{
              t("settings.ai.generatedComments")
            }}</label
            ><SituateSwitch
              id="settings-generated"
              :checked="settings?.generatedComments ?? true"
              :disabled="disabled"
              @change="toggle('generatedComments', $event)"
            />
          </div>
          <div class="setting-row">
            <label for="settings-comment-model">{{ t("ai.model") }}</label>
            <form
              v-if="status?.config?.provider === 'custom'"
              @submit.prevent="select('comment', customComment)"
            >
              <SituateInput
                id="settings-comment-model"
                aria-describedby="small-model-help"
                v-model="customComment"
                :list="customSuggestions.length ? customModelListId : undefined"
                :placeholder="
                  settings?.comment?.model &&
                  settings.comment.model !== 'recommended'
                    ? t('model.selectedLabel', { name: settings.comment.model })
                    : t('ai.modelID')
                "
                :disabled="disabled"
                maxlength="256"
              /><SituateButton
                variant="ghost"
                size="small"
                :disabled="disabled"
                type="submit"
              >
                {{ t("ai.useModelID") }}
              </SituateButton>
            </form>
            <SituateSelect
              v-else
              id="settings-comment-model"
              aria-describedby="small-model-help"
              :value="settings?.comment?.model ?? ''"
              :disabled="disabled"
              @change="selectEvent('comment', $event)"
              ><option value="" disabled>{{ t("ai.chooseAModel") }}</option>
              <option
                v-if="
                  settings?.comment &&
                  settings.comment.model !== 'recommended' &&
                  !commentModels.some(
                    (model) => model.id === settings?.comment?.model,
                  )
                "
                :value="settings.comment.model"
                data-localization-content="identity"
              >
                {{ settings.comment.model }}
              </option>
              <option
                v-if="
                  recommendations.comment ||
                  settings?.comment?.model === 'recommended'
                "
                value="recommended"
                :disabled="!recommendations.comment"
              >
                {{ t("settings.ai.recommended") }}
              </option>
              <option
                v-for="model in commentModels"
                :key="model.id"
                :value="model.id"
                data-localization-content="identity"
              >
                {{ model.name }}
              </option></SituateSelect
            >
          </div>
        </section>
      </SituateDisclosure>
    </div>
  </div>
</template>

<style scoped>
.advanced-settings {
  margin-top: 24px;
  border-top: 1px solid var(--situate-line);
}
.advanced-settings > :deep(summary) {
  padding: 20px 0;
  cursor: pointer;
  font-weight: 600;
  min-height: 44px;
}
.thinking-explanation {
  color: var(--situate-muted);
  font-size: 13px;
  line-height: 1.6;
}
.model-discovery {
  margin-bottom: 24px;
}
.model-discovery p {
  color: var(--situate-muted);
  font-size: 13px;
  line-height: 1.6;
}
.model-discovery button {
  padding: 0;
}
.ai-settings button,
.ai-settings input:not([type="checkbox"]) {
  min-height: 44px;
  font: inherit;
  color: var(--situate-ink);
}
.ai-settings input:not([type="checkbox"]) {
  max-width: 100%;
  padding: 8px;
}
.ai-settings button {
  border: 0;
  background: transparent;
  text-decoration: underline;
  text-underline-offset: 4px;
  cursor: pointer;
}
.ai-settings :focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
.ai-settings :disabled {
  cursor: not-allowed;
}
</style>
