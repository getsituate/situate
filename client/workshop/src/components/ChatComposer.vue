<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import {
  SituateIcon,
  SituateIconButton,
  SituateTextarea,
  SituateButton,
} from "../ui";
import { chatContent as c } from "./chat-content";
const props = withDefaults(
  defineProps<{
    modelValue?: string;
    readonly?: boolean;
    enabled?: boolean;
    compact?: boolean;
    working?: boolean;
    label?: string;
    showLabel?: boolean;
    placeholder?: string;
    sendLabel?: string;
    unavailableReason?: string;
    submitBlocked?: boolean;
    selection?: { start: number; end: number };
    description?: string;
  }>(),
  {
    modelValue: "",
    readonly: true,
    enabled: false,
    compact: false,
    working: false,
    label: c.message,
    placeholder: c.placeholder,
    sendLabel: c.send,
    unavailableReason: c.unavailable,
  },
);
const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [];
  stop: [];
  selection: [value: { start: number; end: number }];
  edit: [value: { text: string; selection: { start: number; end: number } }];
}>();
const id = useId();
const field = ref<InstanceType<typeof SituateTextarea>>();
const canSend = computed(
  () =>
    props.enabled &&
    !props.submitBlocked &&
    !props.readonly &&
    !!props.modelValue.trim(),
);
let observer: ResizeObserver | undefined;
let width = 0;
let frame = 0;
function fit() {
  const input = field.value?.element;
  if (!input?.clientWidth) return;
  input.style.height = "44px";
  if (input.value) input.style.height = `${input.scrollHeight}px`;
}
function reportSelection() {
  const input = field.value?.element;
  if (!input) return;
  const value = { start: input.selectionStart, end: input.selectionEnd };
  if (
    value.start !== props.selection?.start ||
    value.end !== props.selection?.end
  )
    emit("selection", value);
}
function input(event: Event) {
  const input = event.target as HTMLTextAreaElement;
  emit("update:modelValue", input.value);
  emit("edit", {
    text: input.value,
    selection: { start: input.selectionStart, end: input.selectionEnd },
  });
  fit();
}
watch(
  () => props.selection,
  async (value) => {
    await nextTick();
    if (value) field.value?.element?.setSelectionRange(value.start, value.end);
  },
  { immediate: true },
);
function send() {
  if (canSend.value) emit("send");
}
function keydown(event: KeyboardEvent) {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.isComposing ||
    (!props.enabled && !props.submitBlocked)
  )
    return;
  event.preventDefault();
  send();
}
watch(
  () => props.modelValue,
  () => {
    void nextTick(fit);
  },
);
onMounted(() => {
  if (window.ResizeObserver) {
    observer = new ResizeObserver(() => {
      if (width === field.value?.element?.clientWidth) return;
      width = field.value?.element?.clientWidth ?? 0;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(field.value!.element!);
  }
  fit();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(frame);
});
defineExpose({
  focus: () => field.value?.element?.focus({ preventScroll: true }),
});
</script>
<template>
  <div class="chat-composer composer">
    <label :class="showLabel ? 'composer-label' : 'sr-only'" :for="id">{{
      label
    }}</label>
    <div class="input-line">
      <SituateIconButton
        v-if="compact"
        icon="plus"
        :label="c.attach"
        disabled
        :unavailable-reason="c.attachmentsUnavailable"
      />
      <SituateTextarea
        appearance="plain"
        :id="id"
        ref="field"
        :value="modelValue"
        :readonly="readonly"
        rows="1"
        :placeholder="placeholder"
        :aria-describedby="description"
        @select="reportSelection"
        @keyup="reportSelection"
        @pointerup="reportSelection"
        @blur="reportSelection"
        @input="input"
        @keydown="keydown"
      />
      <div class="input-actions">
        <slot name="microphone">
          <SituateIconButton
            icon="mic"
            :label="c.dictate"
            disabled
            :unavailable-reason="c.dictationUnavailable"
          />
        </slot>
        <SituateButton
          variant="plain"
          v-if="working"
          type="button"
          class="stop-action"
          :aria-label="c.stop"
          :title="c.stop"
          @click="emit('stop')"
        >
          <span aria-hidden="true" />
        </SituateButton>
        <slot name="send">
          <SituateIconButton
            icon="arrow"
            :label="sendLabel"
            variant="primary"
            :disabled="!canSend"
            :unavailable-reason="
              submitBlocked
                ? unavailableReason
                : enabled
                  ? c.empty
                  : unavailableReason
            "
            @click="send"
          />
        </slot>
      </div>
    </div>
    <div
      v-if="!compact || $slots.options"
      class="composer-footer composer-bottom"
    >
      <SituateButton
        variant="plain"
        v-if="!compact"
        type="button"
        class="attach-action"
        disabled
        :title="c.attachmentsUnavailable"
        :aria-description="c.attachmentsUnavailable"
      >
        <SituateIcon name="attach" />{{ c.attach }}
      </SituateButton>
      <slot name="options" />
    </div>
  </div>
</template>
<style scoped>
.chat-composer {
  margin-top: var(--situate-space-8);
}
.composer-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
}
.composer-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
}
.input-line {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 6px 6px 6px 12px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-control);
  background: var(--situate-surface);
}
.input-line:focus-within {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
textarea {
  display: block;
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 44px;
  min-height: 44px;
  max-height: min(140px, 25dvh);
  resize: none;
  overflow-y: auto;
  border: 0;
  padding: 10px 0;
  background: transparent;
  color: var(--situate-ink);
  font: inherit;
  line-height: 24px;
}
textarea::placeholder {
  color: var(--situate-muted);
  opacity: 1;
}
textarea:focus-visible {
  outline: none;
}
.input-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.input-actions :deep(.primary:disabled) {
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-muted);
}
.stop-action {
  display: grid;
  place-items: center;
  width: 44px;
  min-height: 44px;
  flex-shrink: 0;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-pill);
  background: transparent;
  color: var(--situate-ink);
}
.stop-action span {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: currentColor;
}
.attach-action {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  margin-top: 4px;
  padding: 10px 8px;
  border: 0;
  background: transparent;
  color: var(--situate-muted);
  font-size: var(--situate-text-caption);
}
</style>
