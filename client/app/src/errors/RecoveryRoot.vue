<script setup lang="ts">
import { onErrorCaptured, ref } from "vue";
import { t } from "@situate/localization";
import RecoveryHost from "./RecoveryHost.vue";
defineProps<{
  mobile?: boolean;
  onRepairOpened?: (scope: string, conversationId: string) => Promise<void>;
}>();
const failed = ref(false);
onErrorCaptured(() => {
  failed.value = true;
  return false;
});
</script>
<template>
  <aside v-if="failed" class="recovery-fatal" role="alert">
    {{ t("errorRecovery.fatal") }}
  </aside>
  <RecoveryHost v-else :mobile="mobile" :on-repair-opened="onRepairOpened" />
</template>
<style scoped>
.recovery-fatal {
  position: fixed;
  inset: auto 16px 16px;
  z-index: 100;
  padding: 24px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  border: 1px solid var(--situate-control-line);
  border-radius: 24px;
}
</style>
