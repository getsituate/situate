<script lang="ts">
import { defineComponent, h, onBeforeUnmount, type VNodeChild } from "vue";
import { markdownBlocks, type MarkdownBlock } from "./markdown";

export default defineComponent({
  props: {
    content: { type: String, required: true },
    readonly: Boolean,
    readonlyDescription: String,
  },
  emits: { edit: (_offset: number) => true },
  setup(props, { emit }) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null,
      moved = false;
    const cancel = () => clearTimeout(timer);
    onBeforeUnmount(cancel);
    const inline = (text: string): VNodeChild[] =>
      text
        .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
        .map((part) =>
          part.startsWith("**") && part.endsWith("**")
            ? h("strong", part.slice(2, -2))
            : part.startsWith("`") && part.endsWith("`")
              ? h("code", part.slice(1, -1))
              : part,
        );
    const renderBlock = (block: MarkdownBlock): VNodeChild =>
      h(
        block.tag,
        {
          "data-source-offset": block.offset,
          class: block.checked !== undefined ? "checkbox-line" : undefined,
        },
        block.children
          ? block.children.map(renderBlock)
          : block.tag === "hr"
            ? undefined
            : block.tag === "pre"
              ? block.text
              : [
                  block.checked === undefined
                    ? null
                    : h(
                        "span",
                        {
                          class: "checkbox-mark",
                          "aria-label": block.checked
                            ? "Checked: "
                            : "Unchecked: ",
                        },
                        block.checked ? "☑" : "☐",
                      ),
                  ...inline(block.text),
                ],
      );
    return () =>
      h(
        "article",
        {
          class: "markdown",
          "aria-label": "Rendered Markdown",
          tabindex: props.readonly ? -1 : 0,
          "aria-description": props.readonly
            ? (props.readonlyDescription ?? "Earlier version. Read only.")
            : "Click text or press Enter to edit its Markdown source.",
          onPointerdown: (event: PointerEvent) => {
            cancel();
            start = { x: event.clientX, y: event.clientY };
            moved = false;
          },
          onPointermove: (event: PointerEvent) => {
            if (
              start &&
              Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
            )
              moved = true;
          },
          onPointercancel: () => {
            cancel();
            start = null;
            moved = true;
          },
          onDblclick: cancel,
          onClick: (event: MouseEvent) => {
            cancel();
            start = null;
            if (
              props.readonly ||
              moved ||
              event.detail > 1 ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey ||
              window.getSelection()?.isCollapsed === false
            )
              return;
            const block = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-source-offset]",
            );
            if (!block) return;
            const content = props.content;
            timer = setTimeout(() => {
              if (
                !props.readonly &&
                props.content === content &&
                window.getSelection()?.isCollapsed !== false
              )
                emit("edit", Number(block.dataset.sourceOffset));
            }, 300);
          },
          onKeydown: (event: KeyboardEvent) => {
            if (
              event.key === "Enter" &&
              !props.readonly &&
              event.target === event.currentTarget
            ) {
              event.preventDefault();
              emit("edit", markdownBlocks(props.content)[0].offset);
            }
          },
        },
        markdownBlocks(props.content).map(renderBlock),
      );
  },
});
</script>

<style scoped>
.markdown {
  max-width: 760px;
  margin-inline: auto;
  padding: 24px 32px 40px;
  font-size: 15px;
  line-height: 1.85;
  overflow-wrap: anywhere;
}
.markdown:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: -6px;
}
.markdown :deep(h1) {
  font-family: var(--situate-font-display);
  font-size: clamp(27px, 2.6vw, 36px);
  line-height: 1.16;
  font-weight: 600;
  letter-spacing: -0.045em;
  margin: 0 0 24px;
}
.markdown :deep(h2) {
  font-size: 17px;
  margin: 30px 0 12px;
  font-weight: 600;
}
.markdown :deep(h3) {
  font-size: 15px;
  margin: 24px 0 10px;
}
.markdown :deep(p) {
  margin: 14px 0;
}
.markdown :deep(ul),
.markdown :deep(ol) {
  padding-left: 24px;
  margin: 12px 0 20px;
}
.markdown :deep(li) {
  padding-left: 4px;
  margin-block: 8px;
}
.markdown :deep(li::marker) {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.markdown :deep(blockquote) {
  border-left: 2px solid var(--situate-accent, var(--situate-violet));
  margin: 26px 0;
  padding: 4px 0 4px 20px;
  color: var(--situate-muted);
  font-style: italic;
}
.markdown :deep(pre) {
  white-space: pre-wrap;
  padding: 18px;
  border-radius: 8px;
  background: var(--situate-paper);
  font: 13px/1.7 var(--situate-font-mono);
}
.markdown :deep(code) {
  font: 0.9em var(--situate-font-mono);
  background: var(--situate-paper);
}
.markdown :deep(hr) {
  border: 0;
  border-top: 1px solid var(--situate-line);
}
.markdown :deep(.checkbox-line) {
  list-style: none;
  margin-left: -22px;
}
.markdown :deep(.checkbox-mark) {
  display: inline-block;
  width: 24px;
  color: var(--situate-muted);
}
@container (max-width: 560px) {
  .markdown {
    padding: 24px;
  }
}
</style>
