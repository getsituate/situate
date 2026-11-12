<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  SituateBadge,
  SituateButton,
  SituateCheckbox,
  SituateDialog,
  SituateDialogActions,
  SituateEmptyState,
  SituateField,
  SituateIcon,
  SituateIconButton,
  SituateInput,
  SituateNotice,
  SituatePanel,
  SituateRadio,
  SituateResizeHandle,
  SituateScrollbars,
  SituateSelect,
  SituateTextarea,
  SituateMenu,
  SituatePopover,
  SituateSwitch,
  SituateFilterChip,
  SituateDisclosure,
  SituateTooltip,
  SituateProgress,
} from "../ui";
import { icons, type IconName } from "../ui/icons";
import c from "../localization/en.components.json";
import fieldCopy from "../localization/en.field-feedback.json";
import FieldFeedbackExamples from "./FieldFeedbackExamples.vue";
import type { ComponentLibraryState } from "./model";

const props = defineProps<{ state: ComponentLibraryState }>();
const emit = defineEmits<{ patch: [patch: Partial<ComponentLibraryState>] }>();
const dialog = ref<InstanceType<typeof SituateDialog>>();
const menuTrigger = ref<InstanceType<typeof SituateButton>>();
const popoverTrigger = ref<InstanceType<typeof SituateButton>>();
const chipRegion = ref<HTMLElement>();
watch(
  () => props.state.chipVisible,
  async () => {
    const restore = chipRegion.value?.contains(document.activeElement);
    await nextTick();
    if (restore) chipRegion.value?.querySelector("button")?.focus();
  },
);
const disabled = computed(() => props.state.status === "disabled");
const busy = computed(() => props.state.status === "loading");
const tones = ["neutral", "info", "success", "warning", "danger"] as const;
const iconNames = Object.keys(icons) as IconName[];
const noticeTone = computed(() =>
  props.state.status === "error"
    ? "danger"
    : props.state.status === "success"
      ? "success"
      : "info",
);
watch(disabled, (value) => {
  if (value) emit("patch", { menuOpen: false, popoverOpen: false });
});
function action() {
  emit("patch", { actions: props.state.actions + 1 });
}
function save() {
  emit("patch", { status: props.state.name.trim() ? "loading" : "error" });
}
function openDialog(event: MouseEvent) {
  (event.currentTarget as HTMLElement).focus();
  emit("patch", { dialogOpen: true, dialogSaved: false });
}
watch([dialog, () => props.state.dialogOpen], async ([element, open]) => {
  await nextTick();
  if (open) element?.showModal();
  else element?.close();
});
</script>

<template>
  <main class="component-library" :class="{ compact: state.compact }">
    <header class="library-header">
      <h1>{{ c.title }}</h1>
      <p>{{ c.description }}</p>
      <nav :aria-label="c.navigation">
        <a
          v-for="(label, group) in c.groups"
          :key="group"
          :href="`#library-${group}`"
          >{{ label }}</a
        >
      </nav>
    </header>

    <section id="library-actions" :aria-labelledby="'actions-heading'">
      <h2 id="actions-heading">{{ c.groups.actions }}</h2>
      <div class="library-example">
        <article data-component="SituateButton">
          <h3>SituateButton</h3>
          <div class="example-row">
            <SituateButton :disabled="disabled" :busy="busy" @click="save">{{
              busy ? c.saving : state.longLabels ? c.saveLong : c.save
            }}</SituateButton>
            <SituateButton
              variant="secondary"
              :disabled="disabled"
              @click="action"
              >{{ c.cancel }}</SituateButton
            >
            <SituateButton
              variant="ghost"
              :disabled="disabled"
              @click="action"
              >{{ c.more }}</SituateButton
            >
            <SituateButton
              variant="danger"
              :disabled="disabled"
              @click="action"
              >{{ c.remove }}</SituateButton
            >
            <SituateButton
              variant="plain"
              class="plain-example"
              :disabled="disabled"
              @click="action"
              >{{ c.plainAction }}</SituateButton
            >
            <SituateButton
              size="small"
              variant="secondary"
              :disabled="disabled"
              @click="action"
              >{{ c.smallAction }}</SituateButton
            >
          </div>
        </article>
        <article data-component="SituateIconButton">
          <h3>SituateIconButton</h3>
          <div class="example-row">
            <SituateIconButton
              icon="plus"
              :label="c.iconAction"
              :disabled="disabled"
              :unavailable-reason="c.notice.disabled"
              @click="action"
            />
            <SituateIconButton
              icon="plus"
              variant="primary"
              :label="c.iconAction"
              :disabled="disabled"
              :unavailable-reason="c.notice.disabled"
              @click="action"
            />
            <output>{{ c.actionCount }}: {{ state.actions }}</output>
          </div>
        </article>
        <article data-component="SituateMenu">
          <h3>SituateMenu</h3>
          <SituateButton
            ref="menuTrigger"
            variant="secondary"
            :disabled="disabled"
            aria-haspopup="menu"
            :aria-expanded="state.menuOpen"
            aria-controls="example-menu"
            popovertarget="example-menu"
            @click.prevent="emit('patch', { menuOpen: !state.menuOpen })"
            >{{ c.menu }}</SituateButton
          >
          <SituateMenu
            id="example-menu"
            :label="c.menu"
            :open="state.menuOpen"
            :anchor="menuTrigger?.element"
            @close="emit('patch', { menuOpen: false })"
          >
            <SituateButton
              variant="plain"
              role="menuitem"
              tabindex="-1"
              @click="action"
              >{{ state.longLabels ? c.menuAddLong : c.menuAdd }}</SituateButton
            >
            <SituateButton
              variant="plain"
              role="menuitemcheckbox"
              tabindex="-1"
              :aria-checked="state.pinned"
              @click="emit('patch', { pinned: !state.pinned })"
              ><span aria-hidden="true">{{ state.pinned ? "✓" : "" }}</span
              >{{ c.menuPin }}</SituateButton
            >
            <SituateButton
              variant="plain"
              role="menuitem"
              tabindex="-1"
              disabled
              >{{ c.menuUnavailable }}</SituateButton
            >
          </SituateMenu>
        </article>
        <article data-component="SituatePopover">
          <h3>SituatePopover</h3>
          <SituateButton
            ref="popoverTrigger"
            variant="secondary"
            :disabled="disabled"
            :aria-expanded="state.popoverOpen"
            aria-controls="example-popover"
            aria-haspopup="dialog"
            popovertarget="example-popover"
            @click.prevent="emit('patch', { popoverOpen: !state.popoverOpen })"
            >{{ c.popover }}</SituateButton
          >
          <SituatePopover
            id="example-popover"
            :label="c.popover"
            :open="state.popoverOpen"
            :anchor="popoverTrigger?.element"
            @close="emit('patch', { popoverOpen: false })"
          >
            <div class="popover-example">
              <h4>{{ c.sampleTitle }}</h4>
              <p>
                {{ state.longLabels ? c.sampleLongNote : c.panelDescription }}
              </p>
              <SituateButton
                variant="secondary"
                @click="emit('patch', { popoverOpen: false })"
                >{{ c.popoverClose }}</SituateButton
              >
            </div>
          </SituatePopover>
        </article>
        <article data-component="SituateIcon">
          <h3>SituateIcon</h3>
          <ul class="icon-examples" :aria-label="c.iconLabel">
            <li v-for="name in iconNames" :key="name">
              <SituateIcon :name="name" /><span>{{ name }}</span>
            </li>
          </ul>
        </article>
      </div>
    </section>

    <section id="library-fields" aria-labelledby="fields-heading">
      <h2 id="fields-heading">{{ c.groups.fields }}</h2>
      <div class="library-example field-examples">
        <article data-component="SituateField">
          <h3>SituateField</h3>
          <h4>{{ fieldCopy.title }}</h4>
          <FieldFeedbackExamples
            :compact="state.compact"
            :long-labels="state.longLabels"
          />
          <SituateField
            id="example-name"
            :label="c.name"
            :help="c.nameHelp"
            :error="
              state.status === 'error' && !state.name.trim()
                ? c.nameError
                : undefined
            "
            v-slot="{ controlAttrs }"
          >
            <SituateInput
              v-bind="controlAttrs"
              :model-value="state.name"
              :disabled="disabled || busy"
              @update:model-value="emit('patch', { name: String($event) })"
            />
          </SituateField>
        </article>
        <article data-component="SituateInput">
          <h3>SituateInput</h3>
          <SituateField
            id="example-search"
            :label="c.search"
            v-slot="{ controlAttrs }"
          >
            <SituateInput
              v-bind="controlAttrs"
              type="search"
              :placeholder="c.searchHint"
              :model-value="state.search"
              :disabled="disabled"
              @update:model-value="emit('patch', { search: String($event) })"
            />
          </SituateField>
        </article>
        <article data-component="SituateTextarea">
          <h3>SituateTextarea</h3>
          <SituateField
            id="example-notes"
            :label="c.notes"
            :help="c.notesHelp"
            v-slot="{ controlAttrs }"
          >
            <SituateTextarea
              v-bind="controlAttrs"
              rows="3"
              :model-value="state.notes"
              :disabled="disabled || busy"
              @update:model-value="emit('patch', { notes: String($event) })"
            />
          </SituateField>
        </article>
        <article data-component="SituateSwitch">
          <h3>SituateSwitch</h3>
          <label class="choice-example choice-example--switch"
            ><SituateSwitch
              :model-value="state.reminders"
              :disabled="disabled"
              @update:model-value="emit('patch', { reminders: $event })"
            />{{ state.longLabels ? c.remindersLong : c.reminders }}</label
          >
        </article>
        <article ref="chipRegion" data-component="SituateFilterChip">
          <h3>SituateFilterChip</h3>
          <SituateFilterChip
            v-if="state.chipVisible"
            :remove-label="c.removeFilter"
            :disabled="disabled"
            @remove="emit('patch', { chipVisible: false })"
            >{{
              state.longLabels ? c.filterTagLong : c.filterTag
            }}</SituateFilterChip
          >
          <SituateButton
            v-else
            variant="secondary"
            :disabled="disabled"
            @click="emit('patch', { chipVisible: true })"
            >{{ c.restoreFilter }}</SituateButton
          >
        </article>
        <article data-component="SituateCheckbox">
          <h3>SituateCheckbox</h3>
          <label class="choice-example"
            ><SituateCheckbox
              :model-value="state.includeArchived"
              :disabled="disabled"
              @update:model-value="emit('patch', { includeArchived: $event })"
            />{{ state.longLabels ? c.checkedLong : c.checked }}</label
          >
        </article>
        <article data-component="SituateRadio">
          <h3>SituateRadio</h3>
          <fieldset>
            <legend>{{ c.radioLegend }}</legend>
            <label class="choice-example"
              ><SituateRadio
                name="example-order"
                value="newest"
                :model-value="state.order"
                :disabled="disabled"
                @update:model-value="emit('patch', { order: String($event) })"
              />{{ c.newest }}</label
            >
            <label class="choice-example"
              ><SituateRadio
                name="example-order"
                value="oldest"
                :model-value="state.order"
                :disabled="disabled"
                @update:model-value="emit('patch', { order: String($event) })"
              />{{ c.oldest }}</label
            >
          </fieldset>
        </article>
        <article data-component="SituateSelect">
          <h3>SituateSelect</h3>
          <SituateField
            id="example-collection"
            :label="c.selectLabel"
            v-slot="{ controlAttrs }"
          >
            <SituateSelect
              v-bind="controlAttrs"
              :value="state.collection"
              :disabled="disabled"
              @change="
                emit('patch', {
                  collection: ($event.target as HTMLSelectElement).value,
                })
              "
            >
              <option
                v-for="(label, value) in c.collections"
                :key="value"
                :value="value"
                :disabled="value === 'archive'"
              >
                {{ label }}
              </option>
            </SituateSelect>
          </SituateField>
        </article>
      </div>
    </section>

    <section id="library-feedback" aria-labelledby="feedback-heading">
      <h2 id="feedback-heading">{{ c.groups.feedback }}</h2>
      <div class="library-example">
        <article data-component="SituateTooltip">
          <h3>SituateTooltip</h3>
          <SituateTooltip
            :text="state.longLabels ? c.sampleLongNote : c.tooltip"
            v-slot="{ triggerAttrs }"
          >
            <SituateButton
              v-bind="triggerAttrs"
              variant="secondary"
              :disabled="disabled"
              >{{ c.tooltipTrigger }}</SituateButton
            >
          </SituateTooltip>
        </article>
        <article data-component="SituateProgress">
          <h3>SituateProgress</h3>
          <p>
            {{
              busy
                ? c.progressPending
                : state.status === "success"
                  ? c.progressComplete
                  : c.progressCount
            }}
          </p>
          <SituateProgress
            :label="c.progress"
            :value="busy ? null : state.status === 'success' ? 5 : 3"
            :max="5"
          />
        </article>
        <article data-component="SituateBadge">
          <h3>SituateBadge</h3>
          <div class="example-row">
            <SituateBadge v-for="tone in tones" :key="tone" :tone="tone">{{
              c.badge[tone]
            }}</SituateBadge>
          </div>
        </article>
        <article data-component="SituateNotice">
          <h3>SituateNotice</h3>
          <SituateNotice
            :tone="noticeTone"
            :role="state.status === 'error' ? 'alert' : 'status'"
          >
            {{ c.notice[state.status] }}
            <SituateButton
              v-if="state.status === 'error'"
              size="small"
              variant="secondary"
              @click="emit('patch', { status: 'loading' })"
              >{{ c.retry }}</SituateButton
            >
          </SituateNotice>
        </article>
        <article data-component="SituateEmptyState">
          <h3>SituateEmptyState</h3>
          <SituateEmptyState :description="c.emptyDescription">
            <template #title
              ><h4>{{ c.emptyTitle }}</h4></template
            >
            <template #actions
              ><SituateButton
                :disabled="disabled"
                variant="secondary"
                @click="
                  emit('patch', {
                    status: 'ready',
                    name: c.sampleTitle,
                    notes: c.sampleNote,
                  })
                "
                >{{ c.newNote }}</SituateButton
              ></template
            >
          </SituateEmptyState>
        </article>
      </div>
    </section>

    <section id="library-layout" aria-labelledby="layout-heading">
      <h2 id="layout-heading">{{ c.groups.layout }}</h2>
      <div class="library-example">
        <article data-component="SituateDisclosure">
          <h3>SituateDisclosure</h3>
          <SituateDisclosure
            :label="state.longLabels ? c.disclosureLong : c.disclosure"
            :open="state.disclosureOpen"
            @update:open="emit('patch', { disclosureOpen: $event })"
          >
            <p>
              {{ state.longLabels ? c.sampleLongNote : c.panelDescription }}
            </p>
          </SituateDisclosure>
        </article>
        <article data-component="SituatePanel">
          <h3>SituatePanel</h3>
          <SituatePanel>
            <h4>{{ state.longLabels ? c.sampleLongTitle : c.panelHeading }}</h4>
            <p>
              {{ state.longLabels ? c.sampleLongNote : c.panelDescription }}
            </p>
          </SituatePanel>
        </article>
        <article data-component="SituateDialog">
          <h3>SituateDialog</h3>
          <SituateButton
            variant="secondary"
            :disabled="disabled"
            @click="openDialog"
            >{{ c.dialogOpen }}</SituateButton
          >
          <p v-if="state.dialogSaved" role="status">{{ c.dialogSaved }}</p>
          <SituateDialog
            ref="dialog"
            appearance="default"
            aria-labelledby="example-dialog-heading"
            aria-describedby="example-dialog-description"
            @close="emit('patch', { dialogOpen: false })"
          >
            <template #header>
              <h2 id="example-dialog-heading">
                {{ state.longLabels ? c.sampleLongTitle : c.dialogTitle }}
              </h2>
            </template>
            <p id="example-dialog-description">
              {{ state.longLabels ? c.sampleLongNote : c.dialogDescription }}
            </p>
            <section>
              <h3>{{ c.dialogSection }}</h3>
              <p>{{ state.longLabels ? c.sampleLongNote : c.sampleNote }}</p>
            </section>
            <p data-dialog-help>{{ c.dialogHelp }}</p>
            <SituateDialogActions data-component="SituateDialogActions">
              <SituateButton
                variant="secondary"
                autofocus
                @click="emit('patch', { dialogOpen: false })"
                >{{ c.cancel }}</SituateButton
              >
              <SituateButton
                @click="emit('patch', { dialogOpen: false, dialogSaved: true })"
                >{{ c.dialogConfirm }}</SituateButton
              >
            </SituateDialogActions>
          </SituateDialog>
        </article>
        <article data-component="SituateScrollbars">
          <h3>SituateScrollbars</h3>
          <div class="scroll-frame" data-component="SituateResizeHandle">
            <h3>SituateResizeHandle</h3>
            <SituateScrollbars>
              <div
                id="example-scroll"
                class="scroll-example"
                role="region"
                tabindex="0"
                :aria-label="c.scrollLabel"
                :style="{ height: `${state.height}px` }"
              >
                <SituateEmptyState
                  v-if="state.status === 'empty'"
                  :description="c.emptyDescription"
                  ><template #title
                    ><h4>{{ c.emptyTitle }}</h4></template
                  ></SituateEmptyState
                >
                <ul v-else>
                  <li v-for="index in 12" :key="index">
                    <strong>{{ c.item }} {{ index }}</strong>
                    <p>
                      {{ state.longLabels ? c.sampleLongNote : c.sampleNote }}
                    </p>
                  </li>
                </ul>
              </div>
            </SituateScrollbars>
            <SituateResizeHandle
              :model-value="state.height"
              :min="96"
              :max="280"
              :reset-value="160"
              orientation="horizontal"
              :label="c.resizeLabel"
              controls="example-scroll"
              @update:model-value="emit('patch', { height: $event })"
            />
          </div>
          <p class="resize-help">{{ c.resizeHelp }}</p>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.component-library {
  height: 100%;
  overflow: auto;
  padding: clamp(16px, 4vw, 40px);
  color: var(--situate-ink);
  background: var(--situate-paper);
  container-type: inline-size;
}
.popover-example {
  padding: var(--situate-space-3);
  min-width: 0;
}
.library-header,
.component-library > section {
  max-width: 960px;
  margin-inline: auto;
}
h1 {
  margin: 0;
  font-size: clamp(26px, 4vw, 36px);
  line-height: 1.2;
}
.component-library > section > h2 {
  margin: 0 0 20px;
  font-size: 22px;
}
.library-example > article > h3 {
  margin: 0 0 14px;
  font: 500 13px/1.5 var(--situate-font-mono, monospace);
  color: var(--situate-muted);
  overflow-wrap: anywhere;
}
h4 {
  margin: 0;
  font-size: 18px;
}
p {
  line-height: 1.6;
  overflow-wrap: anywhere;
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-block: 20px;
}
nav a {
  min-height: 44px;
  align-content: center;
  color: var(--situate-ink);
  text-underline-offset: 4px;
}
.component-library > section {
  border-top: 1px solid var(--situate-line);
  padding-block: 28px;
  scroll-margin-top: 20px;
}
.library-example {
  width: 100%;
  min-width: 0;
}
.compact .library-example {
  max-width: 280px;
}
article {
  min-width: 0;
  margin-bottom: 28px;
}
article:last-child {
  margin-bottom: 0;
}
.example-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.example-row > * {
  max-width: 100%;
  overflow-wrap: anywhere;
}
.plain-example {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 4px;
  min-height: 44px;
  cursor: pointer;
}
.icon-examples {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
  gap: 16px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.icon-examples li {
  display: grid;
  justify-items: center;
  gap: 8px;
  font-size: 11px;
}
.icon-examples svg {
  width: 24px;
  height: 24px;
}
.field-examples {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 28px;
}
.field-examples article {
  margin: 0;
}
.field-examples article[data-component="SituateField"] {
  grid-column: 1 / -1;
}
.choice-example {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 44px;
  padding-block: 10px;
  line-height: 1.5;
}
.choice-example input {
  margin-top: 3px;
  flex-shrink: 0;
}
.choice-example--switch {
  align-items: center;
}
.choice-example--switch input {
  margin-top: 0;
}
fieldset {
  min-width: 0;
  padding: 0;
  border: 0;
  margin: 0;
}
legend {
  margin-bottom: 8px;
}
.scroll-frame {
  position: relative;
}
.scroll-example {
  overflow: auto;
  border: 1px solid var(--situate-control-line);
  border-radius: 12px;
  background: var(--situate-surface);
  padding: 16px;
}
.scroll-example ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.scroll-example li + li {
  border-top: 1px solid var(--situate-line);
  padding-top: 12px;
}
.resize-help {
  margin-top: 20px;
  font-size: 13px;
  color: var(--situate-muted);
}
a:focus-visible,
.plain-example:focus-visible,
.scroll-example:focus-visible {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
</style>
