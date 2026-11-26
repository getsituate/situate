<script setup lang="ts">
import { computed, useId, ref } from "vue";
import { SituateButton, SituateDialog } from "@situate/ui";
import { preferences, t } from "@situate/localization";
import ReleaseHistory from "./ReleaseHistory.vue";
import { installedReleases, loadInstalledVersion } from "./release-history";
const id = useId();
const open = ref(false);
const catalog = computed(() =>
  open.value ? installedReleases().releases : [],
);
const releases = computed(() =>
  catalog.value.flatMap(({ version, date, locales }) => {
    const entries = (locales[preferences.value.language] ?? locales.en).entries;
    return entries.length ? [{ version, date, entries }] : [];
  }),
);
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
    :class="{ 'release-dialog-empty': !releases.length }"
    fade-backdrop
    :aria-labelledby="`release-history-title-${id}`"
    @cancel.prevent="open = false"
  >
    <template #header
      ><h2 :id="`release-history-title-${id}`">
        {{ t("releaseHistory.history") }}
      </h2></template
    >
    <ReleaseHistory v-if="open" :releases="releases" />
    <template #actions
      ><SituateButton variant="secondary" autofocus @click="open = false">{{
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
.release-dialog-empty[open] {
  display: block;
  width: min(560px, calc(100% - 24px));
  height: fit-content;
}
.release-dialog :deep(.situate-dialog-actions) {
  flex-shrink: 0;
  padding-top: var(--situate-space-5);
  border-top: 1px solid var(--situate-line);
}
@media (max-width: 600px) {
  .release-dialog {
    width: calc(100% - 24px);
    padding: var(--situate-space-5);
  }
}
</style>
