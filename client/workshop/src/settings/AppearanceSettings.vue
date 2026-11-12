<script setup lang="ts">
import { SituateRadio } from "../ui";
import copy from "../localization/en.appearance.json";
import { accents, accentStyle, type Accent } from "./accents";

defineProps<{
  accent: Accent;
  workspaceName: string;
  help?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ select: [accent: Accent] }>();
</script>

<template>
  <fieldset
    class="appearance-colors"
    aria-describedby="accent-help"
    :disabled="disabled"
  >
    <legend>{{ copy.accentColor }}</legend>
    <p id="accent-help" class="settings-section-help">
      {{ help ?? copy.help.replace("{workspace}", workspaceName) }}
    </p>
    <div class="appearance-options">
      <label
        v-for="color in accents"
        :key="color"
        class="appearance-option"
        :style="accentStyle(color)"
      >
        <SituateRadio
          appearance="plain"
          type="radio"
          name="workspace-accent"
          :value="color"
          :checked="accent === color"
          @change="emit('select', color)"
        />
        <span class="appearance-option-content">
          <span class="appearance-swatch" aria-hidden="true">
            <svg v-if="accent === color" viewBox="0 0 24 24">
              <path d="m6 12 4 4 8-8" />
            </svg>
          </span>
          <span class="appearance-color-name">
            {{ copy.colors[color] }}
            <small v-if="color === 'violet'">{{ copy.default }}</small>
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
  margin: 0;
  position: relative;
  min-width: 0;
  cursor: pointer;
}
.appearance-colors .appearance-option input {
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
.appearance-option input:focus-visible + .appearance-option-content {
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
@media (forced-colors: active) {
  .appearance-option input:checked + .appearance-option-content {
    border-color: Highlight;
  }
  .appearance-swatch {
    forced-color-adjust: none;
  }
}
</style>
