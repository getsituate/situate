<script setup lang="ts">
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import { SituateSelect, SituateCheckbox, SituateButton } from "../ui";
import { useId } from "vue";
import { c, dc } from "./content";
import { clone, finishDocumentAction, type DocumentsState } from "./model";
const fieldId = useId();
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
function value(event: Event) {
  return (event.target as HTMLSelectElement).value;
}
</script>
<template>
  <div class="document-controls">
    <p>{{ dc.proposal }}</p>
    <template v-if="!sourceMode && collectionVisible">
      <label for="document-thumbnails">{{ c.thumbnails }}</label>
      <SituateSelect
        id="document-thumbnails"
        :value="state.thumbnailMode"
        @change="
          update((s) => {
            s.thumbnailMode = value($event) as DocumentsState['thumbnailMode'];
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
    <template
      v-if="
        sourceMode ||
        collectionVisible ||
        state.documents.some(
          (d) => d.id === state.selected && d.availability === 'available',
        )
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
    <label
      v-if="sourceMode"
      :for="`${fieldId}-add-document`"
      class="document-control-check"
      ><SituateCheckbox
        :id="`${fieldId}-add-document`"
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
      v-if="sourceMode ? state.pending : state.pending || state.opening"
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
