<script setup lang="ts">
import PluginCardActions from "./PluginCardActions.vue";
import { c } from "./content";
import type { Plugin } from "./model";
withDefaults(
  defineProps<{
    plugin: Plugin;
    illustrated?: boolean;
    canEnable?: boolean;
    settingsLabel?: string;
    unavailableHelp?: string;
  }>(),
  {
    illustrated: false,
    canEnable: true,
    settingsLabel: "",
    unavailableHelp: "",
  },
);
const emit = defineEmits<{
  uninstall: [];
  develop: [];
  settings: [];
  inspect: [event: MouseEvent];
  toggle: [event: MouseEvent];
}>();
</script>
<template>
  <article
    class="plugin-row"
    :class="{ 'plugin-card-plain': !illustrated }"
    :data-plugin-id="plugin.id"
    :aria-labelledby="`plugin-title-${plugin.id}`"
  >
    <div class="plugin-card-top">
      <div v-if="illustrated" class="plugin-card-artwork">
        <slot name="artwork" />
      </div>
      <h3 v-else :id="`plugin-title-${plugin.id}`">{{ plugin.name }}</h3>
      <span
        class="plugin-availability"
        :class="{ 'plugin-enabled': plugin.enabled }"
      >
        {{
          plugin.enabled ? c.enabled : plugin.blocked ? c.blocked : c.disabled
        }}
      </span>
    </div>
    <div class="plugin-row-content">
      <h3 v-if="illustrated" :id="`plugin-title-${plugin.id}`">
        {{ plugin.name }}
      </h3>
      <p>{{ plugin.description }}</p>
      <slot />
      <div v-if="plugin.running" class="plugin-meta">
        <span>{{ c.runningCount(plugin.running) }}</span>
      </div>
      <slot name="notice" />
    </div>
    <PluginCardActions
      :enabled="plugin.enabled"
      :name="plugin.name"
      :can-enable="canEnable"
      :settings-label="settingsLabel"
      :unavailable-help="unavailableHelp"
      @uninstall="emit('uninstall')"
      @develop="emit('develop')"
      @settings="emit('settings')"
      @inspect="emit('inspect', $event)"
      @toggle="emit('toggle', $event)"
    />
  </article>
</template>
