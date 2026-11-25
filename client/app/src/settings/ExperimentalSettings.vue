<script setup lang="ts">
import { nextTick, onMounted, ref, useId, useTemplateRef } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { localizeError, t } from "@situate/localization";
import { SituateButton, SituateDialog, SituateSwitch } from "@situate/ui";
import ErrorDialog from "../errors/ErrorDialog.vue";

const props = defineProps<{ workspaceScope?: string }>();
const enabled = ref<boolean>();
const installing = ref(false);
const installed = ref(false);
const updateAvailable = ref(false);
const pending = ref(false);
const showNotice = ref(false);
const error = ref("");
const control = useTemplateRef<InstanceType<typeof SituateSwitch>>("control");
const id = useId();

async function read() {
  try {
    enabled.value = await invoke<boolean>("gmail_experiment");
    await readInstallation();
  } catch (failure) {
    error.value = localizeError(failure);
  }
}
onMounted(read);

async function save(value: boolean) {
  pending.value = true;
  try {
    enabled.value = await invoke<boolean>("gmail_experiment", {
      enabled: value,
    });
    await readInstallation();
  } catch (failure) {
    error.value = localizeError(failure);
  } finally {
    pending.value = false;
    await nextTick();
    if (!error.value) control.value?.focus();
  }
}

async function readInstallation() {
  if (!enabled.value || !props.workspaceScope) return;
  const scope = props.workspaceScope;
  installed.value = await invoke<boolean>("gmail_install", {
    scope,
    install: false,
  });
  updateAvailable.value =
    installed.value &&
    (await invoke<boolean>("gmail_install", {
      scope,
      install: false,
      update: true,
    }));
}

async function install(update = false) {
  if (!props.workspaceScope) return;
  installing.value = true;
  try {
    installed.value = await invoke<boolean>("gmail_install", {
      scope: props.workspaceScope,
      install: true,
      update,
    });
    updateAvailable.value = false;
  } catch (failure) {
    error.value = localizeError(failure);
  } finally {
    installing.value = false;
  }
}

function change(value: boolean) {
  if (control.value?.element)
    control.value.element.checked = enabled.value ?? false;
  if (value) showNotice.value = true;
  else void save(false);
}

async function close(confirmed = false) {
  showNotice.value = false;
  if (confirmed) await save(true);
  else {
    await nextTick();
    control.value?.focus();
  }
}
</script>

<template>
  <section class="settings-group">
    <div class="setting-row">
      <div>
        <label :for="`${id}-gmail`">{{
          t("settings.experimental.gmail")
        }}</label>
        <p :id="`${id}-help`">{{ t("settings.experimental.gmailHelp") }}</p>
      </div>
      <SituateSwitch
        :id="`${id}-gmail`"
        ref="control"
        :aria-describedby="`${id}-help`"
        :model-value="enabled ?? false"
        :disabled="enabled === undefined || pending"
        @update:model-value="change"
      />
    </div>
    <div v-if="enabled && workspaceScope" class="setting-row">
      <p v-if="installed" role="status">
        {{ t("settings.experimental.gmailInstalled") }}
      </p>
      <SituateButton
        v-if="updateAvailable"
        :disabled="installing || pending"
        @click="install(true)"
        >{{ t("settings.experimental.updateGmail") }}</SituateButton
      >
      <SituateButton
        v-else-if="!installed"
        :disabled="installing || pending"
        @click="install()"
      >
        {{ t("settings.experimental.installGmail") }}
      </SituateButton>
    </div>
  </section>
  <SituateDialog
    v-if="showNotice"
    :open="true"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="`${id}-notice`"
    @cancel.prevent="close()"
  >
    <template #header>
      <h2 :id="`${id}-title`">{{ t("settings.experimental.enableTitle") }}</h2>
    </template>
    <p :id="`${id}-notice`">{{ t("settings.experimental.notice") }}</p>
    <template #actions>
      <SituateButton variant="secondary" autofocus @click="close()">
        {{ t("settings.experimental.cancel") }}
      </SituateButton>
      <SituateButton @click="close(true)">
        {{ t("settings.experimental.enable") }}
      </SituateButton>
    </template>
  </SituateDialog>
  <ErrorDialog v-if="error" :open="true" :message="error" @dismiss="error = ''">
    <SituateButton
      v-if="enabled === undefined"
      @click="
        error = '';
        read();
      "
    >
      {{ t("settings.experimental.retry") }}
    </SituateButton>
  </ErrorDialog>
</template>
