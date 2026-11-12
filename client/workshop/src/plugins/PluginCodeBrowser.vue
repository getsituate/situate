<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import { SituateIcon, SituateButton, SituateInput } from "../ui";
import MarkdownContent from "../editor/MarkdownContent.vue";
import PluginFilesHeader from "./PluginFilesHeader.vue";
import { c } from "./content";
import { codeRows, type CodeBrowserState, type CodeFile } from "./code-browser";
const props = defineProps<{
  state: CodeBrowserState;
  files: CodeFile[];
  folders?: string[];
  sidebar?: boolean;
}>();
const emit = defineEmits<{ "update:state": [state: CodeBrowserState] }>();
const id = useId();
const title = ref<HTMLElement>();
const filter = ref<InstanceType<typeof SituateInput>>();
const documentPane = ref<HTMLElement>();
const rows = computed(() => codeRows(props.files, props.state, props.folders));
const file = computed(() =>
  props.files.find((file) => file.path === props.state.selected),
);
const image = computed(() =>
  file.value?.kind === "image"
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.value.text ?? "")}`
    : "",
);
function update(patch: Partial<CodeBrowserState>) {
  emit("update:state", { ...props.state, ...patch });
}
async function select(path: string) {
  update({ selected: path, pane: "file" });
  await nextTick();
  if (documentPane.value) documentPane.value.scrollTop = 0;
  title.value?.focus();
}
function toggle(path: string) {
  update({
    expanded: props.state.expanded.includes(path)
      ? props.state.expanded.filter((p) => p !== path)
      : [...props.state.expanded, path],
  });
}
async function showTree() {
  update({ pane: "tree" });
  await nextTick();
  filter.value?.element?.focus();
}
defineExpose({ showTree });
</script>
<template>
  <section
    class="plugin-code-browser"
    :class="{ 'code-sidebar': sidebar }"
    :aria-label="c.files"
  >
    <PluginFilesHeader
      v-if="!sidebar"
      class="code-navigation-header"
      :back="state.status === 'ready' && state.pane === 'file'"
      @back="showTree"
    />
    <div v-if="state.status !== 'ready'" class="code-feedback">
      <p v-if="state.status === 'loading'" role="status">
        {{ c.loadingFiles }}
      </p>
      <template v-else-if="state.status === 'error'">
        <p role="alert">{{ c.filesError }}</p>
        <SituateButton
          variant="secondary"
          size="small"
          @click="update({ status: 'loading' })"
        >
          {{ c.retryFiles }}
        </SituateButton>
      </template>
      <p v-else>{{ c.noCodeFiles }}</p>
    </div>
    <div
      v-else
      class="code-layout"
      :class="{ 'code-show-tree': state.pane === 'tree' }"
    >
      <aside
        class="code-tree-pane"
        :aria-label="c.codeFolder"
        @focusin="state.pane !== 'tree' && update({ pane: 'tree' })"
      >
        <header v-if="!sidebar || file" class="code-tree-header">
          <strong v-if="!sidebar">{{ c.codeFolder }}</strong>
          <SituateButton
            variant="plain"
            v-if="file"
            class="code-mobile-button"
            @click="select(state.selected)"
          >
            {{ c.backToFile }}
          </SituateButton>
        </header>
        <SituateInput
          appearance="plain"
          ref="filter"
          class="code-filter"
          type="search"
          :aria-label="c.filterFiles"
          :placeholder="c.fileFilter"
          :value="state.query"
          @input="update({ query: ($event.target as HTMLInputElement).value })"
        />
        <nav class="code-tree" :aria-label="c.fileTree">
          <SituateButton
            variant="plain"
            v-for="row in rows"
            :key="row.path"
            class="code-entry"
            :style="{ paddingInlineStart: `${8 + row.depth * 12}px` }"
            :aria-expanded="row.folder ? row.expanded : undefined"
            :aria-current="
              !row.folder && row.path === state.selected ? 'true' : undefined
            "
            :title="row.path"
            @click="row.folder ? toggle(row.path) : select(row.path)"
          >
            <span
              v-if="row.folder"
              class="code-chevron"
              :class="{ expanded: row.expanded }"
              aria-hidden="true"
              >›</span
            >
            <SituateIcon :name="row.folder ? 'folder' : 'notes'" /><span>{{
              row.name
            }}</span>
          </SituateButton>
          <div v-if="!rows.length" class="code-empty">
            <p>{{ state.query ? c.noMatchingFiles : c.noCodeFiles }}</p>
            <SituateButton
              variant="ghost"
              size="small"
              v-if="state.query"
              class="plugin-text"
              @click="update({ query: '' })"
            >
              {{ c.clearFileFilter }}
            </SituateButton>
          </div>
        </nav>
      </aside>
      <section
        class="code-document"
        :aria-label="c.fileContent"
        @focusin="state.pane !== 'file' && update({ pane: 'file' })"
      >
        <header class="code-document-header">
          <div class="code-location">
            <p v-if="file?.path.includes('/')">
              {{ file.path.split("/").slice(0, -1).join(" / ") }}
            </p>
            <h3 ref="title" tabindex="-1">
              {{ file?.path.split("/").at(-1) || c.files }}
            </h3>
          </div>
          <div
            v-if="file && (file.kind === 'markdown' || file.kind === 'image')"
            class="code-mode"
            role="group"
            :aria-label="c.fileMode"
          >
            <SituateButton
              variant="plain"
              :aria-pressed="state.mode === 'preview'"
              @click="update({ mode: 'preview' })"
            >
              {{ c.preview }}</SituateButton
            ><SituateButton
              variant="plain"
              :aria-pressed="state.mode === 'source'"
              @click="update({ mode: 'source' })"
            >
              {{ c.source }}
            </SituateButton>
          </div>
        </header>
        <div
          ref="documentPane"
          class="code-document-scroll"
          tabindex="0"
          :aria-label="c.fileContent"
          :id="id"
        >
          <p v-if="!file" class="code-empty">{{ c.chooseFile }}</p>
          <template v-else-if="file.kind === 'binary'"
            ><div class="code-empty">
              <h4>{{ c.binaryFile }}</h4>
              <p>{{ file.path }}</p>
              <p>{{ c.noFilePreview }}</p>
            </div></template
          >
          <MarkdownContent
            v-else-if="file.kind === 'markdown' && state.mode === 'preview'"
            :content="file.text ?? ''"
            readonly
            :aria-description="c.readOnly"
          />
          <img
            v-else-if="file.kind === 'image' && state.mode === 'preview'"
            class="code-image"
            :src="image"
            :alt="file.path"
          />
          <pre v-else class="code-source" :aria-label="c.fileSource">{{
            file.text
          }}</pre>
        </div>
      </section>
    </div>
  </section>
</template>
<style scoped>
.plugin-code-browser {
  container: plugin-code / inline-size;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--situate-surface);
  overflow: hidden;
  min-width: 0;
}
.code-navigation-header {
  display: none;
}
.code-layout {
  display: grid;
  grid-template-columns: 228px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.code-tree-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: color-mix(
    in srgb,
    var(--situate-paper) 45%,
    var(--situate-surface)
  );
  border-right: 1px solid var(--situate-line);
}
.code-tree-header {
  padding: 6px 16px;
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--situate-muted);
}
.code-filter {
  min-width: 0;
  min-height: 44px;
  margin: 0 16px 16px;
  padding: 10px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-small);
  background: transparent;
  font: inherit;
  font-size: 13px;
}
.code-sidebar .code-filter {
  margin-top: 16px;
  font-size: 16px;
}
.code-sidebar .code-layout {
  grid-template-columns: minmax(0, 1fr);
}
.code-sidebar .code-tree-pane {
  display: none;
  border: 0;
}
.code-sidebar .code-show-tree .code-tree-pane {
  display: flex;
}
.code-sidebar .code-show-tree .code-document {
  display: none;
}
.code-sidebar .code-mobile-button {
  display: block;
}
.code-tree {
  overflow: auto;
  flex: 1;
  min-height: 0;
  padding: 0 10px 24px;
}
.code-entry {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 44px;
  padding: 8px;
  margin-block: 2px;
  border: 0;
  border-radius: var(--situate-radius-small);
  background: transparent;
  color: var(--situate-muted);
  text-align: start;
  font: inherit;
  font-size: 13px;
}
.code-entry svg {
  flex-shrink: 0;
  width: 17px;
  height: 17px;
}
.code-entry > span:last-child {
  overflow-wrap: anywhere;
  min-width: 0;
}
.code-entry[aria-expanded] {
  color: var(--situate-ink);
}
.code-entry:hover,
.code-entry[aria-current] {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.code-entry[aria-current] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 600;
}
.code-chevron {
  width: 10px;
  font-size: 18px;
  flex-shrink: 0;
}
.code-chevron.expanded {
  transform: rotate(90deg);
}
.code-document {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.code-document-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  min-height: 56px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--situate-line);
}
.code-location {
  min-width: 0;
  flex: 1;
}
.code-location p {
  margin: 0;
  font-size: 11px;
  color: var(--situate-muted);
}
.code-location h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.code-mode {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.code-mode button,
.code-mobile-button {
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  padding: 8px 12px;
  font: inherit;
  font-size: 13px;
  color: var(--situate-muted);
}
.code-mode [aria-pressed="true"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-ink);
  font-weight: 600;
}
.code-mobile-button {
  display: none;
}
.code-document-scroll {
  overflow: auto;
  min-height: 0;
  flex: 1;
}
.plugin-code-browser .code-source {
  font: 13px/1.7 var(--situate-font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  padding: 24px;
}
.code-image {
  display: block;
  max-width: calc(100% - 48px);
  margin: 24px auto;
}
.code-feedback,
.code-empty {
  padding: 24px;
  font-size: 14px;
  color: var(--situate-muted);
}
:is(button, input, [tabindex]):focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
@container plugin-code (max-width: 640px) {
  .code-navigation-header {
    display: flex;
  }
  .code-tree-header > strong {
    display: none;
  }
  .code-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .code-tree-pane {
    display: none;
    border: 0;
  }
  .code-show-tree .code-tree-pane {
    display: flex;
  }
  .code-show-tree .code-document {
    display: none;
  }
  .code-mobile-button {
    display: block;
  }
  .code-filter {
    font-size: 16px;
  }
}
</style>
