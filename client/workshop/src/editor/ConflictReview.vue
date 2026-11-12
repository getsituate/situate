<script setup lang="ts">
import { SituateButton, SituateDialog, SituateRadio } from "../ui";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import {
  beginConflictOperation,
  chooseConflict,
  conflictStatus,
  type ConflictChoice,
} from "./conflicts";
import type { EditorState } from "./model";
import { useEditorState } from "./use-editor-state";
const props = defineProps<{ state: EditorState }>();
const emit = defineEmits<{
  "update:state": [state: EditorState];
  resolved: [];
}>();
const { state, update } = useEditorState(props, emit);
const c = computed(() => state.value.conflict!);
const dialog = ref<InstanceType<typeof SituateDialog>>(),
  heading = ref<HTMLElement>(),
  review = ref<InstanceType<typeof SituateButton>>(),
  apply = ref<InstanceType<typeof SituateButton>>();
const titleId = useId();
const bytes = (text: string) => new TextEncoder().encode(text).length;
const choices: ConflictChoice[] = ["editor", "file"];
const name = (choice: ConflictChoice) =>
  choice === "editor" ? "Editor text" : "Changed file";
const busy = computed(() =>
  ["applying", "refreshing"].includes(c.value.status),
);
const blocked = computed(() => busy.value || c.value.status === "stale");
const file = computed(() =>
  state.value.files.find((file) => file.key === c.value.fileKey),
);
function dismiss() {
  update((next) => {
    next.conflict!.open = false;
  });
}
function scroll(choice: ConflictChoice, event: Event) {
  const top = (event.target as HTMLElement).scrollTop;
  if (!c.value.open) return;
  update((next) => {
    next.conflict!.scroll[choice] = top;
  });
}
function restoreScroll() {
  for (const choice of choices) {
    const element = dialog.value?.element?.querySelector<HTMLElement>(
      `[data-source="${choice}"]`,
    );
    if (element) element.scrollTop = c.value.scroll[choice];
  }
}
function keyboard(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const elements = [
    ...dialog.value!.element!.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), pre",
    ),
  ].filter((el) => el.getClientRects().length && !el.matches(":disabled"));
  const first = elements[0],
    last = elements.at(-1);
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === heading.value)
  ) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
function place() {
  const bounds = dialog.value?.element?.parentElement?.getBoundingClientRect();
  if (!bounds?.width || !dialog.value?.element) return;
  const inset = bounds.width > 650 ? 16 : 0;
  Object.assign(dialog.value?.element.style, {
    left: `${bounds.left + inset}px`,
    top: `${bounds.top + inset}px`,
    width: `${bounds.width - inset * 2}px`,
    height: `${bounds.height - inset * 2}px`,
    maxHeight: "none",
    transform: "none",
  });
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  place();
  if (c.value.open) {
    dialog.value?.element?.showModal();
    heading.value?.focus();
    restoreScroll();
  }
  if (
    typeof ResizeObserver !== "undefined" &&
    dialog.value?.element?.parentElement
  ) {
    observer = new ResizeObserver(place);
    observer.observe(dialog.value?.element.parentElement);
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  dialog.value?.element?.close();
});
watch(
  () => c.value.open,
  async (open, previous) => {
    if (open) {
      dialog.value?.element?.showModal();
      await nextTick();
      place();
      restoreScroll();
      heading.value?.focus();
    } else {
      dialog.value?.element?.close();
      await nextTick();
      if (c.value.status === "resolved") {
        if (previous) emit("resolved");
      } else review.value?.element?.focus();
    }
  },
);
watch(
  () => c.value.status,
  async (status, previous) => {
    await nextTick();
    if (!c.value.open) return;
    if (status === "failed") apply.value?.element?.focus();
    if (previous === "refreshing" && status === "unresolved") {
      restoreScroll();
      heading.value?.focus();
    }
  },
);
watch(
  () => c.value.inspect,
  async () => {
    await nextTick();
    restoreScroll();
  },
);
</script>
<template>
  <div
    v-if="!c.open && (c.status !== 'resolved' || c.message)"
    class="conflict-retained"
  >
    <p role="status">{{ conflictStatus(c) }}</p>
    <SituateButton
      variant="secondary"
      size="small"
      v-if="c.status !== 'resolved'"
      ref="review"
      @click="
        update((next) => {
          next.conflict!.open = true;
        })
      "
    >
      Review versions
    </SituateButton>
  </div>
  <SituateDialog
    ref="dialog"
    class="conflict-review"
    :aria-labelledby="titleId"
    @cancel.prevent="dismiss"
    @keydown="keyboard"
  >
    <div class="conflict-layout">
      <header>
        <div class="title-row">
          <h2 :id="titleId" ref="heading" tabindex="-1" data-dialog-title>
            Review versions
          </h2>
          <SituateButton
            variant="plain"
            aria-label="Close version review"
            @click="dismiss"
            >×</SituateButton
          >
        </div>
        <strong>{{ file?.name }}</strong>
        <p class="path">{{ file?.folder }}</p>
        <p>
          The file changed while you were editing. Review both complete sources
          before choosing one version.
        </p>
      </header>
      <div v-if="c.message" class="notice">
        <p>{{ c.message }}</p>
        <SituateButton
          variant="secondary"
          size="small"
          v-if="c.status === 'stale'"
          @click="update((next) => beginConflictOperation(next, 'refresh'))"
        >
          Refresh versions
        </SituateButton>
      </div>
      <div class="inspect-switch">
        <SituateButton
          variant="plain"
          v-for="choice in choices"
          :key="choice"
          :aria-pressed="c.inspect === choice"
          @click="
            update((next) => {
              next.conflict!.inspect = choice;
            })
          "
        >
          Inspect {{ name(choice).toLowerCase() }}
        </SituateButton>
      </div>
      <div class="candidates" :data-inspect="c.inspect" :aria-busy="busy">
        <section
          v-for="choice in choices"
          :key="choice"
          class="candidate"
          :data-candidate="choice"
        >
          <header>
            <h3>{{ name(choice) }}</h3>
            <p data-dialog-help>
              {{
                choice === "editor"
                  ? "Not yet saved"
                  : `Copy ${c.visibleRevision}`
              }}
              · {{ c[choice].split("\n").length }} lines ·
              {{ bytes(c[choice]) }} bytes
            </p>
          </header>
          <pre
            data-dialog-document
            :data-source="choice"
            :aria-label="name(choice) + ' complete source'"
            tabindex="0"
            @scroll="scroll(choice, $event)"
            >{{ c[choice] }}</pre>
          <small data-dialog-help
            >End of {{ name(choice).toLowerCase() }}</small
          >
        </section>
      </div>
      <footer>
        <fieldset :disabled="blocked">
          <legend>Choose one whole version</legend>
          <label v-for="choice in choices" :key="choice"
            ><SituateRadio
              appearance="plain"
              type="radio"
              :name="titleId + '-version'"
              :value="choice"
              :checked="c.selected === choice"
              @change="update((next) => chooseConflict(next, choice))"
            />Use {{ name(choice).toLowerCase() }}</label
          >
        </fieldset>
        <p>
          {{ c.selected ? name(c.selected) : "The chosen version" }} will
          replace the entire file, including metadata. Changes only in
          {{
            c.selected === "editor"
              ? "the changed file"
              : c.selected === "file"
                ? "the editor text"
                : "the other version"
          }}
          will not be included.
        </p>
        <p role="status">{{ conflictStatus(c) }}</p>
        <div class="actions">
          <SituateButton variant="secondary" size="small" @click="dismiss">
            {{ busy ? "Hide for now" : "Decide later" }}</SituateButton
          ><SituateButton
            variant="primary"
            size="small"
            ref="apply"
            :disabled="!c.selected || blocked"
            @click="update((next) => beginConflictOperation(next, 'apply'))"
          >
            {{
              c.status === "applying"
                ? "Saving…"
                : c.status === "failed"
                  ? "Retry selected version"
                  : "Apply selected version"
            }}
          </SituateButton>
        </div>
      </footer>
    </div>
  </SituateDialog>
</template>
<style scoped>
.conflict-review {
  position: fixed;
  inset: auto;
  margin: 0;
  max-width: none;
  max-height: none;
  padding: 0;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-dialog);
  color: var(--situate-ink);
  background: var(--situate-surface);
  container-type: inline-size;
}
.conflict-review::backdrop {
  background: #30203e60;
}
.conflict-layout {
  height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
header,
footer {
  padding: 16px 24px;
}
.title-row,
.actions,
.conflict-retained {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h2,
h3,
p {
  margin: 0;
}
.path {
  color: var(--situate-muted);
  overflow-wrap: anywhere;
}
button:not(:where(.situate-button)) {
  font: inherit;
  color: inherit;
  background: var(--situate-surface);
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-control);
  padding: 8px 12px;
  min-height: 44px;
  cursor: pointer;
}
button:not(:where(.situate-button)):disabled {
  opacity: 0.6;
  cursor: default;
}
button[aria-pressed="true"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.candidates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 0 24px;
  flex: 1;
  min-height: 200px;
}
.candidate {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--situate-control-line);
  border-radius: 8px;
  overflow: hidden;
}
.candidate header {
  padding: 8px 12px;
  background: var(--situate-paper);
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow: auto;
  flex: 1;
  min-height: 60px;
  margin: 0;
  padding: 12px;
  font: 0.875rem/1.65 var(--situate-font-mono);
}
small {
  padding: 4px 12px;
}
fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  border: 0;
  padding: 0;
  margin: 0;
}
legend {
  font-weight: 600;
}
label {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 44px;
}
input {
  width: 20px;
  height: 20px;
}
footer p {
  margin: 8px 0;
  font-size: 0.875rem;
}
.actions {
  justify-content: flex-end;
}
.notice,
.conflict-retained {
  background: var(--situate-note);
  padding: 12px 24px;
}
.notice {
  margin-bottom: 12px;
}
.conflict-retained p {
  margin: 0;
}
.inspect-switch {
  display: none;
}
@container (max-width: 650px) {
  header,
  footer {
    padding: 12px 16px;
  }
  .candidates {
    display: flex;
    padding: 0 16px;
  }
  .candidate {
    width: 100%;
  }
  .candidates[data-inspect="editor"] [data-candidate="file"],
  .candidates[data-inspect="file"] [data-candidate="editor"] {
    display: none;
  }
  .inspect-switch {
    display: flex;
    gap: 8px;
    padding: 0 16px 12px;
  }
  .inspect-switch button:not(:where(.situate-button)) {
    flex: 1;
  }
  .actions {
    flex-wrap: wrap;
  }
}
</style>
