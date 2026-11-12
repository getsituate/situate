<script setup lang="ts">
import { computed, inject, provide, ref, useId, watch } from "vue";
import { selectEnvironment } from "../ui/select-context";
import { SituateIcon, SituateButton } from "../ui";
import SituateMenu from "../ui/SituateMenu.vue";
const props = defineProps<{
  label: string;
  value: string | null;
  text: string;
  options: { id: string; label: string; detail?: string; source?: string }[];
  disabled?: boolean;
  describedby?: string;
  title?: string;
  description?: string;
  source?: string;
  accessibleText?: string;
}>();
const emit = defineEmits<{
  select: [id: string];
  "update:open": [open: boolean];
}>();
const id = useId();
const trigger = ref<InstanceType<typeof SituateButton>>();
const environment = inject(selectEnvironment, undefined);
provide(selectEnvironment, {
  mobile: environment?.mobile ?? ref(false),
  popupTarget: environment?.popupTarget,
  popupBoundary: computed(
    () =>
      trigger.value?.element?.closest<HTMLElement>(".chat-screen") ??
      environment?.popupBoundary?.value ??
      environment?.popupTarget?.value,
  ),
});
const opened = ref(false);
function close(restoreFocus = false) {
  opened.value = false;
  if (restoreFocus) trigger.value?.element?.focus({ preventScroll: true });
}
function open() {
  if (!props.disabled) opened.value = true;
}
function toggle() {
  if (opened.value) close(true);
  else open();
}
function select(value: string) {
  if (!props.disabled) emit("select", value);
}
watch(opened, (value) => emit("update:open", value));
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close();
  },
);
defineExpose({ close, open });
</script>

<template>
  <div class="dropdown">
    <SituateButton
      variant="plain"
      ref="trigger"
      type="button"
      class="choice-trigger"
      :aria-label="`${label}: ${accessibleText || text}`"
      aria-haspopup="menu"
      :aria-expanded="opened"
      :aria-controls="id"
      :aria-describedby="describedby"
      :aria-description="title"
      :disabled="disabled"
      :title="title || text"
      :popovertarget="id"
      @click.prevent="toggle"
      @keydown.down.prevent="toggle"
      @keydown.up.prevent="toggle"
    >
      <small v-if="source" class="choice-source" aria-hidden="true">{{
        source
      }}</small>
      <span>{{ text }}</span
      ><SituateIcon name="chevron" />
    </SituateButton>
    <SituateMenu
      :id="id"
      :open="opened"
      :anchor="trigger?.element"
      :label="label"
      initial-focus="checked"
      @close="close()"
    >
      <p v-if="description" class="choice-description">{{ description }}</p>
      <SituateButton
        variant="plain"
        v-for="option in options"
        :key="option.id"
        type="button"
        role="menuitemradio"
        tabindex="-1"
        :aria-checked="value === option.id"
        :data-choice="option.id"
        @click="select(option.id)"
      >
        <span class="option-copy"
          ><span
            ><span v-if="option.source" aria-hidden="true"
              >{{ option.source }} </span
            >{{ option.label }}</span
          >
          <small v-if="option.detail">{{ option.detail }}</small></span
        ><span class="choice-check" aria-hidden="true">{{
          value === option.id ? "✓" : ""
        }}</span>
      </SituateButton>
    </SituateMenu>
  </div>
</template>

<style scoped>
.choice-description {
  margin: 0;
  padding: 10px 12px;
  color: var(--situate-muted);
  font-size: 12px;
  line-height: 1.5;
}
.option-copy {
  display: grid;
  gap: 4px;
}
.option-copy small {
  color: var(--situate-muted);
  font-size: 12px;
}
.dropdown {
  display: flex;
  min-width: 0;
}
.choice-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  min-height: 44px;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--situate-muted);
  font: inherit;
  cursor: pointer;
}
.choice-source {
  flex: none;
  font-size: 12px;
}
.choice-trigger > span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.choice-trigger :deep(svg) {
  width: 12px;
  height: 12px;
  flex: none;
}
.choice-trigger:disabled {
  cursor: default;
}
.choice-trigger[aria-expanded="true"] {
  color: var(--situate-ink);
}
.choice-trigger:focus-visible {
  outline: 2px solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.choice-check {
  width: 14px;
  flex: none;
  text-align: center;
}
@media (hover: hover) {
  .choice-trigger:not(:disabled):hover {
    color: var(--situate-ink);
  }
}
@media (prefers-reduced-motion: no-preference) {
  .choice-trigger {
    transition: color 120ms ease-out;
  }
}
</style>
