<script setup lang="ts">
import {
  SituateButton,
  SituateRadio,
  SituateDialog,
  SituateIcon,
  SituateInfoButton,
  SituateLoading,
} from "@situate/ui";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import { t, type MessageKey } from "@situate/localization";
import {
  accents,
  accentLabels,
  accentStyle,
  companionAccents,
  type Accent,
} from "./accents";
import type { WorkspaceTheme } from "./theme-tokens";

const props = defineProps<{
  accent: Accent;
  compact?: boolean;
  swatches?: boolean;
  workspaceName: string;
  loading: boolean;
  saving: boolean;
  available: boolean;
  writable: boolean;
  error: MessageKey | "";
  workspaceThemes?: boolean;
  themes?: readonly WorkspaceTheme[];
  selectedTheme?: string;
  themeBusy?: boolean;
}>();
const emit = defineEmits<{
  select: [accent: Accent];
  theme: [key: string];
  retry: [];
}>();
const recoveryId = useId();
const dismissed = ref(false);
let lastChosenColor: Accent | undefined;
const recoveryControl =
  useTemplateRef<InstanceType<typeof SituateButton>>("recoveryControl");
const saveAttempted = ref(false);
watch([() => props.saving, () => props.error], ([saving, error]) => {
  if (saving) saveAttempted.value = true;
  else if (!error) saveAttempted.value = false;
});
watch(
  () => props.error,
  () => {
    dismissed.value = false;
  },
);
const saveFailure = computed(
  () =>
    !!props.error &&
    (saveAttempted.value || props.error !== "settings.appearance.loadFailed"),
);
function select(color: Accent) {
  lastChosenColor = color;
  emit("select", color);
  if (props.themes?.length) void restoreCheckedChoice();
}
async function restoreCheckedChoice() {
  await nextTick();
  for (const input of colors.value?.querySelectorAll<HTMLInputElement>(
    'input[type="radio"]',
  ) ?? []) {
    input.checked = input.value === (props.selectedTheme ?? props.accent);
  }
}
function selectTheme(key: string) {
  emit("theme", key);
  void restoreCheckedChoice();
}
async function dismissRecovery() {
  dismissed.value = true;
  focusedColor = lastChosenColor ?? focusedColor;
  await nextTick();
  if (!mounted || props.loading) return;
  const inputs = Array.from(colors.value?.querySelectorAll("input") ?? []);
  const target =
    inputs.find((input) => input.value === focusedColor) ??
    inputs.find((input) => input.checked);
  if (target && !target.disabled) target.focus();
  else recoveryControl.value?.focus();
  focusedColor = undefined;
}
function retry() {
  dismissed.value = false;
  emit("retry");
}
const id = useId();
const colors = useTemplateRef<HTMLFieldSetElement>("colors");
let focusedColor: string | undefined;
let mounted = true;
watch(
  () => props.loading || !props.available || !props.writable,
  async (blocked) => {
    if (blocked) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && colors.value?.contains(active))
        focusedColor = active.value;
      return;
    }
    await nextTick();
    if (mounted && focusedColor && document.activeElement === document.body) {
      const input = Array.from(
        colors.value?.querySelectorAll("input") ?? [],
      ).find((input) => input.value === focusedColor);
      input?.focus();
    }
    if (!saveFailure.value || dismissed.value) focusedColor = undefined;
  },
);
onBeforeUnmount(() => {
  mounted = false;
});
function previewColor(theme: WorkspaceTheme): string | undefined {
  return (
    theme.preview?.color ??
    theme.variables["--situate-accent"] ??
    theme.variables["--situate-accent-strong"] ??
    theme.variables["--situate-ink"]
  );
}
function colorName(color: Accent): string {
  const key: MessageKey = accentLabels[color];
  return t(key);
}
</script>

<template>
  <SituateLoading
    v-if="loading && !available"
    placement="inline"
    pending
    :label="t('settings.appearance.loading')"
  />
  <div v-if="props.error && !saveFailure" class="settings-error" role="alert">
    <p>{{ t(props.error) }}</p>
    <SituateButton
      variant="secondary"
      size="small"
      type="button"
      :disabled="loading || saving"
      @click="emit('retry')"
    >
      {{ t("settings.appearance.retry") }}
    </SituateButton>
  </div>
  <SituateDialog
    v-if="saveFailure"
    :open="!dismissed"
    :aria-labelledby="`${recoveryId}-title`"
    :aria-describedby="`${recoveryId}-description`"
    @cancel.prevent="dismissRecovery"
  >
    <h2 :id="`${recoveryId}-title`">{{ t("settings.appearance.recovery") }}</h2>
    <p :id="`${recoveryId}-description`" role="alert">
      {{ props.error ? t(props.error) : "" }}
    </p>
    <template #actions>
      <SituateButton variant="secondary" autofocus @click="dismissRecovery">{{
        t("settings.ai.dismiss")
      }}</SituateButton>
      <SituateButton :disabled="loading || saving" @click="retry">{{
        t("settings.appearance.retry")
      }}</SituateButton>
    </template>
  </SituateDialog>
  <SituateButton
    v-if="saveFailure && dismissed"
    ref="recoveryControl"
    variant="secondary"
    size="small"
    :disabled="loading || saving"
    @click="retry"
  >
    {{ t("settings.appearance.retry") }}
  </SituateButton>
  <p v-if="available && !writable">{{ t("settings.appearance.readOnly") }}</p>
  <fieldset
    v-if="available"
    ref="colors"
    class="appearance-colors"
    :class="{ compact, swatches }"
    :aria-labelledby="workspaceThemes ? `${id}-theme-title` : undefined"
    :aria-describedby="
      workspaceThemes || swatches ? undefined : `${id}-accent-help`
    "
    :disabled="loading || (!writable && !themes?.length)"
    :aria-busy="themeBusy || undefined"
  >
    <legend v-if="workspaceThemes" class="appearance-theme-legend">
      <span class="appearance-theme-heading">
        <span :id="`${id}-theme-title`">{{
          t("settings.appearance.theme")
        }}</span>
        <SituateInfoButton
          :label="t('settings.appearance.themeInfo')"
          :text="t('settings.appearance.themeDevice')"
        />
      </span>
    </legend>
    <legend v-else>{{ t("settings.appearance.accentColor") }}</legend>
    <p
      v-if="!workspaceThemes && !swatches"
      :id="`${id}-accent-help`"
      class="settings-section-help"
    >
      <slot name="help">{{
        t("settings.appearance.help", { workspace: workspaceName })
      }}</slot>
    </p>
    <div class="appearance-options">
      <label
        v-for="color in accents"
        :key="color"
        :for="`${id}-accent-${color}`"
        class="appearance-option"
        :style="accentStyle(color)"
        :title="
          t('settings.appearance.pairName', {
            primary: colorName(color),
            companion: colorName(companionAccents[color]),
          })
        "
      >
        <SituateRadio
          :id="`${id}-accent-${color}`"
          appearance="plain"
          type="radio"
          :name="`${id}-workspace-accent`"
          :value="color"
          :disabled="!writable && (!selectedTheme || accent !== color)"
          :checked="!selectedTheme && accent === color"
          :aria-description="
            t('settings.appearance.companion', {
              color: colorName(companionAccents[color]),
            })
          "
          @change="select(color)"
        />
        <span class="appearance-option-content">
          <span class="appearance-swatch" aria-hidden="true"></span>
          <SituateIcon
            v-if="!selectedTheme && accent === color"
            name="check"
            class="appearance-selected"
          />
          <span class="appearance-color-name">
            {{ colorName(color) }}
            <small v-if="color === 'violet'">{{
              t("settings.appearance.default")
            }}</small>
          </span>
        </span>
      </label>
      <label
        v-for="(theme, index) in themes"
        :key="theme.key"
        :for="`${id}-theme-${index}`"
        class="appearance-option appearance-plugin-option"
        :style="{ '--appearance-preview-color': previewColor(theme) }"
      >
        <SituateRadio
          :id="`${id}-theme-${index}`"
          appearance="plain"
          type="radio"
          :name="`${id}-workspace-accent`"
          :value="theme.key"
          :checked="selectedTheme === theme.key"
          @change="selectTheme(theme.key)"
        />
        <span class="appearance-option-content">
          <span class="appearance-theme-swatch" aria-hidden="true">
            <svg
              v-if="typeof theme.preview?.icon === 'object'"
              class="appearance-theme-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="theme.preview.icon.path" />
            </svg>
            <SituateIcon
              v-else
              :name="theme.preview?.icon ?? 'plugins'"
              class="appearance-theme-icon"
            />
          </span>
          <SituateIcon
            v-if="selectedTheme === theme.key"
            name="check"
            class="appearance-selected"
          />
          <span class="appearance-color-name">
            <span data-localization-content="user">{{ theme.title }}</span>
            <small data-localization-content="user">{{ theme.provider }}</small>
          </span>
        </span>
      </label>
    </div>
  </fieldset>
</template>

<style scoped>
.appearance-colors {
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}
.appearance-colors legend {
  padding: 0;
  font-size: var(--situate-text-body);
  font-weight: 650;
}
.appearance-theme-legend {
  margin-block-end: var(--situate-space-3);
}
.appearance-theme-heading {
  display: inline-flex;
  align-items: center;
  gap: var(--situate-space-1);
}
.appearance-colors .settings-section-help {
  margin: var(--situate-space-2) 0 var(--situate-space-6);
  max-width: 48ch;
  color: var(--situate-muted);
  font-size: var(--situate-text-caption);
  line-height: 1.6;
}
.appearance-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--situate-space-3);
}
.appearance-option {
  position: relative;
  min-width: 0;
  cursor: pointer;
}
.appearance-option input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  margin: 0;
  cursor: pointer;
}
.appearance-option-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--situate-space-3);
  min-height: 132px;
  padding: var(--situate-space-5) var(--situate-space-2) var(--situate-space-4);
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-panel);
  background: var(--situate-surface);
}
.appearance-option input:checked + .appearance-option-content {
  background: var(--situate-accent-soft);
  border: 2px solid var(--situate-accent-strong);
  padding: 19px 7px 15px;
}
.appearance-option input:disabled + .appearance-option-content {
  opacity: 0.65;
}
.appearance-option input:disabled {
  cursor: not-allowed;
}
.appearance-option
  input:focus:where(html:not([data-input-modality="pointer"]) *)
  + .appearance-option-content {
  outline: var(--situate-stroke-focus) solid var(--situate-ink);
  outline-offset: var(--situate-focus-offset);
}
.appearance-swatch {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 50%;
  background: linear-gradient(
    to right,
    var(--situate-accent) 63%,
    var(--situate-content-accent) 63%
  );
  border: 1px solid var(--situate-control-line);
}
.appearance-plugin-option {
  --appearance-check-color: var(--situate-ink);
  --appearance-swatch-color: var(
    --appearance-preview-color,
    var(--situate-ink)
  );
  --appearance-swatch-surface: color-mix(
    in srgb,
    var(--appearance-swatch-color) 12%,
    var(--situate-surface)
  );
}
.appearance-plugin-option input:checked + .appearance-option-content {
  background: var(--appearance-swatch-surface);
  border-color: var(--appearance-swatch-color);
}
.appearance-theme-swatch {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border: 1px solid var(--appearance-swatch-color);
  border-radius: 50%;
  background: var(--appearance-swatch-surface);
  color: var(--appearance-swatch-color);
}
.appearance-theme-icon {
  width: 24px;
  height: 24px;
}
.appearance-selected {
  position: absolute;
  inset-block-start: 10px;
  inset-inline-end: 10px;
  width: 16px;
  height: 16px;
  color: var(--appearance-check-color, var(--situate-accent-strong));
  pointer-events: none;
}
.compact .appearance-selected {
  inset-block-start: 6px;
  inset-inline-end: 6px;
}
.appearance-color-name {
  font-size: var(--situate-text-small);
  font-weight: 600;
  text-align: center;
  line-height: var(--situate-leading-compact);
  min-height: 38px;
  overflow-wrap: anywhere;
}
.appearance-color-name small {
  display: block;
  font-size: var(--situate-text-label);
  font-weight: 400;
  color: var(--situate-muted);
}
.compact .appearance-option {
  margin: 0;
}
.compact .appearance-options {
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--situate-space-2);
}
.compact .appearance-option-content {
  min-height: 104px;
  padding: var(--situate-space-3) var(--situate-space-2);
  gap: var(--situate-space-2);
}
.compact .appearance-option input:checked + .appearance-option-content {
  padding: 11px 7px;
}
.compact .appearance-swatch {
  width: 32px;
  height: 32px;
}
.compact .appearance-color-name {
  font-size: var(--situate-text-caption);
}
@media (max-width: 700px) {
  .compact .appearance-options {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (hover: hover) {
  .appearance-option:hover .appearance-option-content {
    border-color: var(--situate-ink);
  }
}
@media (max-width: 360px) {
  .appearance-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.swatches .appearance-options {
  display: flex;
  gap: var(--situate-space-1);
  overflow-x: auto;
  padding: var(--situate-space-1);
  margin: var(--situate-space-2) calc(-1 * var(--situate-space-1))
    calc(-1 * var(--situate-space-1));
}
.swatches .appearance-option {
  flex: 0 0 44px;
  margin: 0;
}
.swatches .appearance-option-content,
.swatches .appearance-option input:checked + .appearance-option-content {
  min-height: 44px;
  padding: var(--situate-space-1);
  border-radius: var(--situate-radius-small);
}
.swatches .appearance-selected {
  inset-block-start: 3px;
  inset-inline-end: 3px;
  width: 12px;
  height: 12px;
}
.swatches .appearance-swatch {
  width: 28px;
  height: 28px;
  margin-inline-end: 3px;
}
.swatches .appearance-color-name {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
@media (forced-colors: active) {
  .appearance-option input:checked + .appearance-option-content {
    border-color: Highlight;
  }
  .appearance-selected {
    color: CanvasText;
  }
  .appearance-swatch {
    forced-color-adjust: none;
  }
}
</style>
