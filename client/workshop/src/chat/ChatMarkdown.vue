<script setup lang="ts">
import MarkdownRender, { setCustomComponents } from "markstream-vue";
import type { NodeRendererProps, PreCodeNodeProps } from "markstream-vue";
import { h } from "vue";
import "markstream-vue/index.css";

defineProps<{ content: string; final: boolean; eager?: boolean }>();
setCustomComponents("workshop-transcript", {
  code_block: (props: PreCodeNodeProps) => h("pre", h("code", props.node.code)),
});
const configureMarkdown: NodeRendererProps["customMarkdownIt"] = (md) =>
  md.disable("image");
</script>

<template>
  <MarkdownRender
    class="transcript-markdown"
    mode="chat"
    custom-id="workshop-transcript"
    :content="content"
    :final="final"
    v-bind="
      eager
        ? {
            deferNodesUntilVisible: false,
            nodeVirtual: false,
            batchRendering: false,
            viewportPriority: false,
          }
        : {}
    "
    html-policy="escape"
    :custom-markdown-it="configureMarkdown"
    :fade="false"
    :typewriter="false"
    :smooth-streaming="false"
  />
</template>

<style scoped>
.transcript-markdown {
  --ms-text-body: 1em;
  --ms-leading-body: 1.7;
  min-width: 0;
  color: inherit;
  font: inherit;
  overflow-wrap: anywhere;
}
.transcript-markdown :deep(p) {
  margin: 0 0 10px;
  white-space: normal;
}
.transcript-markdown :deep(h1),
.transcript-markdown :deep(h2),
.transcript-markdown :deep(h3),
.transcript-markdown :deep(h4),
.transcript-markdown :deep(h5),
.transcript-markdown :deep(h6) {
  font: inherit;
  font-weight: 650;
  margin: 18px 0 8px;
}
.transcript-markdown :deep(ul),
.transcript-markdown :deep(ol) {
  margin: 8px 0 12px;
  padding-inline-start: 22px;
}
.transcript-markdown :deep(li) {
  margin-block: 4px;
}
.transcript-markdown :deep(blockquote) {
  margin: 12px 0;
  padding-inline-start: 14px;
  border-inline-start: 2px solid var(--situate-line);
  color: inherit;
}
.transcript-markdown :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  white-space: pre;
  background: var(--situate-paper);
  padding: 12px;
  border: 1px solid var(--situate-line);
  border-radius: 8px;
}
.transcript-markdown :deep(code) {
  font-family: var(--situate-font-mono, monospace);
  font-size: 0.92em;
}
.transcript-markdown :deep(a) {
  color: var(--situate-cobalt);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.transcript-markdown :deep(a:focus-visible) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.transcript-markdown :deep(> :first-child) {
  margin-block-start: 0;
}
.transcript-markdown :deep(> :last-child) {
  margin-block-end: 0;
}
</style>
