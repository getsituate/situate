<script setup lang="ts">
import { SituateButton, SituateRadio, SituateDialog } from "@situate/ui";
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
import { accents, accentLabels, accentStyle, type Accent } from "./accents";

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
}>();
const emit = defineEmits<{ select: [accent: Accent]; retry: [] }>();
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
function colorName(color: Accent): string {
  const key: MessageKey = accentLabels[color];
  return t(key);
}
</script>

<template>
  <p v-if="loading && !available" role="status">
    {{ t("settings.appearance.loading") }}
  </p>
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
    :aria-describedby="swatches ? undefined : `${id}-accent-help`"
    :disabled="loading || !writable"
  >
    <legend>{{ t("settings.appearance.accentColor") }}</legend>
    <p v-if="!swatches" :id="`${id}-accent-help`" class="settings-section-help">
      <slot name="help">{{
        t("settings.appearance.help", { workspace: workspaceName })
      }}</slot>
    </p>
    <div class="appearance-options">
      <label
        v-for="color in accents"
        :key="color"
        class="appearance-option"
        :style="accentStyle(color)"
        :title="colorName(color)"
      >
        <SituateRadio
          appearance="plain"
          type="radio"
          :name="`${id}-workspace-accent`"
          :value="color"
          :checked="accent === color"
          @change="select(color)"
        />
        <span class="appearance-option-content">
          <span class="appearance-swatch" aria-hidden="true">
            <svg v-if="accent === color" viewBox="0 0 24 24">
              <path d="m6 12 4 4 8-8" />
            </svg>
          </span>
          <span class="appearance-color-name">
            {{ colorName(color) }}
            <small v-if="color === 'violet'">{{
              t("settings.appearance.default")
            }}</small>
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
  font-size: 16px;
  font-weight: 650;
}
.appearance-colors .settings-section-help {
  margin: 8px 0 24px;
  max-width: 48ch;
  color: var(--situate-muted);
  font-size: 13px;
  line-height: 1.6;
}
.appearance-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
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
  gap: 12px;
  min-height: 132px;
  padding: 20px 8px 16px;
  border: 1px solid var(--situate-control-line);
  border-radius: 16px;
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
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--situate-accent);
  color: var(--situate-accent-on);
  border: 1px solid var(--situate-accent-edge);
}
.appearance-swatch svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.appearance-color-name {
  font-size: 14px;
  font-weight: 600;
  text-align: center;
  line-height: 1.4;
  min-height: 38px;
  overflow-wrap: anywhere;
}
.appearance-color-name small {
  display: block;
  font-size: 12px;
  font-weight: 400;
  color: var(--situate-muted);
}
.compact .appearance-option {
  margin: 0;
}
.compact .appearance-options {
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}
.compact .appearance-option-content {
  min-height: 104px;
  padding: 12px 8px;
  gap: 8px;
}
.compact .appearance-option input:checked + .appearance-option-content {
  padding: 11px 7px;
}
.compact .appearance-swatch {
  width: 32px;
  height: 32px;
}
.compact .appearance-color-name {
  font-size: 13px;
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
  gap: 4px;
  overflow-x: auto;
  padding: 4px;
  margin: 8px -4px -4px;
}
.swatches .appearance-option {
  flex: 0 0 44px;
  margin: 0;
}
.swatches .appearance-option-content,
.swatches .appearance-option input:checked + .appearance-option-content {
  min-height: 44px;
  padding: 4px;
  border-radius: var(--situate-radius-small);
}
.swatches .appearance-swatch {
  width: 32px;
  height: 32px;
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
  .appearance-swatch {
    forced-color-adjust: none;
  }
}
</style>
