<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { SituateButton, SituateDialog, SituateTextarea } from "@situate/ui";
import { t } from "@situate/localization";
import { loadLicenses } from "./licenses";

const open = ref(false);
const text = ref("");
const loading = ref(false);
const failed = ref(false);
let request: AbortController | undefined;
async function load() {
  request?.abort();
  const current = new AbortController();
  request = current;
  loading.value = true;
  failed.value = false;
  try {
    const result = await loadLicenses(current.signal);
    if (!current.signal.aborted) text.value = result;
  } catch {
    if (!current.signal.aborted) failed.value = true;
  } finally {
    if (!current.signal.aborted) loading.value = false;
  }
}
function show(event: MouseEvent) {
  (event.currentTarget as HTMLElement).focus();
  open.value = true;
  if (!text.value) void load();
}
function close() {
  request?.abort();
  loading.value = false;
  open.value = false;
}
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <SituateButton variant="secondary" @click="show">{{
    t("licenses.open")
  }}</SituateButton>
  <SituateDialog
    :open="open"
    class="licenses-dialog"
    :class="{ 'has-notices': !!text && !loading && !failed }"
    aria-labelledby="licenses-title"
    @cancel.prevent="close"
  >
    <template #header
      ><h2 id="licenses-title">{{ t("licenses.title") }}</h2></template
    >
    <template v-if="open">
      <p v-if="loading" role="status">{{ t("licenses.loading") }}</p>
      <div v-else-if="failed" role="alert">
        <p>{{ t("licenses.failed") }}</p>
        <SituateButton variant="secondary" @click="load">{{
          t("localization.retry")
        }}</SituateButton>
      </div>
      <SituateTextarea
        v-else
        appearance="plain"
        readonly
        class="licenses-text"
        :aria-label="t('licenses.title')"
        :model-value="text"
        data-dialog-document
        data-localization-content="external"
      />
    </template>
    <template #actions
      ><SituateButton autofocus @click="close">{{
        t("licenses.close")
      }}</SituateButton></template
    >
  </SituateDialog>
</template>

<style scoped>
.licenses-dialog {
  width: min(520px, calc(100% - 48px));
}
.licenses-dialog[open] {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.licenses-dialog.has-notices[open] {
  width: min(800px, calc(100% - 48px));
  height: min(
    880px,
    calc(100dvh - 48px),
    calc(var(--app-content-height, 100dvh) - 48px)
  );
}
.licenses-text {
  flex: 1;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 16px;
  resize: none;
  border: 1px solid var(--situate-control-line);
  border-radius: 8px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  font: inherit;
  font-size: var(--situate-text-small);
  line-height: 1.55;
  user-select: text;
}
.licenses-dialog :deep(.situate-dialog-actions) {
  margin-top: auto;
  flex-shrink: 0;
  padding-top: 20px;
}
@media (max-width: 600px) {
  .licenses-dialog,
  .licenses-dialog.has-notices[open] {
    width: calc(100% - 24px);
    padding: 20px;
  }
}
</style>
