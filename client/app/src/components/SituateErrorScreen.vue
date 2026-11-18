<script setup lang="ts">
import { onMounted, useId, useTemplateRef } from "vue";
import ErrorActions from "../errors/ErrorActions.vue";
defineProps<{ message: string; title?: string }>();
const id = useId();
const heading = useTemplateRef<HTMLHeadingElement>("heading");
onMounted(() => heading.value?.focus());
</script>

<template>
  <div
    class="situate-error-screen"
    :role="title ? 'region' : undefined"
    :aria-labelledby="title ? `${id}-title` : undefined"
  >
    <h2 v-if="title" :id="`${id}-title`" ref="heading" tabindex="-1">
      {{ title }}
    </h2>
    <p role="alert">{{ message }}</p>
    <div class="situate-error-screen__actions">
      <slot name="actions">
        <ErrorActions boundary="view" />
      </slot>
    </div>
  </div>
</template>

<style scoped>
.situate-error-screen {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  flex: none;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: auto;
  overflow: auto;
  padding: max(24px, var(--app-safe-area-top, env(safe-area-inset-top))) 18px
    max(24px, var(--app-safe-area-bottom, env(safe-area-inset-bottom)));
  color: var(--situate-ink);
}
.situate-error-screen h2 {
  margin: 0;
  font-size: var(--situate-text-lead);
  font-weight: 650;
  line-height: 1.3;
}
.situate-error-screen__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.situate-error-screen p {
  max-width: 40rem;
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
