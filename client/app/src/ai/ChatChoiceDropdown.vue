<script setup lang="ts">
import { computed, useTemplateRef, ref, useId, watch } from "vue";
import { SituateButton, SituateIcon, SituateMenu } from "@situate/ui";
const props = defineProps<{
  label: string;
  text: string;
  value: string | null;
  options: {
    id: string;
    label: string;
    detail?: string;
    identity?: boolean;
    source?: string;
  }[];
  source?: string;
  disabled?: boolean;
  detail?: string;
}>();
const emit = defineEmits<{ select: [value: string] }>();
const id = useId();
const triggerControl =
  useTemplateRef<InstanceType<typeof SituateButton>>("triggerControl");
const trigger = computed(() => triggerControl.value?.element);
const opened = ref(false);
function close() {
  opened.value = false;
}
function open() {
  if (!props.disabled) opened.value = true;
}
function choose(value: string) {
  if (props.disabled) return;
  close();
  emit("select", value);
}
watch(
  () => props.disabled,
  (value) => {
    if (value) close();
  },
);
</script>
<template>
  <div class="dropdown">
    <SituateButton
      variant="plain"
      ref="triggerControl"
      type="button"
      class="choice-trigger"
      :aria-label="label"
      aria-haspopup="menu"
      :aria-expanded="opened"
      :aria-controls="id"
      :aria-description="detail"
      :title="detail || text"
      :disabled="disabled"
      :popovertarget="id"
      @click.prevent="opened ? close() : open()"
      @keydown.down.prevent="open"
      @keydown.up.prevent="open"
    >
      <small v-if="source" class="choice-source" aria-hidden="true">{{
        source
      }}</small>
      <span data-localization-content="identity">{{ text }}</span
      ><SituateIcon name="chevron" />
    </SituateButton>
    <SituateMenu
      :id="id"
      :open="opened"
      :anchor="trigger"
      :label="label"
      initial-focus="checked"
      align="start"
      :max-height="280"
      class="choice-options"
      @close="close"
    >
      <SituateButton
        variant="plain"
        v-for="(option, index) in options"
        :key="option.id"
        type="button"
        role="menuitemradio"
        tabindex="-1"
        :aria-checked="value === option.id"
        :aria-label="option.source ? option.label : undefined"
        :aria-describedby="option.detail ? `${id}-${index}-detail` : undefined"
        :data-choice="option.id"
        @click="choose(option.id)"
      >
        <span class="option-copy">
          <span>
            <span v-if="option.source" aria-hidden="true"
              >{{ option.source }}
            </span>
            <span
              :data-localization-content="
                option.identity ? 'identity' : undefined
              "
              >{{ option.label }}</span
            >
          </span>
          <small
            v-if="option.detail"
            :id="`${id}-${index}-detail`"
            data-localization-content="identity"
            >{{ option.detail }}</small
          ></span
        ><span aria-hidden="true">{{ value === option.id ? "✓" : "" }}</span>
      </SituateButton>
    </SituateMenu>
  </div>
</template>
<style scoped>
.dropdown {
  display: flex;
  min-width: 0;
}
.choice-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 240px;
  min-height: 44px;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--situate-radius-control);
  color: var(--situate-muted);
  background: transparent;
  font: inherit;
  font-size: var(--situate-text-caption);
  cursor: pointer;
}
.choice-source {
  flex: none;
  font-size: var(--situate-text-caption);
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
  opacity: 0.6;
}
:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: 2px solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.choice-options {
  font-size: 13px;
}
.choice-options button {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: start;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.choice-options button:hover,
.choice-options
  button:focus:where(html:not([data-input-modality="pointer"]) *) {
  background: var(--situate-lilac);
}
.choice-options small {
  display: block;
  margin-top: 4px;
  color: var(--situate-muted);
}
</style>
