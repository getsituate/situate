<script setup lang="ts">
import { SituateField, SituateInput } from "../ui";
import c from "../localization/en.field-feedback.json";
defineProps<{ compact: boolean; longLabels: boolean }>();
const states = Object.keys(c.states) as (keyof typeof c.states)[];
</script>

<template>
  <div class="feedback-examples" :class="{ compact }">
    <p>{{ c.reviewHelp }}</p>
    <div class="feedback-grid">
      <article v-for="state in states" :key="state">
        <h4>{{ c.states[state] }}</h4>
        <SituateField
          :id="`feedback-${state}`"
          :label="c.name"
          :help="state === 'default' ? undefined : c.help"
          :error="state === 'error' ? c.required : undefined"
          :warning="state === 'warning' ? c.warningExample : undefined"
          reserve-feedback
          v-slot="{ controlAttrs }"
        >
          <SituateInput
            v-bind="controlAttrs"
            :value="
              state === 'error' || state === 'default'
                ? ''
                : longLabels
                  ? c.longSample
                  : c.sample
            "
            :placeholder="c.placeholder"
            :class="{ 'focus-example': state === 'focus' }"
            readonly
          />
        </SituateField>
      </article>
    </div>
  </div>
</template>

<style scoped>
.feedback-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: var(--situate-space-6);
}
.compact .feedback-grid {
  grid-template-columns: minmax(0, 1fr);
}
.feedback-examples p {
  color: var(--situate-muted);
  line-height: 1.55;
}
.feedback-examples h4 {
  margin: 0 0 var(--situate-space-3);
}
.focus-example {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
</style>
