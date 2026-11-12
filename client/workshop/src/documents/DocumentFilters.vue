<script setup lang="ts">
import SituateFilterChip from "../ui/SituateFilterChip.vue";
import { computed, nextTick, ref } from "vue";
import SituateSelect from "../ui/SituateSelect.vue";
import { c } from "./content";
import {
  clone,
  filterTagName,
  tagPath,
  type DocumentsState,
  type TagFilter,
} from "./model";
import {
  addFilterTag,
  clearUntaggedFilter,
  removeFilterTag,
  setFilterOperator,
} from "./filters";
const props = defineProps<{ state: DocumentsState }>();
const emit = defineEmits<{ change: [state: DocumentsState] }>();
const root = ref<HTMLElement>();
async function clearUntagged() {
  update(clearUntaggedFilter);
  await nextTick();
  const target =
    root.value?.querySelector<HTMLButtonElement>(
      "#doc-add-tag:not(:disabled)",
    ) ??
    root.value?.querySelector<HTMLButtonElement>("[data-remove-tag]") ??
    root.value
      ?.closest(".documents-view")
      ?.querySelector<HTMLInputElement>("#doc-query");
  target?.focus();
}
function label(id: string) {
  return filterTagName(props.state, id);
}
const choices = computed(() =>
  props.state.tags.filter((t) => !props.state.filter.tags.includes(t.id)),
);
function update(fn: (state: DocumentsState) => void) {
  const state = clone(props.state);
  fn(state);
  emit("change", state);
}
async function add(event: Event) {
  const field = event.target as HTMLSelectElement;
  if (field.value) update((s) => addFilterTag(s, field.value));
  field.value = "";
  await nextTick();
  if (!choices.value.length) {
    const buttons =
      root.value?.querySelectorAll<HTMLButtonElement>("[data-remove-tag]");
    buttons?.[buttons.length - 1]?.focus();
  }
}
async function remove(id: string) {
  const index = props.state.filter.tags.indexOf(id);
  update((s) => removeFilterTag(s, id));
  await nextTick();
  const buttons =
    root.value?.querySelectorAll<HTMLButtonElement>("[data-remove-tag]");
  const target =
    buttons?.[Math.min(index, buttons.length - 1)] ??
    root.value?.querySelector<HTMLButtonElement>("#doc-add-tag");
  target?.focus();
}
</script>
<template>
  <section ref="root" class="doc-inline-filters" :aria-label="c.filterTitle">
    <SituateFilterChip
      v-if="state.untagged"
      class="doc-removable-chip"
      data-constraint="untagged"
      :remove-label="c.clearTag"
      :aria-description="c.noTags"
      @remove="clearUntagged"
    >
      {{ c.noTags }}
    </SituateFilterChip>
    <div v-if="state.filter.tags.length" class="doc-tag-selection">
      <SituateFilterChip
        v-for="id in state.filter.tags"
        :key="id"
        class="doc-removable-chip"
        data-remove-tag
        :remove-label="c.removeFilterTag(label(id))"
        @remove="remove(id)"
      >
        {{ label(id) }}
      </SituateFilterChip>
    </div>
    <SituateSelect
      id="doc-add-tag"
      appearance="toolbar"
      class="doc-add-tag"
      :aria-label="c.addTags"
      value=""
      :disabled="!choices.length"
      @change="add"
    >
      <option value="" disabled>
        {{ choices.length ? c.addTags : c.allTagsSelected }}
      </option>
      <option v-for="tag in choices" :key="tag.id" :value="tag.id">
        {{ tagPath(state.tags, tag.id) }}
      </option>
    </SituateSelect>
    <div v-if="state.filter.tags.length" class="doc-tag-match">
      <label for="doc-tag-match" class="sr-only">{{ c.documentsWith }}</label>
      <SituateSelect
        id="doc-tag-match"
        appearance="toolbar"
        :value="state.filter.operator"
        @change="
          update((s) =>
            setFilterOperator(
              s,
              ($event.target as HTMLSelectElement)
                .value as TagFilter['operator'],
            ),
          )
        "
      >
        <option value="any">{{ c.matchAnyTag }}</option>
        <option value="all">{{ c.matchAllTags }}</option>
      </SituateSelect>
    </div>
    <slot />
  </section>
</template>
