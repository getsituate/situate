<script setup lang="ts">
import { nextTick, ref, useId } from "vue";
import { SituateButton, SituateIconButton, SituateMenu } from "../ui";
import { c } from "./content";
withDefaults(
  defineProps<{
    enabled: boolean;
    name: string;
    compact?: boolean;
    canEnable?: boolean;
    settingsLabel?: string;
    unavailableHelp?: string;
  }>(),
  { canEnable: true, settingsLabel: "", unavailableHelp: "" },
);
const emit = defineEmits<{
  uninstall: [];
  develop: [];
  settings: [];
  inspect: [event: MouseEvent];
  toggle: [event: MouseEvent];
}>();
const menuOpen = ref(false);
const menuId = useId();
const more = ref<InstanceType<typeof SituateIconButton>>();
async function chooseAction(
  action: "uninstall" | "develop" | "inspect",
  event: MouseEvent,
) {
  menuOpen.value = false;
  await nextTick();
  more.value?.focus();
  if (action === "inspect") emit("inspect", event);
  else if (action === "develop") emit("develop");
  else emit("uninstall");
}
</script>

<template>
  <div
    class="plugin-card-actions"
    :class="{ 'plugin-card-actions-compact': compact }"
  >
    <div class="plugin-row-links">
      <SituateButton
        v-if="!compact"
        variant="secondary"
        size="small"
        class="plugin-adapt"
        @click="emit('develop')"
      >
        {{ c.develop }} <span aria-hidden="true">↗</span>
      </SituateButton>
      <SituateButton
        :variant="compact ? 'secondary' : 'ghost'"
        size="small"
        v-if="settingsLabel"
        class="plugin-text"
        :disabled="!enabled"
        @click="emit('settings')"
      >
        {{ settingsLabel }}
      </SituateButton>
    </div>
    <p v-if="!enabled && unavailableHelp" class="plugin-action-help">
      {{ unavailableHelp }}
    </p>
    <div class="plugin-card-footer">
      <SituateButton
        v-if="!compact"
        variant="ghost"
        size="small"
        class="plugin-text"
        data-action="view-files"
        @click="emit('inspect', $event)"
      >
        {{ c.inspect }}
      </SituateButton>
      <div class="plugin-card-management">
        <SituateButton
          variant="ghost"
          size="small"
          class="plugin-text plugin-toggle"
          :disabled="!enabled && !canEnable"
          @click="emit('toggle', $event)"
        >
          {{ enabled ? c.disable : c.enable }}
        </SituateButton>
        <SituateIconButton
          ref="more"
          icon="more"
          data-action="more"
          :label="c.uninstall.more.replace('{name}', name)"
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
          :label="c.uninstall.menu"
          :close-on-select="false"
          @close="menuOpen = false"
        >
          <template v-if="compact">
            <SituateButton
              variant="plain"
              role="menuitem"
              @click="chooseAction('develop', $event)"
              >{{ c.develop }}</SituateButton
            >
            <SituateButton
              variant="plain"
              role="menuitem"
              @click="chooseAction('inspect', $event)"
              >{{ c.inspect }}</SituateButton
            >
          </template>
          <SituateButton
            variant="plain"
            role="menuitem"
            class="plugin-uninstall-action"
            @click="chooseAction('uninstall', $event)"
          >
            {{ c.uninstall.uninstall }}
          </SituateButton>
        </SituateMenu>
      </div>
    </div>
  </div>
</template>
