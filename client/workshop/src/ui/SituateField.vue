<script setup lang="ts">
import { computed, useId } from "vue";
import c from "../localization/en.field-feedback.json";
const props = defineProps<{
  id?: string;
  label?: string;
  help?: string;
  error?: string;
  warning?: string;
  reserveFeedback?: boolean;
  announce?: boolean;
}>();
const generatedId = useId();
const controlId = computed(() => props.id ?? `situate-field-${generatedId}`);
const tone = computed(() =>
  props.error ? "error" : props.warning ? "warning" : undefined,
);
const feedback = computed(() => props.error || props.warning);
const describedBy = computed(
  () =>
    [
      props.help ? `${controlId.value}-help` : "",
      tone.value ? `${controlId.value}-${tone.value}` : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined,
);
const controlAttrs = computed(() => ({
  id: controlId.value,
  "aria-describedby": describedBy.value,
  "aria-invalid": props.error ? true : undefined,
  "data-field-tone": tone.value,
}));
</script>

<template>
  <div class="situate-field">
    <label v-if="label" :for="controlId">{{ label }}</label>
    <slot
      :id="controlId"
      :described-by="describedBy"
      :invalid="!!error"
      :control-attrs="controlAttrs"
    />
    <p v-if="help" :id="`${controlId}-help`" class="situate-field-help">
      {{ help }}
    </p>
    <div
      v-if="reserveFeedback || feedback || announce"
      :aria-live="announce ? 'polite' : undefined"
      aria-atomic="true"
      class="situate-field-feedback"
      :class="{ 'situate-field-feedback--reserved': reserveFeedback }"
    >
      <p
        v-if="feedback"
        :id="`${controlId}-${tone}`"
        :class="`situate-field-${tone}`"
      >
        <svg
          class="situate-field-symbol"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <circle v-if="tone === 'error'" cx="12" cy="12" r="9" />
          <path v-else d="M12 3 22 21H2Z" />
          <path d="M12 8v6m0 3v1" />
        </svg>
        <span
          ><strong>{{ tone === "error" ? c.error : c.warning }}</strong>
          {{ feedback }}</span
        >
      </p>
    </div>
  </div>
</template>

<style scoped>
.situate-field {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  display: grid;
  gap: var(--situate-space-2);
}
.situate-field-help,
.situate-field-error,
.situate-field-warning {
  margin: 0;
  font-size: var(--situate-text-small);
  line-height: var(--situate-leading-body);
}
.situate-field-help {
  color: var(--situate-muted);
}
.situate-field-error,
.situate-field-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--situate-space-2);
  color: var(--situate-ink);
}
.situate-field-feedback--reserved {
  min-block-size: calc(
    2 * var(--situate-text-small) * var(--situate-leading-body)
  );
}
.situate-field-symbol {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
}
</style>
