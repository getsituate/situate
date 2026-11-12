<script setup lang="ts">
import { SituateDialog, SituateButton } from "../ui";
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import ImportCollection from "./ImportCollection.vue";
import { fileCount } from "./import-browser";
import MarkdownContent from "../editor/MarkdownContent.vue";
import type { EditorFile } from "../editor/model";
import copy from "../localization/en.import-result.json";
const props = defineProps<{
  files: EditorFile[];
  selected: string | null;
  workspacePath: string;
}>();
const emit = defineEmits<{ select: [key: string | null] }>();
const id = useId();
const root = ref<HTMLElement>();
const title = ref<HTMLElement>();
const dialogControl = ref<InstanceType<typeof SituateDialog>>();
const dialog = computed(() => dialogControl.value?.element);
const heading = ref<HTMLElement>();
const reader = ref<HTMLElement>();
let opener: HTMLElement | null = null;
const current = computed(() =>
  props.files.find((file) => file.key === props.selected && !file.deleted),
);
const path = computed(() => {
  const file = current.value;
  if (!file) return "";
  const separator = props.workspacePath.includes("\\") ? "\\" : "/";
  const relative = [file.folder, file.name].filter(Boolean).join("/");
  return `${props.workspacePath.replace(/[\\/]+$/, "")}${separator}${relative.replaceAll("/", separator)}`;
});
function close() {
  emit("select", null);
}
function keyboard(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const elements = [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], [tabindex="0"]',
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
  () => current.value?.key,
  async (key) => {
    if (key && !dialog.value?.open) {
      const active = document.activeElement;
      opener =
        active instanceof HTMLElement && root.value?.contains(active)
          ? active
          : null;
    }
    await nextTick();
    if (key !== current.value?.key) return;
    if (key) {
      if (!dialog.value?.open) dialog.value?.showModal();
      if (reader.value) reader.value.scrollTop = 0;
      heading.value?.focus({ preventScroll: true });
    } else if (dialog.value?.open) {
      dialog.value.close();
      (opener?.isConnected ? opener : title.value)?.focus({
        preventScroll: true,
      });
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <section ref="root" class="imported-files" :aria-labelledby="`${id}-files`">
    <div class="collection-heading">
      <h2 ref="title" :id="`${id}-files`" tabindex="-1">{{ copy.files }}</h2>
      <span class="collection-count">{{
        fileCount(files.filter((file) => !file.deleted).length)
      }}</span>
    </div>
    <ImportCollection
      :files="files"
      :selected="selected"
      @select="emit('select', $event)"
    />
    <SituateDialog
      ref="dialogControl"
      class="imported-file-dialog"
      :aria-labelledby="`${id}-name`"
      @cancel.prevent="close"
      @keydown="keyboard"
    >
      <template v-if="current">
        <header>
          <div class="reader-title">
            <h2
              ref="heading"
              :id="`${id}-name`"
              tabindex="-1"
              data-dialog-title
            >
              {{ current.name }}
            </h2>
            <span data-dialog-help>{{ copy.readOnly }}</span>
            <SituateButton variant="plain" @click="close">{{
              copy.closeFile
            }}</SituateButton>
          </div>
          <p class="imported-file-path" tabindex="0">{{ path }}</p>
        </header>
        <section
          ref="reader"
          class="imported-file-content"
          data-dialog-document
          tabindex="0"
          :aria-label="current.name"
        >
          <MarkdownContent
            :content="current.content"
            readonly
            :readonly-description="copy.readOnly"
          />
        </section>
      </template>
    </SituateDialog>
  </section>
</template>
<style scoped>
.imported-files {
  min-width: 0;
  border: 1px solid var(--situate-line);
  border-radius: 18px;
  background: var(--situate-paper);
  padding: 16px;
}
h2 {
  margin: 0;
  font-size: 1.125rem;
}
h2:focus {
  outline: none;
}
.collection-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 16px;
}
.collection-count {
  color: var(--situate-muted);
  font-size: 13px;
}
.imported-file-dialog {
  box-sizing: border-box;
  width: min(1040px, calc(100% - 48px));
  height: min(900px, calc(var(--app-content-height, 100dvh) - 48px));
  max-width: 100%;
  max-height: var(--app-content-height, 100dvh);
  padding: 0;
  margin: auto;
  overflow: hidden;
  border: 1px solid var(--situate-line);
  border-radius: 20px;
  background: var(--situate-surface);
  color: var(--situate-ink);
}
.imported-file-dialog[open] {
  display: flex;
  flex-direction: column;
}
.imported-file-dialog::backdrop {
  background: rgb(30 18 46 / 42%);
}
header {
  flex: none;
  padding: 16px 24px;
  border-bottom: 1px solid var(--situate-line);
}
.reader-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.reader-title h2 {
  overflow-wrap: anywhere;
  min-width: 0;
}
.reader-title span {
  color: var(--situate-muted);
  font-size: 13px;
}
button {
  margin-left: auto;
  min-height: 44px;
  padding: 10px 16px;
  font: inherit;
  cursor: pointer;
  color: var(--situate-ink);
  background: var(--situate-surface);
  border: 1px solid var(--situate-control-line);
  border-radius: 24px;
}
.imported-file-path {
  font-size: 13px;
  color: var(--situate-muted);
  overflow-wrap: anywhere;
  line-height: 1.5;
  max-height: 3em;
  overflow: auto;
  margin: 8px 0 0;
}
.imported-file-content {
  min-height: 0;
  overflow: auto;
  flex: 1;
}
.imported-file-content :deep(.markdown) {
  max-width: 820px;
  margin: auto;
  padding: 28px 32px;
}
button:focus-visible,
.imported-file-path:focus-visible,
.imported-file-content:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
@media (max-width: 600px), (max-height: 450px) {
  .imported-file-dialog {
    --dialog-block-inset: 0px;
    width: 100%;
    height: var(--app-content-height, 100dvh);
    border: 0;
    border-radius: 0;
  }
  header {
    padding: 10px 16px;
  }
  .reader-title span {
    display: none;
  }
  .imported-file-content :deep(.markdown) {
    padding: 20px 16px;
  }
}
</style>
