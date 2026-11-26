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
}>();
const emit = defineEmits<{
  navigate: [path: string];
}>();
const html = ref("");
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
function passiveHtml(value: string): string {
  const parsed = new DOMParser().parseFromString(value, "text/html");
  for (const element of Array.from(parsed.body.querySelectorAll("*"))) {
    if (!allowed.has(element.tagName)) {
      element.replaceWith(parsed.createTextNode(element.textContent ?? ""));
      continue;
    }
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
    if (props.historical || props.document?.version.text === props.text) {
      html.value = props.document?.html ?? "";
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
      } catch (reason) {
        if (current === generation) error.value = reason;
      }
    }
  },
  { immediate: true, flush: "sync" },
);
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
    v-html="safeHtml"
  />
</template>
