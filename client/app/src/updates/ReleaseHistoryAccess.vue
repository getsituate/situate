<script setup lang="ts">
import { ref } from "vue";
import { SituateButton, SituateDialog } from "@situate/ui";
import { t } from "@situate/localization";
import ReleaseHistory from "./ReleaseHistory.vue";
import { loadInstalledVersion } from "./release-history";
const open = ref(false);
async function show(event: MouseEvent) {
  (event.currentTarget as HTMLElement).focus();
  await loadInstalledVersion();
  open.value = true;
}
</script>
<template>
  <SituateButton variant="secondary" @click="show">{{
    t("releaseHistory.readNotes")
  }}</SituateButton>
  <SituateDialog
    :open="open"
    class="release-dialog"
    aria-labelledby="release-history-title"
    @cancel.prevent="open = false"
  >
    <template #header
      ><h2 id="release-history-title">
        {{ t("releaseHistory.history") }}
      </h2></template
    >
    <ReleaseHistory v-if="open" />
    <template #actions
      ><SituateButton autofocus @click="open = false">{{
        t("releaseHistory.close")
      }}</SituateButton></template
    >
  </SituateDialog>
</template>
<style scoped>
.release-dialog {
  width: min(800px, calc(100% - 48px));
  padding: clamp(20px, 3vw, 30px);
}
.release-dialog[open] {
  display: flex;
  flex-direction: column;
  max-height: min(
    calc(100dvh - 32px),
    calc(var(--app-content-height, 100dvh) - 32px)
  );
  height: min(
    880px,
    calc(100dvh - 48px),
    calc(var(--app-content-height, 100dvh) - 48px)
  );
  overflow: hidden;
}
.release-dialog :deep(.situate-dialog-actions) {
  flex-shrink: 0;
  padding-top: 20px;
  border-top: 1px solid var(--situate-line);
}
@media (max-width: 600px) {
  .release-dialog {
    width: calc(100% - 24px);
    padding: 20px;
  }
}
</style>
