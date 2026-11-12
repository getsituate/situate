<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { SituateButton, SituateCheckbox, SituateDialog } from "../ui";
import copy from "../localization/en.working-method.json";
import type { OnboardingAction, OnboardingState } from "./model";
const props = defineProps<{ state: OnboardingState }>();
const emit = defineEmits<{ action: [action: OnboardingAction] }>();
const id = useId();
const root = ref<HTMLElement>();
const dialogControl = ref<InstanceType<typeof SituateDialog>>();
const dialog = computed(() => dialogControl.value?.element);
const heading = ref<HTMLElement>();
const content = ref<HTMLElement>();
let opener: HTMLButtonElement | null = null;
const current = computed(() =>
  copy.methods.find((method) => method.id === props.state.methodInfo),
);
const selected = computed(
  () => !!current.value && props.state.approaches.includes(current.value.id),
);
const busy = computed(() => props.state.methodRequest !== null);
function toggle(method: string) {
  emit("action", {
    type: "patch",
    patch: {
      approaches: props.state.approaches.includes(method)
        ? props.state.approaches.filter((id) => id !== method)
        : [...props.state.approaches, method],
    },
  });
}
function close() {
  emit("action", { type: "method-info", id: null });
}
function keyboard(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const elements = [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [tabindex="0"]',
    ) ?? []),
  ].filter((element) => element.getClientRects().length);
  event.preventDefault();
  const index = elements.indexOf(document.activeElement as HTMLElement);
  const next =
    index < 0
      ? event.shiftKey
        ? elements.length - 1
        : 0
      : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
  (elements[next] ?? heading.value)?.focus();
}
function choose() {
  if (!current.value || busy.value) return;
  toggle(current.value.id);
  close();
}
watch(
  () => props.state.methodInfo,
  async (method) => {
    await nextTick();
    if (method && current.value) {
      opener =
        root.value?.querySelector<HTMLButtonElement>(
          `[data-method-info="${method}"]`,
        ) ?? null;
      if (!dialog.value?.open) dialog.value?.showModal();
      if (content.value) content.value.scrollTop = 0;
      heading.value?.focus({ preventScroll: true });
    } else {
      if (dialog.value?.open) dialog.value.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }
  },
  { immediate: true },
);
</script>
<template>
  <section ref="root" class="method-picker">
    <fieldset :disabled="busy" :aria-describedby="`${id}-help`">
      <legend>{{ copy.inspiration }}</legend>
      <p :id="`${id}-help`" class="help">{{ copy.inspirationHelp }}</p>
      <div class="method-grid">
        <div
          v-for="method in copy.methods"
          :key="method.id"
          class="method-tile"
          :class="{ selected: state.approaches.includes(method.id) }"
        >
          <label
            ><SituateCheckbox
              appearance="plain"
              type="checkbox"
              :checked="state.approaches.includes(method.id)"
              @change="toggle(method.id)"
            /><span class="method-name">{{ method.name }}</span></label
          >
          <SituateButton
            variant="plain"
            class="method-info"
            :data-method-info="method.id"
            :aria-label="copy.learn.replace('{method}', method.name)"
            aria-haspopup="dialog"
            @click="emit('action', { type: 'method-info', id: method.id })"
          >
            <span aria-hidden="true">i</span>
          </SituateButton>
        </div>
      </div>
    </fieldset>
    <SituateDialog
      ref="dialogControl"
      class="method-dialog"
      :aria-labelledby="`${id}-title`"
      @cancel.prevent="close"
      @keydown="keyboard"
    >
      <template v-if="current">
        <header>
          <h2 ref="heading" :id="`${id}-title`" tabindex="-1" data-dialog-title>
            {{ copy.dialogTitle.replace("{method}", current.name) }}
          </h2>
        </header>
        <div
          ref="content"
          class="dialog-content"
          tabindex="0"
          :aria-label="current.name"
        >
          <p class="description">{{ current.description }}</p>
          <h3>{{ copy.features }}</h3>
          <ul>
            <li v-for="feature in current.features" :key="feature">
              {{ feature }}
            </li>
          </ul>
          <section class="example">
            <h3>{{ copy.everydayExample }}</h3>
            <p>{{ current.example }}</p>
          </section>
          <h3>{{ copy.effort }}</h3>
          <p>{{ current.effort }}</p>
          <h3>{{ copy.limits }}</h3>
          <p>{{ current.limits }}</p>
        </div>
        <footer>
          <SituateButton variant="plain" class="close" @click="close">{{
            copy.close
          }}</SituateButton
          ><SituateButton :disabled="busy" @click="choose">{{
            selected ? copy.remove : copy.include
          }}</SituateButton>
        </footer>
      </template>
    </SituateDialog>
  </section>
</template>
<style scoped>
.method-picker {
  min-width: 0;
  margin-block: 24px;
}
fieldset {
  min-width: 0;
  border: 0;
  margin: 0;
  padding: 0;
}
legend {
  padding: 0;
  font-weight: 650;
  font-size: 0.9375rem;
}
.help {
  color: var(--situate-muted);
  font-size: 0.875rem;
  line-height: 1.6;
  margin: 8px 0 16px;
}
.method-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.method-tile {
  display: flex;
  align-items: stretch;
  min-width: 0;
  border: 1px solid var(--situate-control-line);
  border-radius: 12px;
  background: var(--situate-surface);
}
.method-tile.selected {
  border-color: var(--situate-violet-deep);
  background: var(--situate-lilac);
}
label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  flex: 1;
  min-width: 0;
  min-height: 56px;
  cursor: pointer;
}
.method-name {
  font-size: 0.875rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}
input {
  flex: none;
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--situate-violet-deep);
}
button {
  font: inherit;
  color: var(--situate-ink);
  cursor: pointer;
}
button:disabled {
  cursor: default;
  opacity: 0.55;
}
.method-info {
  width: 44px;
  flex: none;
  border: 0;
  border-radius: 0 12px 12px 0;
  background: transparent;
}
.method-info span {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 0.8125rem;
  font-weight: 600;
}
.method-info:hover {
  background: var(--situate-paper);
}
button:focus-visible,
input:focus-visible,
.dialog-content:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.method-dialog {
  width: min(640px, calc(100% - 32px));
  max-height: min(86dvh, calc(var(--app-content-height, 100dvh) - 24px));
  box-sizing: border-box;
  margin: auto;
  padding: 0;
  border: 1px solid var(--situate-line);
  border-radius: 24px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  overflow: hidden;
}
.method-dialog[open] {
  display: flex;
  flex-direction: column;
}
.method-dialog::backdrop {
  background: rgb(30 18 46 / 42%);
}
header {
  padding: 24px 28px 16px;
  flex: none;
}
h2:focus {
  outline: none;
}
.dialog-content {
  overflow: auto;
  min-height: 0;
  padding: 0 28px 16px;
}
p {
  margin: 8px 0 20px;
}
.description {
  margin-top: 0;
}
ul {
  padding-left: 20px;
  margin: 0;
}
li {
  margin-block: 8px;
  padding-left: 4px;
}
.example {
  margin-block: 24px;
}
footer {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 28px;
  border-top: 1px solid var(--situate-line);
  background: var(--situate-surface);
}
.close {
  min-height: 44px;
  padding: 10px 18px;
  border: 1px solid var(--situate-control-line);
  border-radius: 24px;
  background: var(--situate-surface);
}
@container setup-task (min-width: 520px) {
  .method-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@container setup-task (max-width: 440px) {
  .method-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  label {
    min-height: 52px;
  }
}
@media (max-width: 500px) {
  header {
    padding: 18px 20px 12px;
  }
  .dialog-content {
    padding-inline: 20px;
  }
  footer {
    padding: 12px 20px;
  }
}
</style>
