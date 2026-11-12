<script setup lang="ts">
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import { SituateSelect, SituateCheckbox, SituateButton } from "../ui";
import { computed } from "vue";
import { c, dc } from "./content";
import { clone, finishDocumentAction, type DocumentsState } from "./model";
const props = defineProps<{
  state: DocumentsState;
  collectionVisible: boolean;
  sourceMode?: boolean;
}>();
const emit = defineEmits<{ "update:state": [state: DocumentsState] }>();
function update(fn: (s: DocumentsState) => void) {
  const s = clone(props.state);
  fn(s);
  emit("update:state", s);
}
const overlay = computed(
  () =>
    !!(
      props.state.dialog ||
      props.state.tagCreation ||
      props.state.tagMenu ||
      props.state.collectionMenu ||
      props.state.tagDeletion
    ),
);
function value(event: Event) {
  return (event.target as HTMLSelectElement).value;
}
</script>
<template>
  <div class="document-controls">
    <p>{{ dc.proposal }}</p>
    <p v-if="state.tagCreation">{{ dc.tagCreation }}</p>
    <p v-if="state.tagMenu || state.tagDeletion">{{ dc.tagDeletion }}</p>
    <template v-if="!sourceMode && !overlay">
      <label for="document-layout">{{ dc.layouts }}</label>
      <SituateSelect
        id="document-layout"
        :value="state.layout"
        @change="
          update((s) => {
            s.layout = value($event) as DocumentsState['layout'];
          })
        "
      >
        <option value="library">{{ dc.library }}</option>
        <option value="focused">{{ dc.focused }}</option>
      </SituateSelect>
      <template v-if="collectionVisible">
        <label for="document-thumbnails">{{ c.thumbnails }}</label>
        <SituateSelect
          id="document-thumbnails"
          :value="state.thumbnailMode"
          @change="
            update((s) => {
              s.thumbnailMode = value(
                $event,
              ) as DocumentsState['thumbnailMode'];
            })
          "
        >
          <option value="fixture">{{ c.fixtureThumbnails }}</option>
          <option value="pending">{{ c.pendingThumbnails }}</option>
          <option value="unavailable">{{ c.missingThumbnails }}</option>
          <option value="error">{{ c.failedThumbnails }}</option>
        </SituateSelect>
        <label for="document-search-state">{{ dc.searchState }}</label>
        <SituateSelect
          id="document-search-state"
          :value="state.searchState"
          @change="
            update((s) => {
              s.searchState = value($event) as DocumentsState['searchState'];
            })
          "
        >
          <option value="ready">{{ dc.ready }}</option>
          <option value="loading">{{ dc.loading }}</option>
          <option value="error">{{ dc.error }}</option>
        </SituateSelect>
      </template>
    </template>
    <template
      v-if="
        !overlay &&
        (sourceMode ||
          collectionVisible ||
          state.documents.some(
            (d) => d.id === state.selected && d.availability === 'available',
          ))
      "
    >
      <label for="document-outcome">{{ dc.outcome }}</label>
      <SituateSelect
        id="document-outcome"
        :value="state.nextOutcome"
        @change="
          update((s) => {
            s.nextOutcome = value($event) as DocumentsState['nextOutcome'];
          })
        "
      >
        <option value="success">{{ dc.succeed }}</option>
        <option value="error">{{ dc.fail }}</option>
        <option value="wait">{{ dc.wait }}</option>
      </SituateSelect>
    </template>
    <label v-if="sourceMode" class="document-control-check"
      ><SituateCheckbox
        type="checkbox"
        :checked="state.addOnRefresh"
        @change="
          update((s) => {
            s.addOnRefresh = !s.addOnRefresh;
          })
        "
      />{{ dc.addDocument }}</label
    >
    <div
      v-if="
        !overlay &&
        (sourceMode ? state.pending : state.pending || state.opening)
      "
      class="document-control-actions"
    >
      <SituateButton
        variant="secondary"
        size="small"
        @click="
          update((s) =>
            finishDocumentAction(s, true, sourceMode ? 'source' : undefined),
          )
        "
      >
        {{ dc.complete }}</SituateButton
      ><SituateButton
        variant="secondary"
        size="small"
        @click="
          update((s) =>
            finishDocumentAction(s, false, sourceMode ? 'source' : undefined),
          )
        "
      >
        {{ dc.failAction }}
      </SituateButton>
    </div>
    <SituateDisclosure v-if="!sourceMode">
      <template #label>Walkthroughs and boundaries</template>
      <p>{{ dc.findTask }}</p>
      <p>{{ dc.gatherTask }}</p>
      <p>{{ dc.boundary }}</p>
      <p>
        Both navigation approaches support both tasks. On phones, Browse opens
        tags and saved searches; document reading replaces the list while
        preserving its selection. PDF pages and image receipts are synthetic.
      </p>
      <p>{{ dc.searchBoundary }}</p>
    </SituateDisclosure>
  </div>
</template>
<style scoped>
.document-controls {
  display: grid;
  gap: 12px;
}
.document-controls p {
  font-size: 13px;
  color: var(--situate-muted);
}
.document-controls span:where(.situate-select) {
  width: 100%;
  min-width: 0;
}
.document-control-check {
  display: flex;
  align-items: center;
  gap: 8px;
}
.document-control-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.document-control-actions button {
  min-height: 44px;
}
:deep(summary) {
  min-height: 44px;
  padding-block: 8px;
  cursor: pointer;
}
</style>
