<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { SituateButton } from "@situate/ui";
import { t } from "@situate/localization";
import FileDialog from "../../files/FileDialog.vue";
import { filesRequest } from "../../files/api";
import ChatFileChanges from "./ChatFileChanges.vue";
import type { importChangeReceipts, VerifiedChange } from "./transcript";

const props = defineProps<{
  scope: string;
  batch: NonNullable<ReturnType<typeof importChangeReceipts>>;
  isError?: boolean;
}>();
const visibleCount = ref(10);
const selected = ref<string>();
const change = ref<VerifiedChange>();
const loading = ref(false);
const unavailable = ref(false);
const attempt = ref(0);
const visibleFiles = computed(() =>
  props.batch.files.slice(0, visibleCount.value),
);

watch(
  () => JSON.stringify([props.scope, props.batch]),
  () => {
    selected.value = undefined;
    visibleCount.value = 10;
  },
);
watch(
  () => [selected.value, attempt.value] as const,
  async ([path], _previous, cleanup) => {
    let active = true;
    cleanup(() => {
      active = false;
    });
    change.value = undefined;
    unavailable.value = false;
    loading.value = Boolean(path);
    const file = props.batch.files.find((file) => file.path === path);
    if (!file) return;
    const history = props.batch.history;
    try {
      const reply = await filesRequest(
        history
          ? {
              workspaceId: props.scope,
              operation: "revision",
              path: file.path,
              revision: history,
              exactPath: true,
            }
          : { workspaceId: props.scope, operation: "read", path: file.path },
      );
      if (!active) return;
      if (
        reply.status !== "ok" ||
        reply.document.version.revision !== (history ?? file.revision)
      )
        throw new Error("references.unavailable");
      change.value = {
        path: file.path,
        before: null,
        after: reply.document.version.text,
        beforeRevision: null,
        afterRevision: file.revision,
      };
    } catch {
      if (active) unavailable.value = true;
    } finally {
      if (active) loading.value = false;
    }
  },
);
</script>

<template>
  <div class="batch-files">
    <ul>
      <li v-for="file in visibleFiles" :key="file.path">
        <SituateButton
          variant="plain"
          class="batch-file"
          @click="selected = file.path"
        >
          <span class="batch-path" data-localization-content="user">{{
            file.path
          }}</span>
          <span aria-hidden="true">›</span>
        </SituateButton>
      </li>
    </ul>
    <SituateButton
      v-if="visibleCount < batch.files.length"
      class="batch-more"
      variant="ghost"
      @click="visibleCount += 10"
      >{{ t("chat.showMoreFiles") }}</SituateButton
    >
    <FileDialog
      v-if="selected"
      :title="selected.split('/').at(-1) ?? selected"
      wide
      @dismiss="selected = undefined"
    >
      <p v-if="loading" role="status">{{ t("files.loadingDocument") }}</p>
      <template v-else-if="unavailable">
        <p role="status">{{ t("chat.importChangeUnavailable") }}</p>
        <SituateButton variant="ghost" @click="attempt++">{{
          t("navigation.retry")
        }}</SituateButton>
      </template>
      <div v-else-if="change" class="batch-preview">
        <ChatFileChanges :changes="[change]" :is-error="isError" />
      </div>
    </FileDialog>
  </div>
</template>

<style scoped>
.batch-files {
  min-width: 0;
  border-top: 1px solid var(--situate-line);
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.batch-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 10px 14px;
  border: 0;
  background: transparent;
  color: var(--situate-ink);
  font: inherit;
  font-size: 12px;
  text-align: start;
  cursor: pointer;
}
.batch-path {
  min-width: 0;
  overflow-wrap: anywhere;
}
.batch-more {
  margin: 4px 14px 12px;
}
.batch-preview {
  min-width: 0;
}
.batch-preview :deep(.change-content) {
  max-height: none;
  overflow: visible;
}
.batch-file:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-accent-strong);
  outline-offset: -3px;
}
@media (hover: hover) {
  .batch-file:hover {
    background: var(--situate-paper);
  }
}
</style>
