<script setup lang="ts">
import MarkdownRender, { LinkNode, setCustomComponents } from "markstream-vue";
import type {
  LinkNodeProps,
  NodeRendererProps,
  PreCodeNodeProps,
} from "markstream-vue";
import { h } from "vue";
import "markstream-vue/index.css";

defineProps<{ content: string; final: boolean; eager?: boolean }>();

setCustomComponents("situate-chat", {
  code_block: (props: PreCodeNodeProps) => h("pre", h("code", props.node.code)),
  link: (props: LinkNodeProps) =>
    h(LinkNode, { ...props, "aria-label": props.node.text }),
});

const configureMarkdown: NodeRendererProps["customMarkdownIt"] = (md) =>
  md.disable("image");
</script>

<template>
  <MarkdownRender
    class="chat-markdown"
    data-localization-content="external"
    mode="chat"
    custom-id="situate-chat"
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
.chat-markdown {
  color: inherit;
  font: inherit;
  overflow-wrap: anywhere;
}
.chat-markdown :deep(p) {
  white-space: normal;
}
.chat-markdown :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  padding: 12px;
  border: 1px solid var(--situate-line);
  border-radius: 8px;
  background: var(--situate-paper);
  white-space: pre;
}
.chat-markdown :deep(code) {
  font-family: var(--situate-font-mono, monospace);
}
.chat-markdown :deep(a) {
  color: var(--situate-cobalt);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.chat-markdown
  :deep(a:focus:where(html:not([data-input-modality="pointer"]) *)) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
</style>
