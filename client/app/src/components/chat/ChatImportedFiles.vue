<script setup lang="ts">
import { computed, ref } from "vue";
import { t } from "@situate/localization";
import { SituateButton, SituateIcon } from "@situate/ui";
import {
  referenceKey,
  type ContentReference,
} from "../../files/content-reference";

const props = defineProps<{
  references: ContentReference[];
  scope: string;
  linked?: boolean;
}>();
const emit = defineEmits<{ open: [reference: ContentReference] }>();
const visibleCount = ref(10);
const files = computed(() =>
  props.references.filter((file) => file.workspaceId === props.scope),
);
</script>

<template>
  <div v-if="files.length" class="imported-files">
    <ul :aria-label="t(linked ? 'navigation.files' : 'chat.importedFiles')">
      <li
        v-for="file in files.slice(0, visibleCount)"
        :key="referenceKey(file)"
      >
        <SituateButton
          variant="plain"
          class="imported-file"
          :aria-label="t('references.open', { path: file.path })"
          @click="emit('open', file)"
        >
          <SituateIcon name="notes" />
          <span data-localization-content="user">{{ file.path }}</span>
        </SituateButton>
      </li>
    </ul>
    <SituateButton
      v-if="visibleCount < files.length"
      variant="ghost"
      size="small"
      @click="visibleCount += 10"
      >{{ t("chat.showMoreFiles") }}</SituateButton
    >
  </div>
</template>

<style scoped>
ul {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  min-width: 0;
  max-width: 100%;
}
.imported-file {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  min-height: 44px;
  padding: 6px 10px;
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-control);
  background: var(--situate-content-tint, var(--situate-paper));
  color: var(--situate-ink);
  font-size: var(--situate-text-caption);
  text-align: start;
  overflow-wrap: anywhere;
}
.imported-file :deep(svg) {
  width: 16px;
  height: 16px;
}
@media (hover: hover) {
  .imported-file:hover span {
    text-decoration: underline;
  }
}
</style>
