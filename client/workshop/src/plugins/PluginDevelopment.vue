<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import ChatComposer from "../components/ChatComposer.vue";
import ChatPaneHeader from "../components/ChatPaneHeader.vue";
import EditorDialog from "../editor/EditorDialog.vue";
import { SituateIcon, SituateIconButton, SituateButton } from "../ui";
import AssignmentFiles from "./AssignmentFiles.vue";
import ChatTranscript from "../chat/ChatTranscript.vue";
import { developmentTranscript } from "./development-transcript";
import NavigationGreeting from "../navigation/NavigationGreeting.vue";
import ChatWorkingIndicator from "../components/ChatWorkingIndicator.vue";
import { c } from "./content";
import {
  clonePluginState,
  currentDevelopment,
  developmentWorking,
  sendPluginRequest,
  type PluginState,
} from "./model";
const props = defineProps<{
  state: PluginState;
  navigationId?: string;
  navigationOpen?: boolean;
  showNavigation?: boolean;
}>();
const emit = defineEmits<{
  "update:state": [state: PluginState];
  openNavigation: [event: MouseEvent];
  close: [];
  access: [id: string];
}>();
const d = computed(() => currentDevelopment(props.state)!);
const transcript = computed(() => developmentTranscript(d.value));
const accessNeeded = computed(() =>
  d.value.packages.filter(
    (p) =>
      p.access === "needed" && ["active", "unchanged"].includes(p.activation),
  ),
);
const root = ref<HTMLElement>();
const header = ref<InstanceType<typeof ChatPaneHeader>>();
const composer = ref<InstanceType<typeof ChatComposer>>();
const assignmentFiles = ref<InstanceType<typeof AssignmentFiles>>();
const toggle = ref<InstanceType<typeof SituateButton>>();
const thread = ref<HTMLElement>();
const narrow = ref(false);
const compact = ref(false);
const helpOpen = ref(false);
const helpStyle = ref<Record<string, string>>({});
function placeHelp() {
  const box = root.value?.getBoundingClientRect();
  if (!box || !root.value?.offsetWidth) return;
  const scale = box.width / root.value.offsetWidth;
  helpStyle.value = {
    transform: "translate(-50%, -50%)",
    left: `${(box.left + box.width / 2) / scale}px`,
    top: `${(box.top + box.height / 2) / scale}px`,
    width: `${Math.min(520, box.width / scale - 32)}px`,
    maxHeight: `${Math.max(0, box.height / scale - 32)}px`,
  };
}
function helpKeyboard(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const targets = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      'button, [tabindex="0"]',
    ),
  ];
  const first = targets[0];
  const last = targets.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
function openHelp(event: MouseEvent) {
  (event.currentTarget as HTMLElement).focus();
  placeHelp();
  helpOpen.value = true;
}
const id = useId();
const filesVisible = computed(() =>
  narrow.value ? d.value.panel === "files" : d.value.filesOpen,
);
let observer: ResizeObserver | undefined;
function update(fn: (s: PluginState) => void) {
  const s = clonePluginState(props.state);
  fn(s);
  emit("update:state", s);
}
function panel(value: "chat" | "files") {
  if (d.value.panel !== value)
    update((s) => {
      currentDevelopment(s)!.panel = value;
    });
}
async function showFiles() {
  update((s) => {
    const current = currentDevelopment(s)!;
    current.filesOpen = true;
    current.panel = "files";
  });
  await nextTick();
  assignmentFiles.value?.focusTitle();
}
async function closeFiles() {
  update((s) => {
    const current = currentDevelopment(s)!;
    current.filesOpen = false;
    current.panel = "chat";
  });
  await nextTick();
  toggle.value?.element?.focus();
}
async function send() {
  update(sendPluginRequest);
  await nextTick();
  composer.value?.focus();
  if (thread.value) thread.value.scrollTop = thread.value.scrollHeight;
}
watch(
  () => [d.value.messages.length, d.value.phase],
  async () => {
    const el = thread.value;
    const nearEnd =
      el && el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    await nextTick();
    if (nearEnd && el) el.scrollTop = el.scrollHeight;
  },
);
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    narrow.value = entry.contentRect.width <= 840;
    compact.value = entry.contentRect.height < 540;
    if (helpOpen.value) placeHelp();
  });
  observer.observe(root.value!);
  header.value?.focusTitle();
});
onBeforeUnmount(() => observer?.disconnect());
defineExpose({ focusTitle: () => header.value?.focusTitle() });
</script>
<template>
  <main
    ref="root"
    class="plugin-development"
    :class="{ compact }"
    :aria-labelledby="`${id}-title`"
  >
    <ChatPaneHeader
      ref="header"
      :title="d.title"
      :title-id="`${id}-title`"
      :context="c.development"
    >
      <template #context-actions>
        <SituateIconButton
          class="development-help-trigger"
          icon="info"
          :label="c.developmentHelp"
          aria-haspopup="dialog"
          :aria-expanded="helpOpen"
          :aria-controls="helpOpen ? `${id}-help` : undefined"
          @click="openHelp"
        />
      </template>
      <template #navigation>
        <SituateIconButton
          v-if="showNavigation"
          icon="menu"
          :label="c.openNavigation"
          :aria-controls="navigationId"
          :aria-expanded="navigationOpen"
          @click="emit('openNavigation', $event)"
        />
      </template>
      <SituateButton
        variant="plain"
        ref="toggle"
        class="development-files-toggle"
        :aria-label="c.assignment.files"
        :title="c.assignment.files"
        :aria-expanded="filesVisible"
        :aria-controls="`${id}-files`"
        @click="filesVisible ? closeFiles() : showFiles()"
      >
        <SituateIcon name="notes" />
      </SituateButton>
      <SituateIconButton
        icon="close"
        :label="c.closeDevelopment"
        :title="c.closeHelp"
        @click="emit('close')"
      />
    </ChatPaneHeader>
    <div
      class="development-layout"
      :class="{
        'files-open': d.filesOpen,
        'changes-expanded': d.filesOpen && d.inspection.expanded,
        'plugin-show-files': d.panel === 'files',
      }"
    >
      <section
        class="plugin-conversation"
        :class="{ 'is-empty': !d.messages.length }"
        :aria-label="c.chat"
        @focusin="panel('chat')"
      >
        <div
          ref="thread"
          class="conversation-scroll"
          tabindex="0"
          :aria-label="c.chat"
        >
          <div v-if="!d.messages.length" class="development-welcome">
            <NavigationGreeting
              active
              :covered="
                helpOpen || !!navigationOpen || (narrow && filesVisible)
              "
              :text="c.developmentWelcome"
            />
          </div>
          <div
            v-else
            class="conversation-messages"
            aria-live="polite"
            aria-relevant="additions text"
          >
            <ChatTranscript :events="transcript" />
            <div class="development-next-actions">
              <SituateButton
                variant="secondary"
                size="small"
                @click="showFiles"
                >{{ c.assignment.reviewChanges }}</SituateButton
              >
              <SituateButton
                v-for="item in accessNeeded"
                :key="item.id"
                variant="secondary"
                size="small"
                @click="emit('access', item.id)"
                >{{
                  c.assignment.setupConnection.replace("{name}", item.name)
                }}</SituateButton
              >
            </div>
          </div>
        </div>
        <div class="development-composer-dock">
          <ChatComposer
            ref="composer"
            compact
            :model-value="d.draft"
            :readonly="false"
            :enabled="!developmentWorking(d)"
            :label="c.request"
            :placeholder="c.requestPlaceholder"
            :send-label="d.phase === 'interrupted' ? c.continue : c.send"
            :unavailable-reason="c.requestPending"
            @update:model-value="
              (value) =>
                update((s) => {
                  currentDevelopment(s)!.draft = value;
                })
            "
            @send="send"
          />
          <ChatWorkingIndicator
            v-if="developmentWorking(d)"
            :comment="c.phases[d.phase]"
            :covered="helpOpen || !!navigationOpen || (narrow && filesVisible)"
          />
        </div>
      </section>
      <aside
        :id="`${id}-files`"
        class="plugin-files"
        :aria-label="c.assignment.files"
        @focusin="panel('files')"
        @keydown.esc.stop.prevent="closeFiles"
      >
        <AssignmentFiles
          ref="assignmentFiles"
          :state="d.inspection"
          :allow-expand="!narrow"
          @update:state="
            (inspection) =>
              update((s) => {
                currentDevelopment(s)!.inspection = inspection;
              })
          "
        />
      </aside>
    </div>
    <EditorDialog
      v-if="helpOpen"
      :id="`${id}-help`"
      class="development-help"
      :style="helpStyle"
      :title="c.developmentHelp"
      @close="helpOpen = false"
      @keydown="helpKeyboard"
    >
      <div
        class="development-help-body"
        tabindex="0"
        role="region"
        :aria-label="c.developmentHelp"
      >
        <p>{{ c.developmentHelpIntro }}</p>
        <ol>
          <li v-for="step in c.developmentHelpSteps" :key="step">{{ step }}</li>
        </ol>
        <p>{{ c.developmentHelpLeaving }}</p>
        <h3>{{ c.developmentHelpCopy }}</h3>
        <p>{{ c.scope }}</p>
        <p>{{ c.developmentHelpSafety }}</p>
      </div>
    </EditorDialog>
  </main>
</template>
<style scoped>
.plugin-development {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  container: development / inline-size;
  background: color-mix(
    in srgb,
    var(--situate-accent-soft, var(--situate-lilac)) 45%,
    var(--situate-surface)
  );
}
.development-files-toggle {
  display: grid;
  place-items: center;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  padding: 10px;
  border: 0;
  border-radius: var(--situate-radius-control);
  color: var(--situate-muted);
  background: transparent;
}
.development-files-toggle[aria-expanded="true"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.development-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.development-layout.files-open {
  grid-template-columns: minmax(0, 1fr) clamp(320px, 34%, 440px);
}
.development-layout.changes-expanded {
  grid-template-columns: minmax(0, 1fr);
}
.changes-expanded .plugin-conversation {
  display: none;
}
.plugin-conversation {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.conversation-scroll {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.conversation-messages {
  max-width: 752px;
  margin-inline: auto;
  padding: 32px 32px 40px;
}
.development-next-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.development-composer-dock {
  flex-shrink: 0;
  padding: 12px 28px
    max(22px, var(--app-safe-area-bottom, env(safe-area-inset-bottom, 0px)));
}
.development-composer-dock .chat-composer,
.development-composer-dock .bend-status {
  max-width: 688px;
  margin: 0 auto;
}
.development-help {
  position: fixed;
  inset: auto;
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
}
.development-help-trigger :deep(svg) {
  width: 18px;
  height: 18px;
}
.development-help :deep(header) {
  position: sticky;
  top: -24px;
  background: var(--situate-surface);
  padding-block: 8px;
}
.development-help ol {
  margin-block: 20px;
}
.development-help ol {
  padding-inline-start: 24px;
}
.development-help li + li {
  margin-top: 16px;
}
.is-empty {
  overflow-y: auto;
}
.is-empty .conversation-scroll {
  flex: 0 0 auto;
  margin-top: auto;
  overflow: visible;
  padding-bottom: 28px;
}
.is-empty .development-composer-dock {
  margin-bottom: auto;
  padding-bottom: 32px;
}
.development-welcome {
  max-width: 640px;
  margin-inline: auto;
  padding-inline: 24px;
}
.plugin-files {
  display: none;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-inline-start: 1px solid var(--situate-line);
  background: var(--situate-surface);
}
.files-open .plugin-files {
  display: flex;
}
.development-files-empty {
  padding: 16px 24px;
  font-size: 14px;
  color: var(--situate-muted);
}
:is(button, summary, [tabindex]):focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.compact .development-welcome :deep(.welcome-bend) {
  display: none;
}
.compact .conversation-scroll {
  padding-block: 16px;
}
.compact .development-welcome :deep(h2) {
  font-size: 28px;
}
@container development (max-width: 840px) {
  .development-layout.files-open {
    grid-template-columns: minmax(0, 1fr);
  }
  .plugin-files,
  .files-open .plugin-files {
    display: none;
    border: 0;
  }
  .plugin-show-files .plugin-files {
    display: flex;
  }
  .plugin-show-files .plugin-conversation {
    display: none;
  }
}
@container development (max-width: 540px) {
  .conversation-messages {
    padding: 24px 18px;
  }
  .development-composer-dock {
    padding: 10px 16px 16px;
  }
}
</style>
