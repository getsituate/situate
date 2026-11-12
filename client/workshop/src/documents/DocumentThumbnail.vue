<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { SituateIcon } from "../ui";
import { c } from "./content";
import receipt from "./assets/office-receipt.svg";
import type { DocumentItem, DocumentsState } from "./model";
const props = withDefaults(
  defineProps<{
    document: DocumentItem;
    mode?: DocumentsState["thumbnailMode"];
  }>(),
  { mode: "fixture" },
);
const failed = ref(false);
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const image = computed(() => {
  if (props.document.type === "Image") return receipt;
  if (props.document.type !== "PDF" || !props.document.pages.length) return "";
  const lines = props.document.pages[0]!.split("\n")
    .slice(0, 22)
    .map(
      (line, index) =>
        `<text x="24" y="${50 + index * 15}" font-size="${index === 0 ? 18 : 9.5}" font-weight="${index === 0 ? 600 : 400}" xml:space="preserve">${escape(line)}</text>`,
    )
    .join("");
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect x=".5" y=".5" width="299" height="399" rx="2" fill="#fffefa" stroke="#d9d0df"/><g fill="#30203e" font-family="Arial,sans-serif">${lines}</g></svg>`)}`;
});
const status = computed(() =>
  props.document.type === "Spreadsheet"
    ? "unavailable"
    : failed.value
      ? "error"
      : props.mode !== "fixture"
        ? props.mode
        : props.document.thumbnail,
);
watch(
  () => [image.value, props.mode, props.document.thumbnail],
  () => {
    failed.value = false;
  },
);
</script>
<template>
  <span class="doc-thumbnail" :data-preview-status="status">
    <img
      v-if="status === 'available' && image"
      :src="image"
      alt=""
      loading="lazy"
      @error="failed = true"
    />
    <span v-else class="doc-thumbnail-fallback">
      <SituateIcon name="notes" />
      <span>{{
        status === "pending"
          ? c.thumbnailLoading
          : status === "error"
            ? c.thumbnailError
            : c.thumbnailMissing
      }}</span>
    </span>
    <span class="doc-thumbnail-type">{{
      document.type === "Image"
        ? "IMG"
        : document.type === "Spreadsheet"
          ? "XLSX"
          : "PDF"
    }}</span>
  </span>
</template>
