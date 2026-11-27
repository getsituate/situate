<script setup lang="ts">
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import { computed, useId } from "vue";
import {
  SituateButton,
  SituateDialog,
  SituateIcon,
  SituateIconButton,
} from "../ui";
import { c } from "./content";
import receipt from "./assets/office-receipt.svg";
import { clone, startDocumentAction, type DocumentsState } from "./model";
const props = defineProps<{ state: DocumentsState }>();
const errorId = useId();
const emit = defineEmits<{
  change: [state: DocumentsState];
  close: [];
  source: [id: string];
}>();
const doc = computed(() =>
  props.state.documents.find((d) => d.id === props.state.selected)!,
);
const source = computed(() =>
  props.state.sources.find((s) => s.id === doc.value.source)!,
);
const canOpenExternal = computed(
  () => !source.value.paused && doc.value.availability === "available",
);
const openingExternal = computed(
  () => props.state.opening?.kind === "open-external",
);
function update(fn: (s: DocumentsState) => void) {
  const s = clone(props.state);
  fn(s);
  emit("change", s);
}
function openExternal() {
  if (props.state.opening) return;
  update((s) => startDocumentAction(s, "open-external", doc.value.id));
}
function dismissExternalError() {
  update((s) => {
    s.externalError = false;
  });
}
</script>
<template>
  <section class="doc-preview" :aria-label="c.preview">
    <header class="doc-preview-heading">
      <SituateButton
        variant="ghost"
        size="small"
        type="button"
        class="doc-text doc-preview-back"
        :aria-label="c.back"
        @click="emit('close')"
      >
        ‹ {{ c.back }}
      </SituateButton>
      <div class="doc-preview-title-row">
        <div class="doc-preview-identity">
          <h2 tabindex="-1" data-document-heading>{{ doc.title }}</h2>
          <p>{{ source.name }} · {{ doc.type }}</p>
        </div>
        <SituateButton
          v-if="canOpenExternal"
          class="doc-open-external"
          variant="secondary"
          size="small"
          :title="!openingExternal ? c.openExternal : undefined"
          :aria-label="!openingExternal ? c.openExternal : undefined"
          :aria-disabled="!!state.opening || undefined"
          @click="openExternal"
        >
          {{ openingExternal ? c.openingExternal : c.open }}
          <SituateIcon name="external" />
        </SituateButton>
        <SituateIconButton
          class="doc-preview-close"
          icon="close"
          :label="c.closePreview"
          @click="emit('close')"
        />
      </div>
      <div role="status" class="sr-only">
        {{ state.notice === "external" ? c.externalOpened : "" }}
      </div>
    </header>
    <div class="doc-preview-scroll">
      <div v-if="source.paused" class="doc-empty" role="status">
        <p>{{ c.sourcePaused }}</p>
        <SituateButton
          variant="ghost"
          size="small"
          class="doc-text"
          @click="emit('source', doc.source)"
        >
          {{ c.reviewSources }}
        </SituateButton>
      </div>
      <template v-else-if="doc.availability !== 'available'">
        <div class="doc-unavailable" role="status">
          <span class="doc-file-emblem" aria-hidden="true">{{ doc.type }}</span>
          <h3>
            {{
              doc.availability === "other-device" ? c.otherDevice : c.offline
            }}
          </h3>
          <p>
            {{
              doc.availability === "other-device"
                ? c.otherDeviceHelp
                : c.offlineHelp
            }}
          </p>
          <SituateButton
            variant="ghost"
            size="small"
            type="button"
            class="doc-text"
            @click="emit('source', doc.source)"
          >
            {{ c.reviewSources }}
          </SituateButton>
        </div>
      </template>
      <p
        v-else-if="state.preview === 'loading'"
        class="doc-empty"
        role="status"
      >
        {{ c.opening }}
      </p>
      <div v-else-if="state.preview === 'error'" class="doc-empty" role="alert">
        <p>{{ c.openFailed }}</p>
        <SituateButton
          variant="secondary"
          size="small"
          :disabled="!!state.opening"
          @click="update((s) => startDocumentAction(s, 'open', doc.id))"
        >
          {{ c.retry }}
        </SituateButton>
      </div>
      <div v-else-if="doc.type === 'Spreadsheet'" class="doc-empty">
        <span class="doc-file-emblem" aria-hidden="true">XLSX</span>
        <p>{{ doc.filename }}</p>
      </div>
      <template v-else>
        <div class="doc-page-tools">
          <template v-if="doc.type === 'PDF'">
            <SituateButton
              variant="plain"
              :aria-label="c.previousPage"
              :disabled="state.page === 0"
              @click="
                update((s) => {
                  s.page--;
                })
              "
            >
              ‹
            </SituateButton>
            <span>{{ state.page + 1 }} / {{ doc.pages.length }}</span>
            <SituateButton
              variant="plain"
              :aria-label="c.nextPage"
              :disabled="state.page >= doc.pages.length - 1"
              @click="
                update((s) => {
                  s.page++;
                })
              "
            >
              ›
            </SituateButton>
          </template>
          <SituateButton
            variant="plain"
            :aria-label="c.zoomOut"
            :disabled="state.zoom <= 80"
            @click="
              update((s) => {
                s.zoom -= 20;
              })
            "
          >
            −
          </SituateButton>
          <span>{{ state.zoom }}%</span>
          <SituateButton
            variant="plain"
            :aria-label="c.zoomIn"
            :disabled="state.zoom >= 160"
            @click="
              update((s) => {
                s.zoom += 20;
              })
            "
          >
            +
          </SituateButton>
        </div>
        <div class="doc-page-stage">
          <img
            v-if="doc.type === 'Image'"
            :src="receipt"
            :alt="doc.pages[0]"
            :style="{ width: `${state.zoom}%` }"
          />
          <article
            v-else
            class="doc-paper"
            :style="{ fontSize: `${state.zoom * 0.14}px` }"
            :aria-label="`${doc.title} · ${state.page + 1}`"
          >
            <div class="doc-paper-mark" aria-hidden="true"></div>
            <p
              v-for="(line, index) in doc.pages[state.page]?.split('\n')"
              :key="index"
              :class="{ 'doc-paper-title': index === 0 }"
            >
              {{ line || "\u00a0" }}
            </p>
          </article>
        </div>
      </template>
      <section class="doc-metadata">
        <SituateDisclosure open>
          <template #label>{{ c.details }}</template>
          <dl>
            <dt>{{ c.original }}</dt>
            <dd>{{ doc.filename }}</dd>
            <dt>{{ c.source }}</dt>
            <dd>{{ source.name }}</dd>
            <template v-if="doc.folder"
              ><dt>{{ c.folder }}</dt>
              <dd>{{ doc.folder.replaceAll("/", " / ") }}</dd></template
            >
            <dt>{{ c.lastChecked }}</dt>
            <dd>{{ source.checked }}</dd>
            <dt>{{ c.sourceMetadata }}</dt>
            <dd>{{ doc.metadata }}</dd>
          </dl>
          <p v-if="source.status === 'error'" class="doc-warning">
            {{ c.stale }}
          </p>
        </SituateDisclosure>
      </section>
    </div>
    <SituateDialog
      :open="state.externalError"
      :aria-labelledby="`${errorId}-title`"
      :aria-describedby="`${errorId}-message`"
      @cancel.prevent="dismissExternalError"
    >
      <template #header>
        <h2 :id="`${errorId}-title`">{{ c.externalFailed }}</h2>
      </template>
      <p :id="`${errorId}-message`">{{ c.externalFailedHelp }}</p>
      <template #actions>
        <SituateButton
          variant="secondary"
          autofocus
          @click="dismissExternalError"
        >
          {{ c.close }}
        </SituateButton>
      </template>
    </SituateDialog>
  </section>
</template>
