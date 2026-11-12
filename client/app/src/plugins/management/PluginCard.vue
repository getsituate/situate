<script setup lang="ts">
import { computed, type DeepReadonly } from "vue";
import { t } from "@situate/localization";
import "@situate/localization/plugin-management";
import type { RuntimePlugin } from "../runtime";
import { pluginSettingsId } from "../management";
import PluginCardActions from "./PluginCardActions.vue";
const props = defineProps<{
  plugin: DeepReadonly<RuntimePlugin>;
  consumers: readonly { id: string; name: string }[];
  blockedByName?: string;
  canEnable: boolean;
  busy: boolean;
}>();
const blockedMessage = computed(() => {
  const blocked = props.plugin.blockedBy;
  if (!blocked) return undefined;
  const name = props.blockedByName || blocked.pluginId;
  switch (blocked.reason) {
    case "missing":
      return t("pluginManagement.missingDependency", { name });
    case "disabled":
      return t("pluginManagement.disabledDependency", { name });
    case "cyclic":
      return t("pluginManagement.cyclicDependency", { name });
    case "platform":
      return t("pluginManagement.unavailablePlatform", { name });
    case "dependency":
      return t("pluginManagement.failedDependency", { name });
  }
  return undefined;
});
const emit = defineEmits<{
  uninstall: [];
  develop: [];
  resume: [];
  settings: [];
  inspect: [event: MouseEvent];
  toggle: [event: MouseEvent];
}>();
</script>
<template>
  <article
    class="plugin-row plugin-card-plain"
    :data-plugin-id="plugin.id"
    :aria-labelledby="`plugin-title-${plugin.id}`"
  >
    <div class="plugin-card-top">
      <h3 :id="`plugin-title-${plugin.id}`" data-localization-content="user">
        {{ plugin.manifest?.name || plugin.id }}
      </h3>
      <span
        class="plugin-availability"
        :class="{ 'plugin-enabled': plugin.status === 'loaded' }"
        >{{
          plugin.status === "loaded"
            ? t("pluginManagement.enabled")
            : plugin.status === "failed"
              ? t("pluginManagement.failed")
              : plugin.status === "suppressed"
                ? t("pluginManagement.suppressed")
                : t("pluginManagement.disabled")
        }}</span
      >
    </div>
    <div class="plugin-row-content">
      <p v-if="plugin.manifest?.kind" class="plugin-kind">
        {{
          plugin.manifest.kind === "connection"
            ? t("pluginManagement.connectionKind")
            : t("pluginManagement.toolKind")
        }}
      </p>
      <p v-if="plugin.manifest?.description" data-localization-content="user">
        {{ plugin.manifest.description }}
      </p>
      <p v-if="blockedMessage" class="plugin-blocked">{{ blockedMessage }}</p>
      <p v-if="plugin.manifest?.kind === 'connection'">
        {{ t("pluginManagement.accessUnverified") }}
      </p>
      <template v-if="consumers.length">
        <p>{{ t("pluginManagement.declaredConsumers") }}</p>
        <ul class="plugin-consumers">
          <li
            v-for="consumer in consumers"
            :key="consumer.id"
            data-localization-content="user"
          >
            {{ consumer.name }}
          </li>
        </ul>
      </template>
      <p v-else-if="plugin.manifest?.kind === 'connection'">
        {{ t("pluginManagement.noDeclaredConsumers") }}
      </p>
    </div>
    <PluginCardActions
      :name="plugin.manifest?.name || plugin.id"
      @uninstall="emit('uninstall')"
      :enabled="plugin.enabled"
      :can-enable="canEnable"
      :has-settings="!!plugin.settingsId"
      :can-open-settings="!!pluginSettingsId(plugin)"
      :busy="busy"
      :suspended="plugin.status === 'suppressed' && plugin.enabled"
      @resume="emit('resume')"
      @develop="emit('develop')"
      @settings="emit('settings')"
      @inspect="emit('inspect', $event)"
      @toggle="emit('toggle', $event)"
    />
  </article>
</template>
<style scoped>
.plugin-consumers {
  margin: 0;
  padding-inline-start: 20px;
  font-size: 14px;
  color: var(--situate-muted);
  overflow-wrap: anywhere;
}
</style>
