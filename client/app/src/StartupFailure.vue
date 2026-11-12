<script setup lang="ts">
import { t } from "@situate/localization";
import { SituateButton } from "@situate/ui";
import RecoveryRoot from "./errors/RecoveryRoot.vue";
import { captureIncident, openIncident, recoveryState } from "./errors/runtime";
const incident =
  recoveryState.incidents.find((item) => item.boundary === "startup") ??
  captureIncident("startup", undefined);
</script>
<template>
  <main class="startup-failure">
    <p role="alert">{{ t("errorRecovery.startupFailure") }}</p>
    <SituateButton variant="secondary" @click="openIncident(incident)">{{
      t("errorRecovery.review")
    }}</SituateButton>
  </main>
  <RecoveryRoot />
</template>
<style scoped>
.startup-failure {
  padding: max(24px, env(safe-area-inset-top)) 18px
    max(24px, env(safe-area-inset-bottom));
  max-width: 640px;
  max-height: 100%;
  overflow: auto;
  margin: auto;
  overflow-wrap: anywhere;
}
</style>
