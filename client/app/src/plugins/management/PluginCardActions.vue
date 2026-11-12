<script setup lang="ts">
import { nextTick, ref, useId } from "vue";
import { SituateButton, SituateIconButton, SituateMenu } from "@situate/ui";
import { t } from "@situate/localization";
defineProps<{
  name: string;
  enabled: boolean;
  canEnable: boolean;
  hasSettings: boolean;
  canOpenSettings: boolean;
  busy: boolean;
  suspended?: boolean;
}>();
const emit = defineEmits<{
  uninstall: [];
  develop: [];
  resume: [];
  settings: [];
  inspect: [event: MouseEvent];
  toggle: [event: MouseEvent];
}>();
const menuOpen = ref(false);
const menuId = useId();
const more = ref<InstanceType<typeof SituateIconButton>>();
async function uninstall() {
  menuOpen.value = false;
  await nextTick();
  more.value?.focus();
  emit("uninstall");
}
</script>
<template>
  <div class="plugin-card-actions">
    <div class="plugin-row-links">
      <SituateButton
        variant="secondary"
        size="small"
        class="plugin-adapt"
        :disabled="busy"
        @click="emit('develop')"
      >
        {{ t("pluginManagement.develop") }} <span aria-hidden="true">↗</span>
      </SituateButton>
      <SituateButton
        v-if="hasSettings"
        variant="ghost"
        size="small"
        class="plugin-text"
        :disabled="busy || !canOpenSettings"
        @click="emit('settings')"
        >{{ t("pluginManagement.configure") }}</SituateButton
      >
    </div>
    <template v-if="suspended">
      <p>{{ t("recovery.risk") }}</p>
      <SituateButton
        variant="secondary"
        size="small"
        :disabled="busy"
        @click="emit('resume')"
        >{{ t("recovery.resume") }}</SituateButton
      >
    </template>
    <div class="plugin-card-footer">
      <SituateButton
        variant="ghost"
        size="small"
        class="plugin-text"
        data-action="view-files"
        @click="emit('inspect', $event)"
        >{{ t("pluginManagement.inspect") }}</SituateButton
      >
      <div class="plugin-card-management">
        <SituateButton
          variant="ghost"
          size="small"
          class="plugin-text plugin-toggle"
          :disabled="busy || (!enabled && !canEnable)"
          @click="emit('toggle', $event)"
          >{{
            enabled
              ? t("pluginManagement.disable")
              : t("pluginManagement.enable")
          }}</SituateButton
        >
        <SituateIconButton
          ref="more"
          icon="more"
          data-action="more"
          :label="t('pluginManagement.uninstall.more', { name })"
          :disabled="busy"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :aria-controls="menuOpen ? menuId : undefined"
          @click="menuOpen = !menuOpen"
          @keydown.down.prevent="menuOpen = true"
        />
        <SituateMenu
          v-if="menuOpen"
          :id="menuId"
          :open="menuOpen"
          :anchor="more?.element"
          :label="t('pluginManagement.uninstall.menu')"
          :close-on-select="false"
          @close="menuOpen = false"
        >
          <SituateButton variant="plain" role="menuitem" @click="uninstall">
            {{ t("pluginManagement.uninstall.uninstall") }}
          </SituateButton>
        </SituateMenu>
      </div>
    </div>
  </div>
</template>
