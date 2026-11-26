<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { t } from "@situate/localization";
import {
  SituateButton,
  SituateDialog,
  SituateIcon,
  SituateSwitch,
} from "@situate/ui";
import { onMounted, ref, useId } from "vue";
import ErrorDialog from "../errors/ErrorDialog.vue";

const id = useId();
const enabled = ref<boolean>();
const busy = ref(false);
const failed = ref(false);
const confirming = ref(false);

async function perform(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  failed.value = false;
  busy.value = true;
  try {
    await action();
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}

function load(): Promise<void> {
  return perform(async () => {
    enabled.value = await invoke<boolean>("model_failure_snapshot");
  });
}

onMounted(load);

function save(next: boolean): Promise<void> {
  confirming.value = false;
  return perform(async () => {
    await invoke("model_failure_set", { enabled: next });
    enabled.value = next;
  });
}

function change(event: Event): void {
  const control = event.currentTarget as HTMLInputElement;
  const next = control.checked;
  control.checked = enabled.value === true;
  if (next) confirming.value = true;
  else void save(false);
}
</script>

<template>
  <section
    class="settings-group model-diagnostics"
    :aria-labelledby="`${id}-troubleshooting`"
  >
    <h3 :id="`${id}-troubleshooting`">
      <SituateIcon name="activity" />
      {{ t("settings.modelDiagnostics.troubleshooting") }}
    </h3>
    <div class="setting-row">
      <div>
        <label :for="`${id}-capture`">{{
          t("settings.modelDiagnostics.capture")
        }}</label>
        <p :id="`${id}-scope`">{{ t("settings.modelDiagnostics.scope") }}</p>
      </div>
      <SituateSwitch
        :id="`${id}-capture`"
        :aria-describedby="`${id}-scope`"
        :checked="enabled === true"
        :disabled="busy || enabled === undefined"
        @change="change"
      />
    </div>
  </section>
  <SituateDialog
    v-if="confirming"
    :open="true"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="`${id}-warning`"
    @cancel.prevent="confirming = false"
  >
    <template #header>
      <h2 :id="`${id}-title`">
        {{ t("settings.modelDiagnostics.confirmTitle") }}
      </h2>
    </template>
    <p :id="`${id}-warning`">{{ t("settings.modelDiagnostics.warning") }}</p>
    <template #actions>
      <SituateButton variant="secondary" autofocus @click="confirming = false">
        {{ t("navigation.cancel") }}
      </SituateButton>
      <SituateButton variant="primary" @click="save(true)">
        {{ t("settings.modelDiagnostics.enable") }}
      </SituateButton>
    </template>
  </SituateDialog>
  <ErrorDialog
    v-if="failed"
    :open="true"
    :message="t('settings.modelDiagnostics.error')"
    @dismiss="failed = false"
  >
    <template v-if="enabled === undefined" #actions>
      <SituateButton variant="primary" @click="load">
        {{ t("localization.retry") }}
      </SituateButton>
    </template>
  </ErrorDialog>
</template>

<style scoped>
.model-diagnostics {
  border-top: 1px solid var(--situate-line);
  padding-top: var(--situate-space-5);
}
.model-diagnostics h3 {
  display: flex;
  align-items: center;
  gap: var(--situate-space-2);
}
</style>
