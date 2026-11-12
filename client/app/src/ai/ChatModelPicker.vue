<script setup lang="ts">
import {
  SituateField,
  SituateDialog,
  SituateButton,
  SituateDialogActions,
  SituateInput,
  SituateSelect,
  SituateIcon,
} from "@situate/ui";
import {
  useTemplateRef,
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useId,
  watch,
} from "vue";
import { t, localizeError } from "@situate/localization";
import { getStatus, refreshModels, type Status } from "./api";
import { useModelCatalog } from "./useModelCatalog";
import { workspaceAiSettings, type ThinkingLevel } from "./settings";
import {
  recommendedChoice,
  modelAvailability,
  supportedThinkingLevels,
} from "./recommendations";
import ChatChoiceDropdown from "./ChatChoiceDropdown.vue";
const props = withDefaults(
  defineProps<{
    workspaceScope?: string;
    label?: string;
    allowInheritance?: boolean;
    appearance?: "field" | "toolbar";
    status: Status | null;
    saving: boolean;
    running: boolean;
    unsaved: boolean;
    loadError?: boolean;
    selectionError?: unknown;
    selectionUncertain?: boolean;
    selectModel: (model: string | null) => Promise<boolean>;
    selectThinking?: (thinking: string | null) => Promise<boolean>;
  }>(),
  { allowInheritance: true },
);
const emit = defineEmits<{ retry: []; "focus-draft": [] }>();
const service = computed(() =>
  props.workspaceScope
    ? workspaceAiSettings(
        props.workspaceScope,
        props.status?.config?.connectionId,
      )
    : null,
);
watch(
  service,
  (value) => {
    if (value && !value.state.settings) void value.refresh();
  },
  { immediate: true },
);
const custom = computed(() => props.status?.config?.provider === "custom");
const id = useId();
const suggestions = computed(() =>
  custom.value && props.status?.catalog?.source === "provider"
    ? [...new Set(props.status.catalog.models)]
    : [],
);
const dialogControl =
  useTemplateRef<InstanceType<typeof SituateDialog>>("dialogControl");
const dialog = computed(() => dialogControl.value?.element);
const manualTriggerControl = useTemplateRef<InstanceType<typeof SituateButton>>(
  "manualTriggerControl",
);
const manualTrigger = computed(() => manualTriggerControl.value?.element);
const manual = ref("");
const { catalog, loading, failed, reload } = useModelCatalog(
  () => !!props.status?.config && !custom.value,
);
const models = computed(() =>
  props.status?.config
    ? (catalog.value?.availableChatModels(
        props.status.config,
        props.status.catalog,
      ) ?? [])
    : [],
);
const selected = computed(() => props.status?.selectedModel ?? "");
const recommended = computed(() =>
  props.status?.config
    ? recommendedChoice(
        props.status.config,
        "chat",
        modelAvailability(
          props.status.catalog,
          catalog.value && !loading.value && !failed.value
            ? models.value
            : undefined,
        ),
      )
    : null,
);
const inherited = computed(
  () =>
    props.allowInheritance !== false && (props.status?.modelInherited ?? true),
);
const workspaceDefault = ref<Status | null>(null);
let defaultRevision = 0;
watch(
  [() => props.workspaceScope, () => props.status],
  async ([scope, status]) => {
    const request = ++defaultRevision;
    workspaceDefault.value = inherited.value ? status : null;
    if (!scope || inherited.value) return;
    try {
      const resolved = await getStatus(scope);
      if (request === defaultRevision) workspaceDefault.value = resolved;
    } catch {
      // Keep an unreadable default unspecified rather than displaying the override.
    }
  },
  { immediate: true },
);
const defaultDetail = computed(() => {
  const status = workspaceDefault.value;
  return status?.available &&
    !status.modelError &&
    status.config &&
    status.selectedModel
    ? [status.config.label, status.config.provider, status.selectedModel]
        .filter(Boolean)
        .join(" · ")
    : t("ai.workspaceDefaultUnavailable");
});
const workspaceDefaultOption = computed(() => ({
  id: "",
  label: t("ai.workspaceDefault"),
  source: "↳",
  detail: defaultDetail.value,
}));
const modelName = computed(
  () =>
    models.value.find((model) => model.id === selected.value)?.name ??
    selected.value,
);
const modelSource = computed(() =>
  inherited.value
    ? "↳"
    : props.status?.modelPreference === "recommended"
      ? "☆"
      : undefined,
);
function sourceLabel(inherits: boolean, preference?: string | null) {
  return inherits
    ? t("ai.workspaceDefault")
    : preference === "recommended"
      ? t("settings.ai.recommended")
      : t("ai.conversationChoice");
}
const detail = computed(() =>
  t("model.nextMessageLabel", {
    name: [
      sourceLabel(inherited.value, props.status?.modelPreference),
      props.status?.config?.label,
      props.status?.config?.provider,
      selected.value,
    ]
      .filter(Boolean)
      .join(" · "),
  }),
);
const modelOptions = computed(() =>
  !props.status?.available
    ? props.allowInheritance === false
      ? []
      : [workspaceDefaultOption.value]
    : [
        ...(props.allowInheritance === false
          ? []
          : [workspaceDefaultOption.value]),
        ...(recommended.value
          ? [
              {
                id: "recommended",
                label: t("settings.ai.recommended"),
                source: "☆",
                detail: recommended.value.model,
              },
            ]
          : []),
        ...models.value.map((model) => ({
          id: model.id,
          label: model.name,
          identity: true,
        })),
        ...(selected.value &&
        !models.value.some((model) => model.id === selected.value)
          ? [{ id: selected.value, label: selected.value, identity: true }]
          : []),
      ],
);
function thinkingLabel(level: string): string {
  switch (level as ThinkingLevel) {
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
    default:
      return t("ai.choiceUnavailable");
  }
}
const levels = computed(() =>
  props.status?.config
    ? supportedThinkingLevels(props.status.config, selected.value)
    : [],
);
const thinkingValue = computed(() =>
  props.status?.thinkingInherited !== false
    ? ""
    : (props.status.thinkingPreference ?? "recommended"),
);
const thinkingName = computed(() =>
  props.status?.thinkingLevel
    ? thinkingLabel(props.status.thinkingLevel)
    : t("ai.choiceUnavailable"),
);
const thinkingSource = computed(() =>
  !thinkingValue.value
    ? "↳"
    : thinkingValue.value === "recommended"
      ? "☆"
      : undefined,
);
const thinkingDetail = computed(() =>
  t("ai.thinkingChoiceDetail", {
    level: thinkingName.value,
    source: sourceLabel(!thinkingValue.value, thinkingValue.value),
  }),
);
const thinkingOptions = computed(() => [
  {
    id: "",
    label: t("ai.restoreWorkspaceDefault"),
    source: "↳",
    detail: props.status?.inheritedThinkingLevel
      ? thinkingLabel(props.status.inheritedThinkingLevel)
      : undefined,
  },
  {
    id: "recommended",
    label: t("settings.ai.recommended"),
    source: "☆",
    detail: props.status?.recommendedThinkingLevel
      ? thinkingLabel(props.status.recommendedThinkingLevel)
      : undefined,
  },
  ...levels.value.map((level) => ({ id: level, label: thinkingLabel(level) })),
]);
const committing = ref(false),
  refreshingModels = ref(false),
  dismissed = ref(
    !props.status?.config && !props.selectionError && !props.selectionUncertain,
  );
const pending = ref<{
  kind: "model" | "thinking";
  value: string | null;
} | null>(null);
const discoveryError = ref<unknown>("");
watch(
  [
    pending,
    () => props.status,
    () => props.selectionError,
    () => props.selectionUncertain,
  ],
  ([choice, status, error, uncertain]) => {
    if (!choice || !status || error || uncertain) return;
    const preference =
      choice.kind === "model"
        ? status.modelPreference
        : status.thinkingPreference;
    if ((preference ?? null) === choice.value) pending.value = null;
  },
);
let revision = 0;
let alive = true;
onBeforeUnmount(() => {
  alive = false;
  revision++;
  defaultRevision++;
  dialog.value?.close();
});
watch(
  [() => props.workspaceScope, () => props.status?.config?.connectionId],
  () => {
    revision++;
    pending.value = null;
    discoveryError.value = "";
    dismissed.value = unconfigured();
    refreshingModels.value = false;
    dialog.value?.close();
  },
);
const busy = computed(
  () =>
    props.saving ||
    committing.value ||
    refreshingModels.value ||
    loading.value ||
    service.value?.state.loading ||
    service.value?.state.saving,
);
const disabled = computed(
  () =>
    !!(
      busy.value ||
      props.selectionUncertain ||
      (!props.status?.available && props.status?.modelInherited !== false) ||
      service.value?.state.error
    ),
);
const error = computed(
  () =>
    props.selectionError ||
    pending.value ||
    props.loadError ||
    failed.value ||
    service.value?.state.error ||
    props.status?.modelError ||
    discoveryError.value ||
    props.status?.catalog?.source === "unknown",
);
function unconfigured() {
  return (
    !props.status?.config &&
    !props.selectionError &&
    !props.selectionUncertain &&
    !pending.value &&
    !discoveryError.value
  );
}
watch(error, () => {
  dismissed.value = unconfigured();
});
async function choose(
  kind: "model" | "thinking",
  value: string | null,
): Promise<void> {
  if (
    disabled.value ||
    (value !== null && (!props.status?.available || !props.status.config))
  )
    return;
  const request = revision;
  committing.value = true;
  dialog.value?.close();
  emit("focus-draft");
  try {
    const saved =
      kind === "model"
        ? await props.selectModel(value)
        : await props.selectThinking?.(value);
    if (alive && request === revision)
      pending.value = saved ? null : { kind, value };
  } catch {
    if (alive && request === revision) pending.value = { kind, value };
  } finally {
    if (alive) committing.value = false;
  }
}
async function openManual(): Promise<void> {
  if (disabled.value) return;
  manual.value = selected.value;
  await nextTick();
  dialog.value?.showModal();
  dialog.value?.querySelector("input")?.focus();
}
function closeManual() {
  dialog.value?.close();
  manualTrigger.value?.focus();
}
async function retry(): Promise<void> {
  if (props.selectionUncertain || props.loadError) {
    emit("retry");
    return;
  }
  if (service.value?.state.error) {
    await service.value.refresh();
    emit("retry");
  } else if (failed.value) await reload();
  else if (pending.value) await choose(pending.value.kind, pending.value.value);
  else if (
    props.workspaceScope &&
    (props.status?.catalog?.source === "unknown" || discoveryError.value)
  ) {
    const request = ++revision;
    refreshingModels.value = true;
    discoveryError.value = "";
    try {
      await refreshModels(
        props.workspaceScope,
        props.status?.config?.connectionId,
      );
      if (alive && request === revision) emit("retry");
    } catch (reason) {
      if (alive && request === revision) discoveryError.value = reason;
    } finally {
      if (alive && request === revision) refreshingModels.value = false;
    }
  } else emit("retry");
}
</script>
<template>
  <div class="model-picker" :aria-busy="busy">
    <SituateButton
      variant="plain"
      v-if="custom && status?.available"
      ref="manualTriggerControl"
      type="button"
      class="manual-trigger"
      :class="{ 'field-trigger': appearance === 'field' }"
      :disabled="disabled"
      aria-haspopup="dialog"
      :aria-label="label ?? t('ai.model')"
      :title="detail"
      :aria-description="detail"
      @click="openManual"
    >
      <small v-if="modelSource" aria-hidden="true">{{ modelSource }}</small>
      <span data-localization-content="identity">{{
        modelName || t("ai.modelID")
      }}</span>
      <SituateIcon v-if="appearance === 'field'" name="chevron" />
    </SituateButton>
    <SituateSelect
      v-else-if="appearance === 'field'"
      :aria-label="label ?? t('ai.model')"
      :value="inherited ? '' : (status?.modelPreference ?? selected)"
      :disabled="disabled"
      @update:model-value="choose('model', String($event) || null)"
    >
      <option
        v-for="option in modelOptions"
        :key="option.id"
        :value="option.id"
        :data-localization-content="
          'identity' in option && option.identity ? 'identity' : undefined
        "
      >
        {{ option.label
        }}{{ "detail" in option && option.detail ? ` · ${option.detail}` : "" }}
      </option>
    </SituateSelect>
    <ChatChoiceDropdown
      v-else
      :label="label ?? t('ai.model')"
      :text="modelName || t('ai.chooseAModel')"
      :value="inherited ? '' : (status?.modelPreference ?? selected)"
      :options="modelOptions"
      :detail="detail"
      :source="modelSource"
      :disabled="disabled"
      @select="choose('model', $event || null)"
    />
    <ChatChoiceDropdown
      v-if="selectThinking && levels.length > 1"
      :label="t('settings.ai.thinking')"
      :text="thinkingName"
      :value="thinkingValue"
      class="thinking-choice"
      :options="thinkingOptions"
      :detail="thinkingDetail"
      :source="thinkingSource"
      :disabled="disabled"
      @select="choose('thinking', $event || null)"
    />
    <SituateButton
      variant="ghost"
      size="small"
      v-if="error"
      type="button"
      class="error-trigger"
      :aria-label="t('settings.ai.recovery')"
      aria-haspopup="dialog"
      :aria-expanded="!dismissed"
      @click="dismissed = !dismissed"
    >
      !
    </SituateButton>
    <SituateDialog
      v-if="error"
      :open="!!error && !dismissed"
      class="model-error"
      :aria-labelledby="`${id}-recovery-title`"
      :aria-describedby="`${id}-recovery-description`"
      @cancel.prevent="dismissed = true"
    >
      <h2 :id="`${id}-recovery-title`">{{ t("settings.ai.recovery") }}</h2>
      <p :id="`${id}-recovery-description`" role="alert">
        {{
          selectionUncertain
            ? t("ai.selectionUncertain")
            : selectionError
              ? localizeError(selectionError)
              : status?.modelError
                ? localizeError(status.modelError)
                : discoveryError
                  ? localizeError(discoveryError)
                  : status?.catalog?.source === "unknown" &&
                      !failed &&
                      !loadError &&
                      !service?.state.error
                    ? t("ai.models.lookupFailed")
                    : t("ai.modelChoicesCouldNotBeRead")
        }}
      </p>
      <template #actions>
        <SituateButton
          variant="primary"
          type="button"
          :disabled="busy"
          @click="retry"
        >
          {{ t("localization.retry") }}
        </SituateButton>
        <SituateButton
          variant="secondary"
          type="button"
          autofocus
          @click="dismissed = true"
        >
          {{ t("settings.ai.dismiss") }}
        </SituateButton>
      </template>
    </SituateDialog>
    <SituateDialog
      ref="dialogControl"
      :aria-label="t('ai.modelID')"
      @cancel.prevent="closeManual"
    >
      <h2>{{ t("ai.modelID") }}</h2>
      <form @submit.prevent="manual.trim() && choose('model', manual.trim())">
        <SituateButton
          v-if="allowInheritance !== false"
          variant="secondary"
          type="button"
          :disabled="disabled"
          @click="choose('model', null)"
        >
          {{ t("ai.restoreWorkspaceDefault") }}
        </SituateButton>
        <SituateField
          :id="`${id}-manual`"
          :label="t('ai.modelID')"
          v-slot="{ controlAttrs }"
        >
          <datalist v-if="suggestions.length" :id="`${id}-suggestions`">
            <option
              v-for="suggestion in suggestions"
              :key="suggestion"
              :value="suggestion"
              data-localization-content="identity"
            />
          </datalist>
          <SituateInput
            v-bind="controlAttrs"
            v-model="manual"
            :list="suggestions.length ? `${id}-suggestions` : undefined"
            required
            maxlength="256"
            autocomplete="off"
            spellcheck="false"
            :disabled="disabled"
          />
        </SituateField>
        <SituateDialogActions
          ><SituateButton
            variant="secondary"
            type="button"
            @click="closeManual"
          >
            {{ t("navigation.cancel") }}</SituateButton
          ><SituateButton
            variant="primary"
            type="submit"
            :disabled="disabled || !manual.trim()"
          >
            {{ t("ai.useModelID") }}
          </SituateButton>
        </SituateDialogActions>
      </form>
    </SituateDialog>
  </div>
</template>
<style scoped>
.model-picker {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
}
.thinking-choice {
  flex: 0 1 auto;
  max-width: 45%;
}
button:not(.situate-button),
input {
  font: inherit;
  font-size: var(--situate-text-caption);
  color: var(--situate-ink);
  min-height: 44px;
  border: 0;
  border-radius: var(--situate-radius-control);
  background: transparent;
}
button:not(.situate-button) {
  cursor: pointer;
  padding: 6px;
}
button:not(.situate-button):hover:not(:disabled) {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
:focus:where(html:not([data-input-modality="pointer"]) *):not(
    :where(.situate-button)
  ) {
  outline: 2px solid var(--situate-accent-strong, var(--situate-violet-deep));
  outline-offset: var(--situate-focus-offset);
}
:disabled:not(:where(.situate-button)) {
  opacity: 0.55;
  cursor: not-allowed;
}
.manual-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 240px;
}
.manual-trigger.field-trigger {
  box-sizing: border-box;
  min-height: 50px;
  padding: 12px 16px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-control);
  background: var(--situate-paper);
  color: var(--situate-ink);
  font: inherit;
}
.field-trigger > span {
  flex: 1;
  text-align: start;
}
.field-trigger :deep(svg) {
  width: 16px;
  height: 16px;
  flex: none;
}
.manual-trigger > span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.manual-trigger > small {
  flex: none;
}
form {
  display: grid;
  gap: 8px;
}
input {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--situate-control-line);
  padding: 8px;
}
</style>
