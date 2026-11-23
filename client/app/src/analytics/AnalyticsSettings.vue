<script setup lang="ts">
import { ref } from "vue";
import { t } from "@situate/localization";
import { SituateSwitch } from "@situate/ui";
import ErrorDialog from "../errors/ErrorDialog.vue";
import { analyticsPreference, setAnalyticsPreference } from "./runtime";

const saving = ref(false);
const failed = ref(false);

async function change(event: Event): Promise<void> {
  const checkbox = event.currentTarget as HTMLInputElement;
  const enabled = checkbox.checked;
  checkbox.checked = analyticsPreference.value === true;
  if (saving.value) return;
  saving.value = true;
  try {
    await setAnalyticsPreference(enabled);
  } catch {
    failed.value = true;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <label class="analytics-choice" data-analytics-preference>
    <SituateSwitch
      :checked="analyticsPreference === true"
      :disabled="saving"
      @change="change"
    />
    {{ t("settings.analytics.share") }}
  </label>
  <p>{{ t("settings.analytics.description") }}</p>
  <p>{{ t("settings.analytics.withdrawal") }}</p>
  <ErrorDialog
    :open="failed"
    :message="t('settings.analytics.error')"
    @dismiss="failed = false"
  />
</template>

<style scoped>
.analytics-choice {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
</style>
