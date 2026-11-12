<script setup lang="ts">
import { SituateInput, SituateButton } from "../ui";
import type { AuthField } from "./fields";
import SituateSelect from "../ui/SituateSelect.vue";
import type { AiState } from "./model";
defineProps<{ fields: AuthField[]; state: AiState }>();
const emit = defineEmits<{ input: [id: string, value: string]; reveal: [] }>();
</script>
<template>
  <div v-for="field in fields" :key="field.id" class="stack">
    <label class="field" :for="field.id"
      >{{ field.label }}{{ field.required ? "" : " (optional)" }}
      <SituateSelect
        v-if="field.options"
        :id="field.id"
        :name="field.id"
        :value="state.values[field.id] || field.options[0].id"
        @change="
          emit('input', field.id, ($event.target as HTMLSelectElement).value)
        "
      >
        <option
          v-for="option in field.options"
          :key="option.id"
          :value="option.id"
        >
          {{ option.label }}
        </option>
      </SituateSelect>
      <SituateInput
        v-else
        :id="field.id"
        :name="field.id"
        :type="
          field.type === 'password' && field.id === 'credential' && state.reveal
            ? 'text'
            : field.type
        "
        :required="field.required"
        :placeholder="field.placeholder"
        :value="state.values[field.id] || ''"
        autocomplete="off"
        spellcheck="false"
        :aria-invalid="state.invalidField === field.id || undefined"
        :aria-describedby="
          state.invalidField === field.id
            ? 'field-error'
            : field.hint
              ? `${field.id}-hint`
              : undefined
        "
        @input="
          emit('input', field.id, ($event.target as HTMLInputElement).value)
        "
      />
      <small v-if="field.hint" :id="`${field.id}-hint`">{{ field.hint }}</small>
    </label>
    <p
      v-if="state.invalidField === field.id"
      id="field-error"
      class="error"
      role="alert"
    >
      {{ state.fieldError }}
    </p>
    <div v-if="field.id === 'credential'">
      <SituateButton
        variant="secondary"
        size="small"
        type="button"
        @click="emit('reveal')"
      >
        {{ state.reveal ? "Hide value" : "Show value" }}
      </SituateButton>
    </div>
  </div>
</template>
<style scoped>
.stack,
.field {
  display: grid;
  gap: 8px;
}
.field {
  font-weight: 600;
}
small {
  color: var(--situate-muted);
  font-size: 14px;
  font-weight: 400;
}
input,
select {
  width: 100%;
  min-width: 0;
}
:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.error {
  margin: 0;
  padding: 12px;
  background: var(--situate-note);
  border-inline-start: 3px solid var(--situate-violet-deep);
}
</style>
