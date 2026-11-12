<script setup lang="ts">
import { SituateCheckbox, SituateButton } from "../ui";
import { computed } from "vue";
import EditorDialog from "../editor/EditorDialog.vue";
import { clone, filterTagName, tagPath, type DocumentsState } from "./model";
import { deleteTag, tagDeletionImpact } from "./tag-deletion";
import { c } from "./content";
const props = defineProps<{ state: DocumentsState }>();
const emit = defineEmits<{
  change: [state: DocumentsState];
  closed: [focusTag: string | null];
}>();
const impact = computed(() => tagDeletionImpact(props.state));
const error = computed(() =>
  !impact.value.target
    ? c.deletionMissing
    : impact.value.collisions.length
      ? c.deletionCollision(
          impact.value.collisions.map((tag) => tag.name).join(", "),
        )
      : "",
);
function update(fn: (s: DocumentsState) => void) {
  const s = clone(props.state);
  fn(s);
  emit("change", s);
}
function cancel() {
  const id = props.state.tagDeletion?.id ?? null;
  update((s) => {
    s.tagDeletion = null;
  });
  emit("closed", id);
}
function submit() {
  const index = props.state.tags.findIndex(
    (tag) => tag.id === impact.value.target?.id,
  );
  const survivors = props.state.tags.filter(
    (tag) => !impact.value.removed.has(tag.id),
  );
  const focus = survivors[Math.min(index, survivors.length - 1)]?.id ?? null;
  const s = clone(props.state);
  if (deleteTag(s)) {
    emit("change", s);
    emit("closed", focus);
  } else emit("change", s);
}
</script>
<template>
  <EditorDialog
    :title="c.deleteTagTitle"
    class="doc-dialog doc-tag-delete"
    focus-close
    @close="cancel"
  >
    <form @submit.prevent="submit">
      <p class="doc-delete-subject">
        <strong>{{ filterTagName(state, state.tagDeletion!.id) }}</strong>
      </p>
      <div class="doc-delete-body">
        <p v-if="error" role="alert" class="doc-warning">{{ error }}</p>
        <label v-if="impact.descendants.size" class="doc-check">
          <SituateCheckbox
            type="checkbox"
            :checked="state.tagDeletion!.descendants"
            @change="
              update((s) => {
                s.tagDeletion!.descendants = (
                  $event.target as HTMLInputElement
                ).checked;
                s.tagDeletion!.error = null;
              })
            "
          />
          {{ c.deleteSubtags(impact.descendants.size) }}
        </label>
        <p v-if="impact.descendants.size && !state.tagDeletion!.descendants">
          {{
            c.keepSubtags(
              impact.target?.parent
                ? tagPath(state.tags, impact.target.parent)
                : c.topLevel,
            )
          }}
        </p>
        <dl class="doc-delete-impact">
          <div>
            <dt>{{ c.tagsToDelete }}</dt>
            <dd>{{ impact.removed.size }}</dd>
          </div>
          <div>
            <dt>{{ c.documentsLosingTags }}</dt>
            <dd>{{ impact.documents.length }}</dd>
          </div>
        </dl>
      </div>
      <div class="doc-dialog-actions">
        <SituateButton
          variant="danger"
          size="small"
          type="submit"
          :disabled="!!error"
        >
          {{ state.tagDeletion!.descendants ? c.deleteBranch : c.deleteTag }}
        </SituateButton>
      </div>
    </form>
  </EditorDialog>
</template>
