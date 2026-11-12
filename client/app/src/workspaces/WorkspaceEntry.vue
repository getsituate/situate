<script setup lang="ts">
import { t, localizeError, localizeProvidedText } from "@situate/localization";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  ref,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import {
  SituateDialog,
  SituateButton,
  SituateDialogActions,
  SituateIconButton,
  SituateMenu,
  SituateDisclosure,
} from "@situate/ui";
import wordmark from "../../../../design/brand/assets/wordmark.svg";
import bend from "../../../../design/brand/bend/svg/wave-welcome.svg";
import WorkspaceCreateForm from "./WorkspaceCreateForm.vue";
import WorkspaceRow from "./WorkspaceRow.vue";
import {
  displayWorkspaceName,
  type RunAction,
  type Snapshot,
  type Workspace,
} from "./api";
import "./workspace-entry.css";
import { accentStyle, type Accent } from "../settings/accents";
const loadSetupFrame = () => import("../onboarding/SetupFrame.vue");
const SetupFrame = defineAsyncComponent(loadSetupFrame);
const OnboardingWelcome = defineAsyncComponent(
  () => import("../onboarding/OnboardingWelcome.vue"),
);

const props = defineProps<{
  state: Snapshot;
  run: RunAction;
  busy: boolean;
  error: unknown;
  inert?: boolean;
}>();
const emit = defineEmits<{ back: []; opened: []; accent: [accent: Accent] }>();
const creating = ref(false);
const welcome = ref(false);
const motionPaused = ref(false);
const creationAccent = ref<Accent>("violet");
function selectAccent(accent: Accent) {
  creationAccent.value = accent;
  emit("accent", accent);
}
function finishWelcome() {
  welcome.value = false;
}
function focusCreation() {
  document.getElementById("create-title")?.focus({ preventScroll: true });
}
function hideWelcome(element: Element) {
  element.setAttribute("inert", "");
  element.setAttribute("aria-hidden", "true");
}
const removing = ref<Workspace | null>(null);
const confirmationControl = useTemplateRef<InstanceType<typeof SituateDialog>>(
  "confirmationControl",
);
const confirmation = computed(() => confirmationControl.value?.element);
const createButtonControl = useTemplateRef<InstanceType<typeof SituateButton>>(
  "createButtonControl",
);
const createButton = computed(() => createButtonControl.value?.element);
const openingFailure = shallowRef<{
  error: unknown;
  action: "pick" | "open" | "regrant";
  id?: string;
}>();
const openingErrorOpen = ref(false);
const openingErrorId = useId();
watch(
  () => props.error,
  (error) => {
    if (openingFailure.value && error !== openingFailure.value.error) {
      openingErrorOpen.value = false;
      openingFailure.value = undefined;
    }
  },
);
let openOrigin: HTMLElement | null = null;
async function dismissOpeningError(): Promise<void> {
  openingErrorOpen.value = false;
  await nextTick();
  if (openOrigin?.isConnected) openOrigin.focus();
  else createButton.value?.focus();
}
const syncUnavailable = ref(false);
const syncDialogId = useId();
const syncButtonControl =
  useTemplateRef<InstanceType<typeof SituateButton>>("syncButtonControl");
async function dismissSyncUnavailable(): Promise<void> {
  syncUnavailable.value = false;
  await nextTick();
  syncButtonControl.value?.focus();
}
const appMenuOpen = ref(false);
const appMenuId = useId();
const appMenuTrigger =
  useTemplateRef<InstanceType<typeof SituateIconButton>>("appMenuTrigger");
const appMenuFocus = ref<"first" | "last">("first");
function showAppMenu(last = false): void {
  appMenuFocus.value = last ? "last" : "first";
  appMenuOpen.value = true;
}
const rows = new Map<string, InstanceType<typeof WorkspaceRow>>();
const known = computed(() =>
  props.state.known.filter((k) => !props.state.open.some((o) => o.id === k.id)),
);
const empty = computed(
  () => !props.state.known.length && !props.state.open.length,
);
const sections = computed(() =>
  props.state.mobile
    ? [
        {
          id: "open",
          title: t("workspace.openWorkspaces"),
          items: props.state.open,
        },
        {
          id: "known",
          title: t("workspace.yourWorkspaces"),
          items: known.value,
        },
      ].filter((section) => section.items.length)
    : [
        {
          id: "known",
          title: t("workspace.yourWorkspaces"),
          items: [
            ...props.state.known,
            ...props.state.open.filter(
              (o) => !props.state.known.some((k) => k.id === o.id),
            ),
          ],
        },
      ],
);
let removeOrigin: string | null = null;
async function showCreation(): Promise<void> {
  if (props.state.onboardingAvailable) await loadSetupFrame();
  creating.value = true;
  welcome.value = !!props.state.onboardingAvailable;
  motionPaused.value = false;
  creationAccent.value = "violet";
  await nextTick();
  document.getElementById("create-title")?.focus();
}
async function cancelCreation(): Promise<void> {
  creating.value = false;
  welcome.value = false;
  await nextTick();
  createButton.value?.focus();
}
async function open(
  action: "pick" | "open" | "regrant",
  id?: string,
  origin: EventTarget | null = document.activeElement,
): Promise<void> {
  openOrigin = origin instanceof HTMLElement ? origin : null;
  openingErrorOpen.value = false;
  openingFailure.value = undefined;
  if (await props.run(action, id)) {
    creating.value = false;
    emit("opened");
  } else if (props.error) {
    openingFailure.value = { error: props.error, action, id };
    openingErrorOpen.value = true;
  }
}
async function askRemoval(workspace: Workspace): Promise<void> {
  removeOrigin = workspace.id;
  removing.value = workspace;
  await nextTick();
  confirmation.value?.showModal();
}
function cancelRemoval(): void {
  confirmation.value?.close();
  removing.value = null;
  if (removeOrigin) rows.get(removeOrigin)?.focus();
}
async function remove(): Promise<void> {
  if (!removing.value) return;
  const index = sections.value
    .flatMap((section) => section.items)
    .findIndex((item) => item.id === removing.value?.id);
  if (await props.run("remove", removing.value.id)) {
    const id = removing.value.id;
    confirmation.value?.close();
    removing.value = null;
    await nextTick();
    const remaining = sections.value.flatMap((section) => section.items);
    const neighbor = remaining[Math.min(index, remaining.length - 1)];
    const row = rows.get(id) ?? (neighbor ? rows.get(neighbor.id) : undefined);
    if (row) row.focus();
    else createButton.value?.focus();
  }
}
function closeAppMenu(): void {
  appMenuOpen.value = false;
}
function back(): boolean {
  if (openingErrorOpen.value) {
    void dismissOpeningError();
    return true;
  }
  if (syncUnavailable.value) {
    void dismissSyncUnavailable();
    return true;
  }
  if (props.busy) return true;
  if (confirmation.value?.open) {
    cancelRemoval();
    return true;
  }
  if (appMenuOpen.value) {
    closeAppMenu();
    return true;
  }
  for (const row of rows.values()) {
    if (row.back()) return true;
  }
  if (creating.value) {
    void cancelCreation();
    return true;
  }
  if (props.state.current) {
    emit("back");
    return true;
  }
  return false;
}
defineExpose({ back });
</script>

<template>
  <div
    v-if="creating && state.onboardingAvailable"
    class="setup-entry-host"
    :inert="inert || undefined"
    :class="{ 'motion-still': motionPaused }"
  >
    <Transition
      name="setup-entry"
      :duration="{ enter: 640, leave: 360 }"
      @before-leave="hideWelcome"
    >
      <OnboardingWelcome
        v-if="welcome"
        :paused="motionPaused"
        @toggle="motionPaused = !motionPaused"
        @finished="finishWelcome"
      />
      <SetupFrame
        v-else
        class="setup-entry-destination"
        @vue:mounted="focusCreation"
        continuous
        :step="0"
        :paused="motionPaused"
        :style="{
          ...accentStyle(creationAccent),
          '--setup-accent': `var(--situate-${creationAccent === 'violet' ? 'violet-deep' : creationAccent})`,
        }"
        :progress-reveal="1"
        labelledby="create-title"
      >
        <div class="workspace-entry setup-create">
          <WorkspaceCreateForm
            setup
            :run="run"
            :busy="busy"
            :operation-error="openingFailure ? undefined : error"
            @cancel="cancelCreation"
            @opened="
              creating = false;
              emit('opened');
            "
            @open="open('pick', undefined, $event.currentTarget)"
            @accent="selectAccent"
          >
            <template v-if="openingFailure" #operation-error>
              <SituateButton
                variant="secondary"
                @click="openingErrorOpen = true"
              >
                {{ t("workspace.reviewError") }}
              </SituateButton>
            </template>
          </WorkspaceCreateForm>
        </div>
      </SetupFrame>
    </Transition>
  </div>
  <main
    v-else
    class="workspace-entry"
    :inert="inert || undefined"
    :class="{ 'mobile-entry': state.mobile }"
  >
    <div
      class="workspace-window"
      :class="{ 'compact-entry': empty || creating }"
    >
      <header class="entry-titlebar">
        <img
          :src="wordmark"
          :alt="t('navigation.situate')"
          width="110"
          height="34"
        />
        <div class="entry-titlebar-actions">
          <SituateButton
            variant="plain"
            v-if="state.current && !creating"
            type="button"
            class="entry-back"
            :disabled="busy"
            @click="emit('back')"
          >
            {{ t("workspace.back") }}
          </SituateButton>
          <SituateIconButton
            v-if="!state.mobile"
            ref="appMenuTrigger"
            class="entry-app-menu"
            icon="more"
            :label="t('workspace.applicationActions')"
            aria-haspopup="menu"
            :aria-expanded="appMenuOpen"
            :aria-controls="appMenuId"
            :popovertarget="appMenuId"
            @click.prevent="appMenuOpen ? closeAppMenu() : showAppMenu()"
            @keydown.down.prevent="showAppMenu()"
            @keydown.up.prevent="showAppMenu(true)"
          />
          <SituateMenu
            v-if="!state.mobile"
            :id="appMenuId"
            :open="appMenuOpen"
            :anchor="appMenuTrigger?.element"
            :initial-focus="appMenuFocus"
            :label="t('workspace.applicationActions')"
            @close="closeAppMenu"
          >
            <SituateButton
              variant="plain"
              type="button"
              :disabled="busy"
              role="menuitem"
              tabindex="-1"
              @click="run('quit')"
            >
              {{ t("workspace.quitSituate") }}
            </SituateButton>
          </SituateMenu>
        </div>
      </header>
      <div
        v-if="!creating"
        class="entry-layout"
        :class="{ 'without-list': empty }"
      >
        <aside
          v-if="!empty && !creating"
          class="workspace-lists"
          :aria-label="t('workspace.workspacesOnThisDevice')"
        >
          <section
            v-for="section in sections"
            :key="section.id"
            :aria-label="section.title"
          >
            <div class="list-heading">
              <h2>{{ section.title }}</h2>
              <span v-if="!state.mobile">{{
                t("workspace.onThisDevice")
              }}</span>
            </div>
            <ul>
              <WorkspaceRow
                v-for="workspace in section.items"
                :key="workspace.id"
                :ref="
                  (value) => {
                    if (value)
                      rows.set(
                        workspace.id,
                        value as InstanceType<typeof WorkspaceRow>,
                      );
                    else rows.delete(workspace.id);
                  }
                "
                :workspace="workspace"
                :open="state.open.some((o) => o.id === workspace.id)"
                :listed="state.known.some((k) => k.id === workspace.id)"
                :current="state.current?.id === workspace.id"
                :mobile="state.mobile"
                :busy="busy"
                @open="open('open', workspace.id, $event.currentTarget)"
                @close="run('close', workspace.id)"
                @remove="askRemoval(workspace)"
              />
            </ul>
          </section>
        </aside>
        <section class="entry-content" aria-labelledby="entry-title">
          <div class="entry-welcome">
            <div>
              <p class="entry-eyebrow">
                {{ t("workspace.aPlaceForYourOwnWayOfWorking") }}
              </p>
              <h1 id="entry-title">
                {{
                  empty
                    ? t("workspace.welcomeToSituate")
                    : t("workspace.whereWouldYouLikeToBegin")
                }}
              </h1>
              <p>
                {{
                  empty
                    ? t(
                        "workspace.keepYourTasksKnowledgeAndDocumentsTogetherInA",
                      )
                    : t("workspace.returnToAWorkspaceOrMakeRoomForSomething")
                }}
              </p>
            </div>
            <img
              v-if="empty && !error && !state.failures.length"
              :src="bend"
              alt=""
              width="128"
              height="128"
            />
          </div>
          <div
            class="entry-actions"
            :aria-label="t('workspace.workspaceActions')"
          >
            <SituateButton
              variant="plain"
              ref="createButtonControl"
              type="button"
              class="entry-action primary-choice"
              :disabled="busy"
              @click="showCreation"
            >
              <span class="action-icon" aria-hidden="true">＋</span>
              <span
                ><strong>{{ t("workspace.createAWorkspace") }}</strong
                ><small>{{
                  t("workspace.startFreshInANewFolderOnThisDevice")
                }}</small></span
              >
              <span aria-hidden="true">→</span>
            </SituateButton>
            <SituateButton
              variant="plain"
              type="button"
              class="entry-action"
              :disabled="busy"
              @click="open('pick', undefined, $event.currentTarget)"
            >
              <span class="action-icon" aria-hidden="true">↗</span>
              <span
                ><strong>{{ t("workspace.openAWorkspace") }}</strong
                ><small>{{
                  t("workspace.chooseAnExistingSituateWorkspaceFolder")
                }}</small></span
              >
              <span aria-hidden="true">→</span>
            </SituateButton>
            <SituateButton
              variant="plain"
              type="button"
              ref="syncButtonControl"
              class="entry-action sync-choice"
              :disabled="busy"
              aria-haspopup="dialog"
              :aria-controls="syncDialogId"
              :aria-description="t('workspace.syncIsUnavailable')"
              @click="syncUnavailable = true"
            >
              <span class="action-icon" aria-hidden="true">⇄</span>
              <span
                ><strong>{{ t("workspace.bringAWorkspaceFromSync") }}</strong
                ><small>{{
                  t("workspace.makeAnExistingSyncedWorkspaceAvailableHere")
                }}</small></span
              >
              <span aria-hidden="true">→</span>
            </SituateButton>
          </div>
          <SituateButton
            v-if="openingFailure"
            variant="secondary"
            @click="openingErrorOpen = true"
          >
            {{ t("workspace.reviewError") }}
          </SituateButton>
          <p v-else-if="error" role="alert" class="entry-error">
            {{ localizeError(error) }}
          </p>
          <section
            v-if="state.failures.length"
            class="restore-failures"
            :aria-label="t('workspace.workspacesThatNeedAttention')"
          >
            <h2>{{ t("navigation.someWorkspacesCouldntBeReopened") }}</h2>
            <SituateDisclosure :label="t('navigation.review')">
              <div
                v-for="failure in state.failures"
                :key="failure.location.id"
                class="restore-failure"
              >
                <strong data-localization-content="user">{{
                  displayWorkspaceName(failure.location)
                }}</strong>
                <p class="location" data-localization-content="user">
                  {{ localizeProvidedText(failure.location.display) }}
                </p>
                <p>{{ localizeError(failure.message) }}</p>
                <SituateButton
                  variant="secondary"
                  size="small"
                  type="button"
                  :disabled="busy"
                  @click="
                    open('open', failure.location.id, $event.currentTarget)
                  "
                >
                  {{ t("navigation.retry") }}
                </SituateButton>
                <SituateButton
                  variant="secondary"
                  size="small"
                  type="button"
                  :disabled="busy"
                  @click="
                    open('regrant', failure.location.id, $event.currentTarget)
                  "
                >
                  {{ t("workspace.grantAccess") }}
                </SituateButton>
                <SituateButton
                  variant="secondary"
                  size="small"
                  type="button"
                  :disabled="busy"
                  @click="run('close', failure.location.id)"
                >
                  {{ t("workspace.closeWorkspace") }}
                </SituateButton>
              </div>
            </SituateDisclosure>
          </section>
        </section>
      </div>
      <WorkspaceCreateForm
        @accent="emit('accent', $event)"
        v-else
        :run="run"
        :busy="busy"
        :operation-error="openingFailure ? undefined : error"
        @cancel="cancelCreation"
        @open="open('pick', undefined, $event.currentTarget)"
        @opened="
          creating = false;
          emit('opened');
        "
      >
        <template v-if="openingFailure" #operation-error>
          <SituateButton variant="secondary" @click="openingErrorOpen = true">
            {{ t("workspace.reviewError") }}
          </SituateButton>
        </template>
      </WorkspaceCreateForm>
      <p class="operation-status" role="status">
        {{ busy ? t("workspace.working") : "" }}
      </p>
    </div>
    <SituateDialog
      :id="syncDialogId"
      :open="syncUnavailable"
      :aria-labelledby="`${syncDialogId}-title`"
      @cancel.prevent="dismissSyncUnavailable"
    >
      <h2 :id="`${syncDialogId}-title`">
        {{ t("workspace.syncIsUnavailable") }}
      </h2>
      <template #actions>
        <SituateButton
          variant="secondary"
          autofocus
          @click="dismissSyncUnavailable"
        >
          {{ t("workspace.close") }}
        </SituateButton>
      </template>
    </SituateDialog>
    <SituateDialog
      ref="confirmationControl"
      class="removal-dialog"
      aria-labelledby="remove-title"
      aria-describedby="remove-description"
      @cancel.prevent="cancelRemoval"
    >
      <template v-if="removing">
        <h2 id="remove-title">{{ t("workspace.removeFromYourList") }}</h2>
        <p>
          <strong data-localization-content="user">{{
            displayWorkspaceName(removing)
          }}</strong>
        </p>
        <p id="remove-description">
          {{ t("workspace.theWorkspaceFolderAndItsFilesWillNotBe") }}
        </p>
        <p v-if="state.open.some((o) => o.id === removing?.id)">
          {{ t("workspace.thisWorkspaceWillRemainOpen") }}
        </p>
        <p v-if="error" class="entry-error" role="alert">
          {{ localizeError(error) }}
        </p>
        <SituateDialogActions
          ><SituateButton
            variant="secondary"
            type="button"
            autofocus
            :disabled="busy"
            @click="cancelRemoval"
          >
            {{ t("workspace.keepInList") }}
          </SituateButton>
          <SituateButton variant="danger" :disabled="busy" @click="remove">{{
            t("workspace.removeFromList")
          }}</SituateButton>
        </SituateDialogActions>
      </template>
    </SituateDialog>
  </main>
  <SituateDialog
    v-if="openingFailure"
    :open="openingErrorOpen"
    :aria-labelledby="`${openingErrorId}-title`"
    :aria-describedby="`${openingErrorId}-description`"
    @cancel.prevent="dismissOpeningError"
  >
    <template #header>
      <h2 :id="`${openingErrorId}-title`">
        {{ t("workspace.couldntOpenTheWorkspace") }}
      </h2>
    </template>
    <p :id="`${openingErrorId}-description`">
      {{ localizeError(openingFailure.error) }}
    </p>
    <template #actions>
      <SituateButton variant="secondary" autofocus @click="dismissOpeningError">
        {{ t("workspace.close") }}
      </SituateButton>
      <SituateButton
        :disabled="busy"
        @click="open(openingFailure.action, openingFailure.id, openOrigin)"
      >
        {{ t("navigation.retry") }}
      </SituateButton>
    </template>
  </SituateDialog>
</template>

<style scoped>
.setup-entry-host {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--situate-paper);
}
.setup-entry-host > .setup-entry-leave-active {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  transition: opacity 360ms cubic-bezier(0.22, 0.7, 0.25, 1);
}
.setup-entry-leave-to {
  opacity: 0;
}
.setup-entry-enter-active {
  --entry-ease: cubic-bezier(0.22, 0.7, 0.25, 1);
}
.setup-entry-enter-active :deep(.frame-header) {
  animation: entry-settle 360ms var(--entry-ease) both;
}
.setup-entry-enter-active :deep(.progress-reveal) {
  animation: entry-settle 420ms 60ms var(--entry-ease) both;
}
.setup-entry-enter-active :deep(.frame-art) {
  animation: entry-settle 560ms 80ms var(--entry-ease) both;
}
.setup-entry-enter-active :deep(.setup-panel) {
  animation: entry-settle 520ms 120ms var(--entry-ease) both;
}
.setup-entry-destination :deep(.setup-panel:has(input:focus, button:focus)) {
  animation: none;
}
@keyframes entry-settle {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.motion-still .setup-entry-leave-active {
  transition: none;
  opacity: 0;
}
.motion-still .setup-entry-enter-active :deep(*) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  .setup-entry-leave-active {
    transition: none;
    opacity: 0;
  }
  .setup-entry-enter-active :deep(*) {
    animation: none;
  }
}
.setup-entry-host > .setup-entry-destination {
  display: flex;
  flex-direction: column;
  overflow: clip;
}
.setup-entry-destination :deep(.frame-stage) {
  grid-template-rows: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  width: 100%;
}
.setup-entry-host .setup-entry-destination :deep(.setup-panel) {
  height: 100%;
  min-height: 0;
  overflow: clip;
}
.setup-create {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  padding: 0;
  background: transparent;
}
.setup-create :deep(.entry-layout) {
  display: block;
  overflow: auto;
  padding: 6px;
  margin: -6px -6px 0;
}
.setup-create :deep(.creation) {
  padding: 0;
  max-width: none;
}
.setup-create :deep(.creation h1) {
  font-size: clamp(28px, 3vw, 40px);
  line-height: 1.12;
  margin: 8px 0;
}
.setup-create :deep(.entry-eyebrow) {
  color: var(--situate-muted);
}
.setup-create :deep(.appearance-colors) {
  margin: 0 0 8px;
}
.setup-create :deep(.directory-field) {
  margin-bottom: 0;
}
.setup-create :deep(.entry-help) {
  margin-bottom: 12px;
}
.setup-create :deep(.appearance-option) {
  margin: 0;
}
.setup-create :deep(.form-actions) {
  padding: 12px 0 0;
  margin-top: 0;
}
.setup-create :deep(.form-actions .entry-primary) {
  background: var(--setup-accent);
  color: var(--situate-accent-on);
  border-color: var(--situate-ink);
}
.setup-create :deep(.form-actions .entry-primary:disabled) {
  background: var(--situate-muted);
  color: var(--situate-surface);
}
.setup-create
  :deep(
    input:not([type="radio"]):focus:where(
        html:not([data-input-modality="pointer"]) *
      )
  ) {
  outline: var(--situate-stroke-focus) solid var(--situate-ink);
  box-shadow: inset 0 0 0 6px var(--setup-accent);
  outline-offset: var(--situate-focus-offset);
}
@media (max-width: 700px) {
  .setup-entry-destination :deep(.frame-stage) {
    grid-template-rows: auto minmax(0, 1fr);
  }
  .setup-entry-destination :deep(.frame-art) {
    width: min(32vw, 120px);
  }
}
@media (max-height: 500px) {
  .setup-entry-host > .setup-entry-destination {
    padding-block: 12px;
  }
  .setup-entry-destination :deep(.frame-stage) {
    margin-top: 12px;
  }
  .setup-entry-destination :deep(.setup-panel) {
    padding: 12px;
  }
  .setup-entry-destination :deep(.setup-steps) {
    margin-top: 12px;
    padding-bottom: 0;
  }
}
@media (max-width: 700px) and (max-height: 600px) {
  .setup-entry-destination :deep(.frame-stage) {
    grid-template-rows: minmax(0, 1fr);
  }
  .setup-entry-destination :deep(.frame-art) {
    display: none;
  }
}
.setup-create :deep(.path-preview) {
  border-left: 4px solid var(--setup-accent);
  background: color-mix(
    in srgb,
    var(--setup-accent) 10%,
    var(--situate-surface)
  );
}
</style>
