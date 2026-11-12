<script setup lang="ts">
import { SituateInput, SituateButton } from "../ui";
import { computed, nextTick, ref } from "vue";
import { useDialogFocus } from "./use-dialog-focus";
import EditorDialog from "../editor/EditorDialog.vue";
import SituateSelect from "../ui/SituateSelect.vue";
import { clone, tagPath, type DocumentsState } from "./model";
import { createTag } from "./tags";
import { c } from "./content";
const props = defineProps<{ state: DocumentsState }>();
const emit = defineEmits<{ change: [state: DocumentsState] }>();
const form = ref<HTMLFormElement>();
useDialogFocus(form);
const draft = computed(() => props.state.tagCreation!);
const error = computed(() =>
  draft.value.error
    ? {
        name: c.tagNameRequired,
        duplicate: c.tagNameDuplicate,
        parent: c.tagParentMissing,
        document: c.tagDocumentMissing,
      }[draft.value.error]
    : "",
);
function update(fn: (s: DocumentsState) => void) {
  const state = clone(props.state);
  fn(state);
  emit("change", state);
}
function cancel() {
  update((s) => {
    s.tagCreation = null;
  });
}
async function submit() {
  let created: string | null = null;
  update((s) => {
    created = createTag(s);
  });
  if (!created) {
    await nextTick();
    form.value
      ?.querySelector<HTMLElement>(
        props.state.tagCreation?.error === "parent"
          ? "#doc-new-tag-parent"
          : "#doc-new-tag-name",
      )
      ?.focus();
  }
}
</script>
<template>
  <EditorDialog
    :title="c.newTag"
    class="doc-dialog doc-tag-create"
    @close="cancel"
  >
    <form ref="form" novalidate @submit.prevent="submit">
      <p>{{ draft.documentId ? c.newDocumentTagHelp : c.newTagHelp }}</p>
      <label for="doc-new-tag-name">{{ c.tagName }}</label>
      <SituateInput
        id="doc-new-tag-name"
        autofocus
        required
        :value="draft.name"
        :aria-invalid="
          draft.error === 'name' || draft.error === 'duplicate' || undefined
        "
        :aria-describedby="draft.error ? 'doc-new-tag-error' : undefined"
        @input="
          update((s) => {
            s.tagCreation!.name = ($event.target as HTMLInputElement).value;
            s.tagCreation!.error = null;
          })
        "
      />
      <label for="doc-new-tag-parent">{{ c.parentTag }}</label>
      <SituateSelect
        id="doc-new-tag-parent"
        :value="draft.parent ?? ''"
        :aria-invalid="draft.error === 'parent' || undefined"
        :aria-describedby="draft.error ? 'doc-new-tag-error' : undefined"
        @change="
          update((s) => {
            s.tagCreation!.parent =
              ($event.target as HTMLSelectElement).value || null;
            s.tagCreation!.error = null;
          })
        "
      >
        <option value="">{{ c.noParentTag }}</option>
        <option v-for="tag in state.tags" :key="tag.id" :value="tag.id">
          {{ tagPath(state.tags, tag.id) }}
        </option>
      </SituateSelect>
      <p v-if="error" id="doc-new-tag-error" role="alert" class="doc-warning">
        {{ error }}
      </p>
      <div class="doc-dialog-actions">
        <SituateButton variant="primary" size="small" type="submit">
          {{ c.createTag }}
        </SituateButton>
        <SituateButton
          variant="ghost"
          size="small"
          type="button"
          class="doc-text"
          @click="cancel"
        >
          {{ c.cancel }}
        </SituateButton>
      </div>
    </form>
  </EditorDialog>
</template>
