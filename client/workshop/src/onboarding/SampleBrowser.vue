<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import FileTree from "../editor/FileTree.vue";
import MarkdownContent from "../editor/MarkdownContent.vue";
import { createEditorState, type EditorFile } from "../editor/model";
import { f } from "./flow-content";
import copy from "../localization/en.import-result.json";
const props = defineProps<{
  files: EditorFile[];
  selected: string;
  approved?: boolean;
  imported?: boolean;
  workspacePath?: string;
}>();
const emit = defineEmits<{ select: [key: string] }>();
const title = computed(() =>
  props.imported
    ? copy.files
    : props.approved
      ? f.approvedPreview
      : f.previewTitle,
);
const detail = computed(() =>
  props.imported ? copy.fileDetail : f.previewDetail,
);
const path = computed(() => {
  if (!current.value) return "";
  const relative = `${current.value.folder}/${current.value.name}`;
  if (!props.workspacePath) return relative;
  const separator = props.workspacePath.includes("\\") ? "\\" : "/";
  return `${props.workspacePath.replace(/[\\/]$/, "")}${separator}${relative.replaceAll("/", separator)}`;
});
const collapsed = ref<string[]>([]);
const reader = ref<HTMLElement>();
const state = computed(() => {
  const state = createEditorState("empty");
  state.files = props.files;
  state.folders = [
    ...new Set(
      props.files.flatMap((file) =>
        file.folder
          .split("/")
          .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
      ),
    ),
  ];
  state.expanded = state.folders.filter(
    (folder) => !collapsed.value.includes(folder),
  );
  state.currentKey =
    props.files.find((file) => file.key === props.selected)?.key ??
    props.files[0]?.key ??
    null;
  return state;
});
const current = computed(() =>
  props.files.find((file) => file.key === state.value.currentKey),
);
watch(
  () => props.selected,
  async () => {
    await nextTick();
    reader.value?.focus({ preventScroll: true });
    reader.value?.scrollIntoView?.({ block: "nearest" });
  },
);
</script>
<template>
  <aside class="sample-browser" :aria-label="title">
    <h2>{{ title }}</h2>
    <p>{{ detail }}</p>
    <div class="browser-panes">
      <FileTree
        :state="state"
        readonly
        @select="emit('select', $event)"
        @toggle="
          collapsed = collapsed.includes($event)
            ? collapsed.filter((path) => path !== $event)
            : [...collapsed, $event]
        "
      />
      <section
        ref="reader"
        class="sample-reader"
        tabindex="-1"
        :aria-label="f.reader"
      >
        <p v-if="current" class="sample-path" aria-live="polite">
          {{ path }}
        </p>
        <MarkdownContent
          v-if="current"
          :content="current.content"
          readonly
          :readonly-description="detail"
        />
      </section>
    </div>
  </aside>
</template>
<style scoped>
.sample-browser {
  container: sample-preview / inline-size;
  min-width: 0;
  border: 1px solid var(--situate-line);
  border-radius: 18px;
  padding: 18px;
  background: var(--situate-paper);
}
h2 {
  margin: 0 0 8px;
  font-size: 1.125rem;
}
p {
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--situate-muted);
}
.browser-panes {
  display: grid;
  grid-template-columns: minmax(140px, 0.75fr) minmax(0, 1.25fr);
  gap: 12px;
}
.sample-reader {
  min-width: 0;
  max-height: 480px;
  overflow: auto;
  padding: 12px;
  background: var(--situate-surface);
  border-radius: 10px;
}
.sample-path {
  overflow-wrap: anywhere;
  font-size: 0.75rem;
}
.sample-reader:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
}
.sample-reader :deep(.markdown) {
  padding: 0;
  font-size: 0.875rem;
}
@container sample-preview (max-width: 420px) {
  .browser-panes {
    grid-template-columns: minmax(0, 1fr);
  }
  .browser-panes :deep(.file-tree) {
    max-height: 180px;
    padding-bottom: 8px;
  }
}
@media (max-width: 600px) {
  .browser-panes {
    grid-template-columns: minmax(0, 1fr);
  }
  .browser-panes :deep(.file-tree) {
    max-height: 180px;
    padding-bottom: 8px;
  }
}
</style>
