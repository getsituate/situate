<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { t } from "@situate/localization";
import { SituateButton } from "@situate/ui";
import type { PDFDocumentProxy } from "pdfjs-dist";
import WorkingIndicator from "../components/WorkingIndicator.vue";
import { checkPreviewSignature, loadPdf } from "./document-preview";

const props = defineProps<{
  bytes?: Uint8Array<ArrayBuffer>;
  mimeType?: string;
  title?: string;
}>();
const emit = defineEmits<{ failed: [] }>();
const canvas = ref<HTMLCanvasElement>();
const page = ref(1);
const total = ref(0);
const zoom = ref(100);
const loading = ref(true);
const loadingAnnounced = ref(false);
const text = ref("");
const pdf = shallowRef<PDFDocumentProxy>();
const isPdf = computed(() => props.mimeType === "application/pdf");
const image = ref<string>();
const imageElement = ref<HTMLImageElement>();

watch(
  loading,
  (busy, _, onCleanup) => {
    if (!busy) return;
    loadingAnnounced.value = false;
    const timer = setTimeout(() => {
      loadingAnnounced.value = true;
    }, 200);
    onCleanup(() => clearTimeout(timer));
  },
  { immediate: true },
);

watch(
  () => [props.bytes, props.mimeType] as const,
  async ([bytes, mimeType], _, onCleanup) => {
    const controller = new AbortController();
    const { signal } = controller;
    let dispose: (() => void) | undefined;
    onCleanup(() => {
      controller.abort();
      dispose?.();
    });
    pdf.value = undefined;
    image.value = undefined;
    page.value = 1;
    zoom.value = 100;
    total.value = 0;
    loading.value = true;
    if (!bytes || !mimeType) return;
    try {
      checkPreviewSignature(bytes, mimeType);
      if (mimeType !== "application/pdf") {
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        image.value = url;
        dispose = () => URL.revokeObjectURL(url);
        return;
      }
      const task = await loadPdf(bytes, signal);
      dispose = () => void task.destroy().catch(() => undefined);
      if (signal.aborted) {
        dispose();
        return;
      }
      const document = await task.promise;
      if (signal.aborted) return;
      pdf.value = document;
      total.value = document.numPages;
    } catch {
      if (!signal.aborted) emit("failed");
    }
  },
  { immediate: true },
);

watch(
  () => [pdf.value, canvas.value, page.value, zoom.value] as const,
  async ([document, surface, number, scale], _, onCleanup) => {
    if (!document || !surface) return;
    let current = true;
    let cancel: (() => void) | undefined;
    text.value = "";
    onCleanup(() => {
      current = false;
      cancel?.();
    });
    try {
      const sheet = await document.getPage(number);
      if (!current) return;
      const size = sheet.getViewport({ scale: scale / 100 });
      if (
        !Number.isFinite(size.width) ||
        !Number.isFinite(size.height) ||
        size.width <= 0 ||
        size.height <= 0 ||
        Math.max(size.width, size.height) > 4096
      )
        throw new Error();
      surface.width = Math.ceil(size.width);
      surface.height = Math.ceil(size.height);
      const task = sheet.render({
        canvas: surface,
        viewport: size,
        annotationMode: 0,
      });
      cancel = () => task.cancel();
      await task.promise;
      if (!current) return;
      loading.value = false;
      const content = await sheet.getTextContent();
      if (current)
        text.value = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("");
    } catch {
      if (current) emit("failed");
    }
  },
  { flush: "post" },
);

watch(
  [imageElement, image],
  async ([element, url], _, onCleanup) => {
    if (!element || !url) return;
    let current = true;
    onCleanup(() => {
      current = false;
    });
    try {
      await element.decode();
      if (current) loading.value = false;
    } catch {
      if (current) emit("failed");
    }
  },
  { flush: "post" },
);
</script>

<template>
  <div class="doc-reading">
    <div class="doc-page-tools">
      <template v-if="!loading">
        <template v-if="isPdf">
          <SituateButton
            variant="plain"
            :aria-label="t('documents.previous')"
            :disabled="page <= 1"
            @click="page--"
            >‹</SituateButton
          >
          <span role="status" :aria-label="t('documents.page', { page, total })"
            >{{ page }} / {{ total }}</span
          >
          <SituateButton
            variant="plain"
            :aria-label="t('documents.next')"
            :disabled="page >= total"
            @click="page++"
            >›</SituateButton
          >
        </template>
        <SituateButton
          variant="plain"
          :aria-label="t('documents.zoomOut')"
          :disabled="zoom <= 80"
          @click="zoom -= 20"
          >−</SituateButton
        >
        <span>{{ zoom }}%</span>
        <SituateButton
          variant="plain"
          :aria-label="t('documents.zoomIn')"
          :disabled="zoom >= 160"
          @click="zoom += 20"
          >+</SituateButton
        >
      </template>
    </div>
    <div class="doc-page-frame">
      <div
        class="doc-page-stage"
        :class="{
          'doc-page-pending': loading,
          'doc-page-reveal': !loading && loadingAnnounced,
        }"
        :style="{ '--doc-zoom': zoom + '%' }"
        role="group"
        :aria-label="t('documents.preview')"
        :aria-busy="loading"
        :tabindex="loading ? -1 : 0"
      >
        <template v-if="isPdf">
          <canvas ref="canvas" inert />
          <p class="sr-only">{{ text }}</p>
        </template>
        <img
          v-else-if="image"
          ref="imageElement"
          :src="image"
          :alt="title ?? ''"
        />
      </div>
      <div
        role="status"
        aria-atomic="true"
        :class="loading && loadingAnnounced ? 'doc-opening' : 'sr-only'"
      >
        <template v-if="loading && loadingAnnounced">
          <WorkingIndicator />
          <span>{{ t("documents.opening") }}</span>
        </template>
        <span v-else-if="loadingAnnounced">{{
          t("documents.previewReady")
        }}</span>
      </div>
    </div>
  </div>
</template>
