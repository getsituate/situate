<script setup lang="ts">
import { SituateButton, SituateCheckbox, SituateSelect } from "../ui";
import c from "../localization/en.components.json";
import type { ComponentLibraryState, ExampleStatus } from "./model";

defineProps<{ state: ComponentLibraryState }>();
const emit = defineEmits<{ patch: [patch: Partial<ComponentLibraryState>] }>();
</script>

<template>
  <div class="component-controls">
    <label for="component-state">{{ c.controls.state }}</label>
    <SituateSelect
      id="component-state"
      :value="state.status"
      @change="
        emit('patch', {
          status: ($event.target as HTMLSelectElement).value as ExampleStatus,
        })
      "
    >
      <option v-for="(label, status) in c.states" :key="status" :value="status">
        {{ label }}
      </option>
    </SituateSelect>
    <label class="component-check">
      <SituateCheckbox
        :checked="state.longLabels"
        @change="
          emit('patch', {
            longLabels: ($event.target as HTMLInputElement).checked,
          })
        "
      />
      {{ c.controls.longLabels }}
    </label>
    <label for="component-width">{{ c.controls.width }}</label>
    <SituateSelect
      id="component-width"
      :value="state.compact ? 'compact' : 'available'"
      @change="
        emit('patch', {
          compact: ($event.target as HTMLSelectElement).value === 'compact',
        })
      "
    >
      <option value="available">{{ c.controls.available }}</option>
      <option value="compact">{{ c.controls.compact }}</option>
    </SituateSelect>
    <div v-if="state.status === 'loading'" class="component-outcomes">
      <SituateButton
        size="small"
        @click="emit('patch', { status: 'success' })"
        >{{ c.controls.complete }}</SituateButton
      >
      <SituateButton
        variant="secondary"
        size="small"
        @click="emit('patch', { status: 'error' })"
        >{{ c.controls.fail }}</SituateButton
      >
    </div>
    <p>{{ c.controls.help }}</p>
    <p>{{ c.controls.transfer }}</p>
  </div>
</template>

<style scoped>
.component-controls {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.component-check,
.component-outcomes {
  display: flex;
  align-items: center;
  gap: 10px;
}
.component-check {
  min-height: 44px;
}
.component-outcomes {
  flex-wrap: wrap;
}
p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}
</style>
