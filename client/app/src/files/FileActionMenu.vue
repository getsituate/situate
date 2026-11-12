<script setup lang="ts">
import { t } from "@situate/localization";
import { ref } from "vue";
import { SituateButton, SituateIconButton, SituateMenu } from "@situate/ui";
import type { FileAction, FileMenuEntry } from "./fileActions";
defineProps<{
  anchor: HTMLElement;
  title: string;
  context: string;
  items: FileMenuEntry[];
  point?: { x: number; y: number };
}>();
const emit = defineEmits<{ dismiss: []; choose: [action: FileAction] }>();
const open = ref(true);
function close(): void {
  if (!open.value) return;
  open.value = false;
  emit("dismiss");
}
function choose(action: FileAction): void {
  emit("choose", action);
  close();
}
</script>
<template>
  <SituateMenu
    :open="open"
    :anchor="anchor"
    :point="point"
    :label="title"
    :close-on-select="false"
    class="file-action-menu"
    @close="close"
  >
    <header>
      <h2>{{ title }}</h2>
      <SituateIconButton
        icon="close"
        :label="t('files.closeActions')"
        @click="close()"
      />
    </header>
    <p class="menu-context" data-localization-content="user">{{ context }}</p>
    <div class="file-action-items">
      <template v-for="(item, index) in items" :key="item?.action ?? index">
        <div v-if="!item" class="menu-separator" role="separator" />
        <SituateButton
          variant="plain"
          v-else
          type="button"
          :role="item.checked === undefined ? 'menuitem' : 'menuitemradio'"
          :aria-checked="item.checked"
          :disabled="item.disabled"
          tabindex="-1"
          @click="choose(item.action)"
        >
          {{ item.label }}<span v-if="item.checked" aria-hidden="true">✓</span>
        </SituateButton>
      </template>
    </div>
  </SituateMenu>
</template>

<style scoped>
.file-action-items {
  display: grid;
  gap: 2px;
}
</style>
