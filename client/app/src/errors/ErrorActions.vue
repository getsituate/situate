<script setup lang="ts">
import { t } from "@situate/localization";
import { SituateButton } from "@situate/ui";
import { captureIncident, openIncident, type FailureBoundary } from "./runtime";
const props = defineProps<{
  boundary: FailureBoundary;
  error?: unknown;
  scope?: string;
}>();
function open(page: "report" | "repair") {
  const incident = captureIncident(
    props.boundary,
    props.error,
    props.scope,
    false,
  );
  openIncident(incident, page);
}
</script>
<template>
  <span class="error-actions">
    <SituateButton variant="ghost" size="small" @click="open('report')">{{
      t("errorRecovery.report")
    }}</SituateButton>
    <SituateButton variant="ghost" size="small" @click="open('repair')">{{
      t("errorRecovery.repair")
    }}</SituateButton>
  </span>
</template>
<style scoped>
.error-actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
