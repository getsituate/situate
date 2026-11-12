<script setup lang="ts">
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import { nextTick, ref } from "vue";
import { c } from "./content";
import { SituateIconButton, SituateButton } from "../ui";
import { browseFilterTag } from "./filters";
import {
  clearSelection,
  clone,
  hasTag,
  openSaved,
  tagPath,
  type DocumentsState,
} from "./model";
const props = defineProps<{ state: DocumentsState }>();
const emit = defineEmits<{
  change: [state: DocumentsState];
  newTag: [event: MouseEvent];
  tagActions: [id: string, event: MouseEvent];
}>();
const navigation = ref<HTMLElement>();
function update(fn: (s: DocumentsState) => void) {
  const s = clone(props.state);
  fn(s);
  s.dialog = null;
  s.selected = null;
  s.opening = null;
  emit("change", s);
}
function browseTag(id: string) {
  update((s) => {
    browseFilterTag(s, id);
  });
}
async function togglePin(id: string) {
  const s = clone(props.state);
  const view = s.saved.find((v) => v.id === id);
  if (view) view.pinned = !view.pinned;
  emit("change", s);
  await nextTick();
  navigation.value?.querySelector<HTMLElement>(`[data-pin="${id}"]`)?.focus();
}
function depth(id: string): number {
  let parent = props.state.tags.find((tag) => tag.id === id)?.parent;
  const visited = new Set<string>();
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    parent = props.state.tags.find((tag) => tag.id === parent)?.parent;
  }
  return visited.size;
}
</script>
<template>
  <nav ref="navigation" class="doc-browse" :aria-label="c.browseTitle">
    <SituateButton
      variant="plain"
      type="button"
      class="doc-nav-item"
      :aria-current="
        !state.untagged && !state.activeSaved && !state.filter.tags.length
          ? 'page'
          : undefined
      "
      @click="update(clearSelection)"
    >
      {{ c.all }}<span>{{ state.documents.length }}</span>
    </SituateButton>
    <section>
      <h2>{{ c.pinned }}</h2>
      <p v-if="!state.saved.some((v) => v.pinned)" class="doc-muted">
        {{ c.noSaved }}
      </p>
      <div
        v-for="view in state.saved.filter((v) => v.pinned)"
        :key="view.id"
        class="doc-saved-row"
      >
        <SituateButton
          variant="plain"
          type="button"
          class="doc-nav-item"
          :aria-current="state.activeSaved === view.id ? 'page' : undefined"
          @click="update((s) => openSaved(s, view.id))"
        >
          <span class="doc-saved-label">{{ view.name }}</span>
        </SituateButton>
        <SituateButton
          variant="plain"
          class="doc-pin-button"
          :data-pin="view.id"
          :aria-label="c.unpinView(view.name)"
          @click="togglePin(view.id)"
        >
          −
        </SituateButton>
      </div>
      <SituateDisclosure
        v-if="state.saved.some((v) => !v.pinned)"
        class="doc-saved-views"
        open
      >
        <template #label>{{ c.saved }}</template>
        <div
          v-for="view in state.saved.filter((v) => !v.pinned)"
          :key="view.id"
          class="doc-saved-row"
        >
          <SituateButton
            variant="plain"
            type="button"
            class="doc-nav-item"
            :aria-current="state.activeSaved === view.id ? 'page' : undefined"
            @click="update((s) => openSaved(s, view.id))"
          >
            <span class="doc-saved-label">{{ view.name }}</span>
          </SituateButton>
          <SituateButton
            variant="plain"
            class="doc-pin-button"
            :data-pin="view.id"
            :aria-label="c.pinView(view.name)"
            @click="togglePin(view.id)"
          >
            ☆
          </SituateButton>
        </div>
      </SituateDisclosure>
    </section>
    <section>
      <div class="doc-tag-heading">
        <h2>{{ c.tags }}</h2>
        <SituateIconButton
          icon="plus"
          :label="c.newTag"
          @click="emit('newTag', $event)"
        />
      </div>
      <p v-if="!state.tags.length" class="doc-muted">{{ c.noWorkspaceTags }}</p>
      <p
        v-if="state.notice === 'tag-created' && state.createdTagId"
        class="doc-muted"
        role="status"
      >
        {{ c.tagCreated(tagPath(state.tags, state.createdTagId)) }}
      </p>
      <div v-for="tag in state.tags" :key="tag.id" class="doc-tag-row">
        <SituateButton
          variant="plain"
          type="button"
          class="doc-nav-item doc-tag-nav"
          :style="{ '--tag-depth': depth(tag.id) }"
          :aria-label="tagPath(state.tags, tag.id)"
          :aria-current="
            state.filter.tags.length === 1 && state.filter.tags[0] === tag.id
              ? 'page'
              : undefined
          "
          @click="browseTag(tag.id)"
        >
          <span class="doc-tag-name">{{ tag.name }}</span
          ><span>{{
            state.documents.filter((d) => hasTag(state, d, tag.id)).length
          }}</span>
        </SituateButton>
        <SituateIconButton
          icon="more"
          :label="c.tagActions(tagPath(state.tags, tag.id))"
          :data-tag-actions="tag.id"
          aria-haspopup="menu"
          :aria-expanded="state.tagMenu?.id === tag.id"
          @click="emit('tagActions', tag.id, $event)"
        />
      </div>
      <SituateButton
        variant="plain"
        type="button"
        class="doc-nav-item"
        :aria-current="state.untagged ? 'page' : undefined"
        @click="browseTag('untagged')"
      >
        {{ c.noTags
        }}<span>{{
          state.documents.filter((d) => !d.tags.length).length
        }}</span>
      </SituateButton>
    </section>
  </nav>
</template>
