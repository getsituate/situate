<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { t } from "@situate/localization";
import { SituateButton } from "@situate/ui";
import type { PDFDocumentProxy } from "pdfjs-dist";

const props = defineProps<{
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
  title: string;
}>();
const emit = defineEmits<{ failed: [] }>();
const canvas = ref<HTMLCanvasElement>();
const page = ref(1);
const total = ref(0);
const zoom = ref(100);
const loading = ref(true);
const text = ref("");
const pdf = shallowRef<PDFDocumentProxy>();
const isPdf = computed(() => props.mimeType === "application/pdf");
const image = ref<string>();

watch(
  () => [props.bytes, props.mimeType] as const,
  async ([bytes, mimeType], _, onCleanup) => {
    let current = true;
    let dispose: (() => void) | undefined;
    onCleanup(() => {
      current = false;
      dispose?.();
    });
    pdf.value = undefined;
    image.value = undefined;
    page.value = 1;
    zoom.value = 100;
    total.value = 0;
    loading.value = true;
    try {
      if (mimeType !== "application/pdf") {
        const signature =
          mimeType === "image/png"
            ? [137, 80, 78, 71, 13, 10, 26, 10]
            : [255, 216, 255];
        if (!signature.every((part, index) => bytes[index] === part))
          throw new Error();
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        image.value = url;
        dispose = () => URL.revokeObjectURL(url);
        return;
      }
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
        throw new Error();
      const [{ getDocument, GlobalWorkerOptions }, { default: worker }] =
        await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
      if (!current) return;
      GlobalWorkerOptions.workerSrc = worker;
      const task = getDocument({
        data: bytes,
        useWasm: false,
        useWorkerFetch: false,
        maxImageSize: 16_000_000,
      });
      dispose = () => void task.destroy().catch(() => undefined);
      const document = await task.promise;
      if (!current) return;
      pdf.value = document;
      total.value = document.numPages;
      loading.value = false;
    } catch {
      if (current) emit("failed");
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
</script>

<template>
  <div v-if="!loading || !isPdf" class="doc-page-tools">
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
  </div>
  <p v-if="loading" class="doc-status" role="status">
    {{ t("documents.opening") }}
  </p>
  <div class="doc-page-stage" :aria-label="t('documents.preview')" tabindex="0">
    <template v-if="isPdf">
      <canvas
        v-if="!loading"
        ref="canvas"
        :style="{ maxWidth: `${zoom}%` }"
        aria-hidden="true"
      />
      <p class="sr-only">{{ text }}</p>
    </template>
    <img
      v-else-if="image"
      :src="image"
      :alt="title"
      :style="{ width: `${zoom}%` }"
      @load="loading = false"
      @error="emit('failed')"
    />
  </div>
</template>
