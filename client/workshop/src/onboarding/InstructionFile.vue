<script setup lang="ts">
import { SituateButton, SituateDialog } from "../ui";
import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  ref,
  useId,
  watch,
} from "vue";
import MarkdownContent from "../editor/MarkdownContent.vue";
import copy from "../localization/en.workspace-instructions.json";
import {
  instructionMarkdown,
  instructionPath,
  type OnboardingState,
  type OnboardingAction,
} from "./model";
const props = defineProps<{ state: OnboardingState; busy: boolean }>();
const emit = defineEmits<{ action: [action: OnboardingAction] }>();
const id = useId();
const title = ref<HTMLElement>();
const openerControl = ref<InstanceType<typeof SituateButton>>();
const opener = computed(() => openerControl.value?.element);
const dialogControl = ref<InstanceType<typeof SituateDialog>>();
const dialog = computed(() => dialogControl.value?.element);
const heading = ref<HTMLElement>();
const reader = ref<HTMLElement>();
const markdown = computed(() => instructionMarkdown(props.state));
const preview = ref<HTMLElement>();
const previewContent = ref<HTMLElement>();
const overflowing = ref(false);
let observer: ResizeObserver | undefined;
function measure() {
  if (!preview.value || !previewContent.value) return;
  const next =
    previewContent.value.getBoundingClientRect().height >
    preview.value.clientHeight + 1;
  const restoreFocus =
    overflowing.value && !next && document.activeElement === opener.value;
  overflowing.value = next;
  if (restoreFocus)
    void nextTick(() => title.value?.focus({ preventScroll: true }));
}
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(measure);
    observer.observe(preview.value!);
    observer.observe(previewContent.value!);
  } else window.addEventListener("resize", measure);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", measure);
});
watch(markdown, async () => {
  await nextTick();
  measure();
});
function close() {
  emit("action", { type: "instructions-view", open: false });
}
function keyboard(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const elements = [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [tabindex="0"]',
    ) ?? []),
  ].filter((element) => element.getClientRects().length);
  const index = elements.indexOf(document.activeElement as HTMLElement);
  const next =
    index < 0
      ? event.shiftKey
        ? elements.length - 1
        : 0
      : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
  (elements[next] ?? heading.value)?.focus();
}
watch(
  () => props.state.instructionsOpen,
  async (open) => {
    await nextTick();
    if (open) {
      if (!dialog.value?.open) dialog.value?.showModal();
      if (reader.value) reader.value.scrollTop = 0;
      heading.value?.focus({ preventScroll: true });
    } else if (dialog.value?.open) {
      dialog.value.close();
      (opener.value ?? title.value)?.focus({ preventScroll: true });
    }
  },
  { immediate: true },
);
defineExpose({ focus: () => title.value?.focus() });
</script>
<template>
  <section class="proposal" :aria-busy="busy">
    <header class="file-header">
      <h2 ref="title" tabindex="-1">{{ copy.filename }}</h2>
      <span class="draft">{{ copy.draft }}</span>
    </header>
    <p class="location">
      <span>{{ copy.location }}</span
      ><code>{{ instructionPath(state) }}</code>
    </p>
    <section
      ref="preview"
      class="instruction-preview"
      :class="{ overflowing }"
      :aria-label="copy.preview"
    >
      <div ref="previewContent" class="preview-content">
        <MarkdownContent
          :content="markdown"
          readonly
          :readonly-description="copy.readOnly"
        />
      </div>
    </section>
    <p v-if="overflowing" class="overflow-hint">{{ copy.more }}</p>
    <SituateButton
      variant="plain"
      v-if="overflowing"
      ref="openerControl"
      class="open-file"
      :disabled="busy"
      aria-haspopup="dialog"
      @click="emit('action', { type: 'instructions-view', open: true })"
    >
      {{ copy.open }} <span aria-hidden="true">→</span>
    </SituateButton>
    <SituateDialog
      ref="dialogControl"
      class="instruction-dialog"
      :aria-labelledby="`${id}-title`"
      @cancel.prevent="close"
      @keydown="keyboard"
    >
      <template v-if="state.instructionsOpen">
        <header class="reader-header">
          <h2 ref="heading" :id="`${id}-title`" tabindex="-1" data-dialog-title>
            {{ copy.viewer }}
          </h2>
          <p class="draft" data-dialog-help>{{ copy.draft }}</p>
          <code class="reader-path">{{ instructionPath(state) }}</code>
        </header>
        <div
          ref="reader"
          class="file-reader"
          data-dialog-document
          tabindex="0"
          :aria-label="copy.filename"
        >
          <MarkdownContent
            :content="markdown"
            readonly
            :readonly-description="copy.readOnly"
          />
        </div>
        <footer>
          <SituateButton variant="plain" class="close-file" @click="close">{{
            copy.close
          }}</SituateButton>
        </footer>
      </template>
    </SituateDialog>
  </section>
</template>
<style scoped>
.proposal {
  min-width: 0;
  border: 1px solid var(--situate-line);
  border-radius: 16px;
  background: var(--situate-paper);
  margin-block: 20px;
  overflow: hidden;
}
.file-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 20px 0;
}
h2 {
  font-size: 1rem;
  margin: 0;
}
h2:focus {
  outline: none;
}
.draft {
  font-size: 0.8125rem;
  color: var(--situate-muted);
}
.location {
  display: grid;
  gap: 4px;
  margin: 12px 20px;
  font-size: 0.8125rem;
  line-height: 1.5;
}
.location span {
  color: var(--situate-muted);
}
code {
  overflow-wrap: anywhere;
}
.instruction-preview {
  position: relative;
  max-height: 200px;
  overflow: clip;
  margin: 12px 20px;
  border-left: 3px solid var(--situate-tangerine);
}
.preview-content {
  display: flow-root;
}
.instruction-preview.overflowing::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 40px;
  background: linear-gradient(transparent, var(--situate-paper));
  pointer-events: none;
}
.overflow-hint {
  margin: 0 20px 12px;
  color: var(--situate-muted);
  font-size: 0.8125rem;
}
@media (forced-colors: active) {
  .instruction-preview.overflowing::after {
    display: none;
  }
  .instruction-preview.overflowing {
    border-bottom: 1px dashed CanvasText;
  }
}
.instruction-preview :deep(.markdown) {
  padding: 0 0 0 16px;
  font-size: 0.875rem;
  line-height: 1.6;
}
.instruction-preview :deep(h1) {
  font-size: 1.125rem;
  margin-top: 0;
}
.instruction-preview :deep(h2) {
  font-size: 0.875rem;
}
.instruction-preview :deep(ul) {
  margin-bottom: 0;
  padding-left: 18px;
}
button {
  font: inherit;
  cursor: pointer;
  color: var(--situate-ink);
  min-height: 44px;
}
button:disabled {
  cursor: default;
  opacity: 0.55;
}
.open-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 14px 20px;
  background: var(--situate-surface);
  border: 0;
  border-top: 1px solid var(--situate-line);
  font-size: 0.875rem;
  font-weight: 600;
}
button:focus-visible,
.file-reader:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.instruction-dialog {
  width: min(820px, calc(100% - 32px));
  max-height: min(88dvh, calc(var(--app-content-height, 100dvh) - 24px));
  box-sizing: border-box;
  margin: auto;
  padding: 0;
  border: 1px solid var(--situate-line);
  border-radius: 20px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  overflow: hidden;
}
.instruction-dialog[open] {
  display: flex;
  flex-direction: column;
}
.instruction-dialog::backdrop {
  background: rgb(30 18 46 / 42%);
}
.reader-header {
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--situate-line);
  flex: none;
}
.reader-header p {
  margin: 8px 0;
}
.reader-path {
  display: block;
  font-size: 0.8125rem;
  line-height: 1.5;
  max-height: 3em;
  overflow: auto;
}
.file-reader {
  min-height: 0;
  overflow: auto;
}
.file-reader :deep(.markdown) {
  padding: 20px 24px;
}
footer {
  padding: 12px 24px;
  border-top: 1px solid var(--situate-line);
  flex: none;
}
.close-file {
  background: var(--situate-surface);
  border: 1px solid var(--situate-control-line);
  border-radius: 24px;
  padding: 10px 18px;
}
@media (max-width: 500px) {
  .file-reader :deep(.markdown) {
    padding: 16px;
  }
  .reader-header {
    padding: 16px;
  }
  footer {
    padding: 12px 16px;
  }
}
@media (max-height: 450px) {
  .reader-header {
    padding: 10px 16px;
  }
  .reader-header .draft {
    display: none;
  }
  .reader-path {
    margin-top: 4px;
  }
  footer {
    padding: 8px 16px;
  }
}
</style>
