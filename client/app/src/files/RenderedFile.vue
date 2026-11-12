<script setup lang="ts">
import { localizeError } from "@situate/localization";
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import { request, type WorkspaceSession } from "./sessions";
import type { FileDocument } from "./api";
const props = defineProps<{
  session: WorkspaceSession;
  path: string;
  text: string;
  document: FileDocument | null;
  historical?: boolean;
  editable?: boolean;
}>();
const emit = defineEmits<{
  navigate: [path: string];
  editSource: [offset: number];
}>();
const html = ref("");
const renderedSource = ref<string | null>(null);
const content = useTemplateRef<HTMLElement>("content");
const error = ref<unknown>("");
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const allowed = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "BR",
  "HR",
  "EM",
  "STRONG",
  "DEL",
  "S",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "A",
  "IMG",
  "PRE",
  "CODE",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TH",
  "TD",
  "INPUT",
  "DIV",
  "SPAN",
]);
const sourceBlocks = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "PRE",
  "LI",
  "BLOCKQUOTE",
]);
function validOffset(value: string | null): number | null {
  if (value === null || !/^(0|[1-9]\d*)$/u.test(value)) return null;
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset >= props.text.length) return null;
  const unit = props.text.charCodeAt(offset);
  if (unit >= 0xdc00 && unit <= 0xdfff && offset > 0) {
    const previous = props.text.charCodeAt(offset - 1);
    if (previous >= 0xd800 && previous <= 0xdbff) return null;
  }
  return offset;
}
function passiveHtml(value: string): string {
  const parsed = new DOMParser().parseFromString(value, "text/html");
  for (const element of Array.from(parsed.body.querySelectorAll("*"))) {
    if (!allowed.has(element.tagName)) {
      element.replaceWith(parsed.createTextNode(element.textContent ?? ""));
      continue;
    }
    const offset = sourceBlocks.has(element.tagName)
      ? validOffset(element.getAttribute("data-source-offset"))
      : null;
    const anchor =
      element.getAttribute("id") ??
      (/^H[1-6]$/u.test(element.tagName)
        ? (element.textContent ?? "")
            .toLocaleLowerCase()
            .trim()
            .replace(/[^\p{L}\p{N}\s_-]/gu, "")
            .replace(/\s+/gu, "-")
        : "");
    for (const attribute of Array.from(element.attributes)) {
      if (
        ![
          "href",
          "src",
          "alt",
          "title",
          "checked",
          "colspan",
          "rowspan",
          "start",
        ].includes(attribute.name)
      )
        element.removeAttribute(attribute.name);
    }
    if (offset !== null)
      element.setAttribute("data-source-offset", String(offset));
    if (anchor) element.setAttribute("data-file-anchor", anchor);
    if (element.tagName === "INPUT") {
      element.setAttribute("type", "checkbox");
      element.setAttribute("disabled", "");
    }
    if (element.tagName === "A") {
      element.setAttribute(
        "data-file-href",
        element.getAttribute("href") ?? "",
      );
      element.setAttribute("href", "#");
    }
    if (
      element.tagName === "IMG" &&
      !/^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp|bmp|avif|svg\+xml);base64,)/iu.test(
        element.getAttribute("src") ?? "",
      )
    )
      element.removeAttribute("src");
  }
  return parsed.body.innerHTML;
}
const safeHtml = computed(() => passiveHtml(html.value));
watch(
  () =>
    [
      props.session.id,
      props.path,
      props.text,
      props.document?.html,
      props.document?.version.text,
      props.historical,
    ] as const,
  () => {
    const current = ++generation;
    clearTimeout(timer);
    error.value = "";
    renderedSource.value = null;
    if (props.historical || props.document?.version.text === props.text) {
      html.value = props.document?.html ?? "";
      renderedSource.value = props.document?.version.text ?? null;
      return;
    }
    html.value = "";
    const requestedText = props.text;
    timer = setTimeout(() => {
      void renderPreview();
    }, 150);
    async function renderPreview(): Promise<void> {
      try {
        const reply = await request(props.session, {
          operation: "read",
          path: props.path,
          text: requestedText,
        });
        if (current !== generation) return;
        if (!reply.document)
          throw new Error(
            reply.message ?? "files.thePreviewCouldNotBeRendered",
          );
        html.value = reply.document.html;
        renderedSource.value = requestedText;
      } catch (reason) {
        if (current === generation) error.value = reason;
      }
    }
  },
  { immediate: true, flush: "sync" },
);
let pointerStart: { x: number; y: number } | null = null;
let dragged = false;
function startPointer(event: PointerEvent): void {
  pointerStart = { x: event.clientX, y: event.clientY };
  dragged = false;
}
function movePointer(event: PointerEvent): void {
  if (
    pointerStart &&
    Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) >
      4
  )
    dragged = true;
}
function cancelPointer(): void {
  dragged = true;
}
function editSource(event: MouseEvent): void {
  if (
    !props.editable ||
    props.historical ||
    renderedSource.value !== props.text ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    dragged
  )
    return;
  if (window.getSelection()?.isCollapsed === false) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest("a, img, input")) return;
  const block = target.closest(
    "h1, h2, h3, h4, h5, h6, p, pre, li, blockquote",
  );
  if (!block || !content.value?.contains(block)) return;
  const offset = validOffset(block.getAttribute("data-source-offset"));
  if (offset !== null) emit("editSource", offset);
}
async function follow(event: MouseEvent): Promise<void> {
  const anchor = (event.target as Element).closest("a");
  if (!anchor) return;
  event.preventDefault();
  const current = generation;
  const href = anchor.getAttribute("data-file-href") ?? "";
  try {
    if (href.startsWith("#")) {
      const fragment = decodeURIComponent(href.slice(1));
      const target = fragment
        ? Array.from(
            content.value?.querySelectorAll<HTMLElement>(
              "[data-file-anchor]",
            ) ?? [],
          ).find(
            (element) => element.getAttribute("data-file-anchor") === fragment,
          )
        : content.value;
      if (!target) throw new Error("files.thisSectionWasNotFoundInTheDocument");
      target.scrollIntoView({ block: "start" });
      return;
    }
    const reply = await request(props.session, {
      operation: "openExternal",
      destination: props.path,
      href,
    });
    if (current !== generation) return;
    if (reply.status !== "ok")
      throw new Error(reply.message ?? "files.theLinkCouldNotBeOpened");
    if (reply.document) emit("navigate", reply.document.path);
  } catch (reason) {
    if (current === generation) error.value = reason;
  }
}
onBeforeUnmount(() => {
  generation++;
  clearTimeout(timer);
});
</script>
<template>
  <p v-if="error" class="file-notice" role="alert">
    {{ localizeError(error) }}
  </p>
  <article
    ref="content"
    class="markdown"
    data-dialog-document
    data-localization-content="user"
    @click.capture="follow"
    @auxclick.capture="follow"
    @click="editSource"
    @pointerdown="startPointer"
    @pointermove="movePointer"
    @pointercancel="cancelPointer"
    v-html="safeHtml"
  />
</template>
