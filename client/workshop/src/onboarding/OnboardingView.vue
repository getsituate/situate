<script setup lang="ts">
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  SituateButton,
  SituateCheckbox,
  SituateTextarea,
  SituateDialog,
} from "../ui";
import { c } from "./content";
import OnboardingJourney from "./OnboardingJourney.vue";
import BendCompanion from "./BendCompanion.vue";
import SetupFlow from "./SetupFlow.vue";
import SourceConversation from "./SourceConversation.vue";
import { f } from "./flow-content";
import supportCopy from "../localization/en.support-plan.json";
import sourceCopy from "../localization/en.import-preparation.json";
import { c as pluginCopy } from "../plugins/content";
import type { DevelopmentPhase } from "../plugins/model";
import {
  guided,
  type OnboardingAction,
  type OnboardingState,
  type Step,
} from "./model";
const props = defineProps<{
  state: OnboardingState;
  developments: { id: string; title: string; phase: DevelopmentPhase }[];
  embeddedSetup?: boolean;
  showNavigation?: boolean;
  navigationId?: string;
  navigationOpen?: boolean;
}>();
const emit = defineEmits<{
  action: [action: OnboardingAction];
  development: [id: string];
  file: [key: string];
  openNavigation: [event: MouseEvent];
}>();
const act = (action: OnboardingAction) => emit("action", action);
const patch = (patch: Partial<OnboardingState>) =>
  act({ type: "patch", patch });
const go = (step: Step) => patch({ step });
const heading = ref<HTMLElement>();
const result = ref<HTMLElement>();
const hintControl = ref<InstanceType<typeof SituateDialog>>();
const hint = computed(() => hintControl.value?.element);
const scroll = ref<HTMLElement>();
const inspectControl = ref<InstanceType<typeof SituateButton>>();
const inspect = computed(() => inspectControl.value?.element);
const primaryHintControl = ref<InstanceType<typeof SituateButton>>();
const primaryHint = computed(() => primaryHintControl.value?.element);
const isGuided = computed(() => guided(props.state));
const sourceChat = computed(
  () =>
    ["source-chat", "import-chat"].includes(props.state.step) &&
    props.state.sourceConversation.messages.length > 0,
);
const companion = computed(() => props.state.presentation === "companion");
const title = computed(() =>
  companion.value && props.state.connected
    ? ((
        {
          access: c.journey.welcomeHeading,
          method: c.journey.methodHeading,
          sources: c.journey.sourcesHeading,
          proposal: c.journey.proposalHeading,
          samples: c.journey.samplesHeading,
          plan: c.journey.planHeading,
        } as Partial<Record<Step, string>>
      )[props.state.step] ?? c.stages[props.state.step])
    : c.stages[props.state.step],
);
const input = (event: Event) => (event.target as HTMLInputElement).value;
const checked = (event: Event) => (event.target as HTMLInputElement).checked;
let observer: IntersectionObserver | undefined;
let settle: ReturnType<typeof setTimeout> | undefined;
let visible = false;
function considerHint() {
  clearTimeout(settle);
  if (
    !visible ||
    props.state.hintDone ||
    props.state.hintOpen ||
    document.visibilityState !== "visible"
  )
    return;
  settle = setTimeout(() => {
    if (visible && document.visibilityState === "visible")
      act({ type: "visible" });
  }, 180);
}
watch(result, (element) => {
  observer?.disconnect();
  visible = false;
  if (!element || typeof IntersectionObserver === "undefined") return;
  observer = new IntersectionObserver(
    (entries) => {
      visible = entries.some(
        (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.15,
      );
      considerHint();
    },
    { root: scroll.value, threshold: 0.15 },
  );
  observer.observe(element);
});
watch(
  () => props.state.step,
  async () => {
    clearTimeout(settle);
    await nextTick();
    heading.value?.focus({ preventScroll: true });
    if (scroll.value) scroll.value.scrollTop = 0;
  },
);
watch(
  () => props.state.hintOpen,
  async (open) => {
    await nextTick();
    if (open) {
      hint.value?.showModal();
      primaryHint.value?.focus();
    } else {
      hint.value?.close();
      inspect.value?.focus({ preventScroll: true });
    }
  },
);
function dismissHint() {
  act({ type: "dismiss-hint" });
}
onMounted(() => document.addEventListener("visibilitychange", considerHint));
onBeforeUnmount(() => {
  observer?.disconnect();
  clearTimeout(settle);
  document.removeEventListener("visibilitychange", considerHint);
});
</script>

<template>
  <main
    ref="scroll"
    class="onboarding"
    :data-step="state.step"
    :class="{
      guided: isGuided,
      companion,
      'motion-off': state.motionPaused,
      'hint-open': state.hintOpen,
      'embedded-setup': embeddedSetup,
      'source-chat-open': sourceChat,
    }"
    @scroll="considerHint"
  >
    <div class="onboarding-body">
      <OnboardingJourney
        :active="isGuided && companion"
        :embedded="embeddedSetup"
        :state="state"
        @patch="patch"
      >
        <div :key="state.step" class="step-surface">
          <section v-if="state.recovery" class="recovery-notice" role="status">
            <h2>{{ sourceCopy.recoveryTitle }}</h2>
            <p>{{ sourceCopy[state.recovery] }}</p>
            <SituateButton
              v-if="state.connected"
              @click="act({ type: 'dismiss-recovery' })"
              >{{ sourceCopy.dismissRecovery }}</SituateButton
            >
          </section>
          <header v-if="!sourceChat">
            <SituateButton
              variant="plain"
              v-if="showNavigation"
              class="secondary"
              :aria-controls="navigationId"
              :aria-expanded="navigationOpen"
              @click="emit('openNavigation', $event)"
            >
              {{ c.navigation }}
            </SituateButton>
            <p
              v-if="!embeddedSetup && !(companion && isGuided)"
              class="eyebrow"
            >
              {{ isGuided ? c.setup : c.workspace }}
            </p>
            <h1 ref="heading" tabindex="-1">{{ title }}</h1>
          </header>

          <SourceConversation
            v-if="sourceChat"
            :state="state"
            :show-navigation="showNavigation"
            :navigation-id="navigationId"
            :navigation-open="navigationOpen"
            @action="act"
            @open-navigation="emit('openNavigation', $event)"
          />
          <template v-else-if="state.step === 'access'">
            <p class="intro-copy">
              {{
                state.connected
                  ? companion
                    ? c.journey.invitation
                    : c.access
                  : state.recovery === "device"
                    ? sourceCopy.device
                    : c.blocked
              }}
            </p>
            <section v-if="!state.connected" class="notice" role="status">
              <h2>
                {{
                  state.recovery === "device"
                    ? sourceCopy.localAccess
                    : c.blockedTitle
                }}
              </h2>
              <div class="actions">
                <SituateButton @click="act({ type: 'retry' })">{{
                  state.recovery === "device"
                    ? sourceCopy.connectLocal
                    : c.retry
                }}</SituateButton
                ><SituateButton
                  variant="plain"
                  class="secondary"
                  @click="patch({ accessChoice: 'choose' })"
                >
                  {{ c.change }}
                </SituateButton>
              </div>
              <div v-if="state.accessChoice === 'choose'" class="actions">
                <SituateButton
                  variant="plain"
                  class="secondary"
                  @click="patch({ accessChoice: 'own' })"
                >
                  {{ c.own }}</SituateButton
                ><SituateButton
                  variant="plain"
                  class="secondary"
                  @click="patch({ accessChoice: 'managed' })"
                >
                  {{ c.managed }}
                </SituateButton>
              </div>
              <p v-if="state.accessChoice === 'own'">{{ c.accessDetail }}</p>
              <p v-if="state.accessChoice === 'managed'">
                {{ c.managedDetail }}
              </p>
            </section>
            <SituateButton
              v-if="state.connected"
              @click="go(state.resumeStep)"
              >{{
                state.resumeStep === "method" ? c.begin : f.continueSetup
              }}</SituateButton
            >
          </template>

          <SetupFlow
            v-else-if="
              [
                'method',
                'proposal',
                'sources',
                'samples',
                'import-chat',
                'plan',
              ].includes(state.step)
            "
            :state="state"
            @action="act"
            @development="emit('development', $event)"
          />

          <template v-else-if="state.step === 'home'">
            <section
              v-if="companion && state.confirmed && !state.manual"
              class="arrival-welcome"
              :class="{ 'after-finale': state.finale.status !== 'idle' }"
            >
              <div class="arrival-bend">
                <BendCompanion
                  moment="arrive"
                  :paused="state.motionPaused || state.hintOpen"
                  :seen="
                    state.finale.status !== 'idle' ||
                    state.motionSeen.includes('arrive')
                  "
                  @played="
                    patch({
                      motionSeen: [...new Set([...state.motionSeen, 'arrive'])],
                    })
                  "
                />
              </div>
              <div>
                <h2>{{ c.journey.arrival }}</h2>
                <p>{{ c.journey.arrivalDetail }}</p>
              </div>
            </section>
            <SituateDisclosure
              v-if="companion && state.confirmed && state.organization"
              class="arrival-method"
            >
              <template #label>{{ c.workingApproach }}</template>
              <p>{{ state.organization }}</p>
            </SituateDisclosure>
            <p v-if="!state.connected" class="notice" role="status">
              {{ c.aiUnavailable }}
              <SituateButton
                variant="plain"
                class="secondary"
                @click="patch({ step: 'access', resumeStep: 'home' })"
              >
                {{ c.change }}
              </SituateButton>
            </p>
            <section v-if="state.importState !== 'none'" class="plan-section">
              <h2>{{ f.available }}</h2>
              <p v-if="state.imported.length && state.importState !== 'ready'">
                {{ f.partial }}
              </p>
              <p v-if="!state.imported.length">
                {{
                  state.importState === "deferred"
                    ? f.deferredEmpty
                    : ["failed", "blocked", "paused"].includes(
                          state.importState,
                        )
                      ? f.failedEmpty
                      : f.pendingEmpty
                }}
              </p>
              <ul>
                <li v-for="file in state.imported" :key="file.key">
                  <SituateButton
                    variant="plain"
                    class="note-link"
                    @click="emit('file', file.key)"
                  >
                    {{ file.folder }}/{{ file.name }}
                  </SituateButton>
                </li>
              </ul>
              <SituateButton
                variant="plain"
                class="secondary"
                @click="go('import-chat')"
              >
                {{ f.importConversation }}
              </SituateButton>
            </section>
            <div class="arrival-grid">
              <section class="plan-section">
                <h2>{{ c.notes }}</h2>
                <template v-if="state.note"
                  ><SituateButton
                    variant="plain"
                    class="note-link"
                    @click="go('note')"
                  >
                    {{ state.exampleActive ? c.exampleNote : c.openNote }}
                  </SituateButton>
                  <p>{{ state.note }}</p></template
                >
                <template v-else
                  ><p>{{ c.blank }}</p>
                  <SituateButton
                    variant="plain"
                    class="secondary"
                    @click="go('note')"
                  >
                    {{ c.createNote }}
                  </SituateButton></template
                >
                <div v-if="state.editAvailable" class="task-list">
                  <label
                    v-for="(task, i) in [c.taskOne, c.taskTwo]"
                    :key="task"
                    class="choice"
                    ><SituateCheckbox
                      appearance="plain"
                      type="checkbox"
                      :checked="state.tasks[i]"
                      @change="
                        patch({
                          tasks: state.tasks.map((done, index) =>
                            index === i ? checked($event) : done,
                          ),
                        })
                      "
                    />{{ task }}</label
                  >
                </div>
              </section>
              <section class="plan-section">
                <h2>{{ c.developments }}</h2>
                <p v-if="!developments.length">{{ c.noDevelopments }}</p>
                <div
                  v-for="development in developments"
                  :key="development.id"
                  class="development"
                >
                  <strong>{{ development.title }}</strong>
                  <p role="status">
                    {{ pluginCopy.phases[development.phase] }}
                  </p>
                  <SituateButton
                    variant="plain"
                    class="secondary"
                    @click="emit('development', development.id)"
                  >
                    {{ c.openDevelopment }}
                  </SituateButton>
                </div>
              </section>
            </div>
            <section
              v-if="state.support.savedNotes.length"
              class="plan-section"
            >
              <h2>{{ supportCopy.savedIdeas }}</h2>
              <ul>
                <li v-for="note in state.support.savedNotes" :key="note.key">
                  <SituateButton
                    variant="plain"
                    class="note-link"
                    @click="emit('file', note.key)"
                  >
                    {{ note.title }}
                  </SituateButton>
                </li>
              </ul>
            </section>
            <section class="welcome">
              <h2>{{ c.welcome }}</h2>
              <p>{{ c.collaboration }}</p>
            </section>
            <SituateDisclosure
              v-if="!companion && state.confirmed && state.organization"
            >
              <template #label>{{ c.workingApproach }}</template>
              <p>{{ state.organization }}</p>
            </SituateDisclosure>
            <section v-if="state.exampleActive" class="quiet">
              <p>{{ c.exampleHelp }}</p>
              <SituateButton
                variant="plain"
                class="secondary"
                @click="act({ type: 'remove-example' })"
              >
                {{ c.removeExample }}
              </SituateButton>
            </section>
            <section
              v-if="
                state.connected &&
                !state.suggestionDismissed &&
                !state.exampleActive
              "
              class="suggestion"
            >
              <h2>{{ c.scenarioTitle }}</h2>
              <p>{{ c.scenario }}</p>
              <div class="actions">
                <SituateButton @click="act({ type: 'suggestion' })">{{
                  c.tryScenario
                }}</SituateButton
                ><SituateButton
                  variant="plain"
                  class="secondary"
                  @click="patch({ suggestionDismissed: true })"
                >
                  {{ c.dismissScenario }}
                </SituateButton>
              </div>
            </section>
            <footer>
              <SituateButton
                variant="plain"
                v-if="!state.confirmed"
                class="secondary"
                @click="go('access')"
              >
                {{ c.resume }}</SituateButton
              ><SituateButton
                variant="plain"
                v-if="state.editAvailable"
                class="secondary"
                @click="go('conversation')"
              >
                {{ c.otherChat }}</SituateButton
              ><SituateButton
                variant="plain"
                class="secondary"
                :disabled="state.hintDone"
                @click="dismissHint"
              >
                {{ state.hintDone ? c.hintsDone : c.hintsOff }}
              </SituateButton>
            </footer>
          </template>

          <template v-else-if="state.step === 'note'">
            <label class="field"
              >{{ c.localNote
              }}<SituateTextarea
                appearance="plain"
                class="note-editor"
                :value="state.note"
                @input="patch({ note: input($event), noteSaved: false })"
              />
            </label>
            <p v-if="state.noteSaved" role="status">{{ c.saved }}</p>
            <footer>
              <SituateButton
                variant="plain"
                class="secondary"
                @click="go('home')"
                >{{ c.back }}</SituateButton
              ><SituateButton @click="patch({ noteSaved: true })">{{
                c.save
              }}</SituateButton>
            </footer>
          </template>

          <template v-else-if="state.step === 'conversation'">
            <p class="request">{{ c.suggestedRequest }}</p>
            <p>{{ c.scenarioResponse }}</p>
            <section
              v-if="state.editAvailable"
              ref="result"
              class="change-card"
            >
              <h2>{{ c.changeTitle }}</h2>
              <dl>
                <dt>{{ c.removed }}</dt>
                <dd>
                  <del>{{ c.before }}</del>
                </dd>
                <dt>{{ c.added }}</dt>
                <dd>
                  <ins>{{ c.after }}</ins>
                </dd>
              </dl>
              <SituateButton
                variant="plain"
                ref="inspectControl"
                class="secondary"
                @click="go('note')"
              >
                {{ c.fullFile }}
              </SituateButton>
            </section>
            <p v-else>{{ c.noChange }}</p>
            <footer>
              <SituateButton
                variant="plain"
                class="secondary"
                @click="go('home')"
              >
                {{ c.back }}
              </SituateButton>
            </footer>
          </template>
        </div>
      </OnboardingJourney>
    </div>
    <SituateDialog
      ref="hintControl"
      class="hint-dialog"
      aria-labelledby="hint-title"
      @cancel.prevent="dismissHint"
    >
      <section class="change-card">
        <h2>{{ c.changeTitle }}</h2>
        <dl>
          <dt>{{ c.removed }}</dt>
          <dd>
            <del>{{ c.before }}</del>
          </dd>
          <dt>{{ c.added }}</dt>
          <dd>
            <ins>{{ c.after }}</ins>
          </dd>
        </dl>
      </section>
      <section>
        <h2 id="hint-title" data-dialog-title>{{ c.hintTitle }}</h2>
        <p>{{ c.hint }}</p>
        <div class="actions">
          <SituateButton
            variant="plain"
            ref="primaryHintControl"
            class="secondary"
            @click="dismissHint"
          >
            {{ c.gotIt }}</SituateButton
          ><SituateButton
            @click="
              dismissHint();
              go('note');
            "
            >{{ c.fullFile }}</SituateButton
          >
        </div>
      </section>
    </SituateDialog>
  </main>
</template>

<style scoped>
.recovery-notice {
  padding: 16px 24px;
  border-bottom: 1px solid var(--situate-line);
}
.recovery-notice p {
  line-height: 1.6;
}
.onboarding.source-chat-open {
  height: 100%;
  overflow: hidden;
}
.onboarding.source-chat-open .onboarding-body {
  height: 100%;
  max-width: none;
  padding: 0;
}
.onboarding.source-chat-open .step-surface {
  height: 100%;
  animation: none;
}
.onboarding {
  height: 100%;
  min-height: 0;
  overflow: auto;
  background: var(--situate-paper);
  color: var(--situate-ink);
  font-size: 1rem;
  line-height: 1.55;
}
.onboarding.hint-open {
  overflow: hidden;
}
.onboarding-body {
  max-width: 960px;
  margin: auto;
  padding: 32px;
}
.guided .onboarding-body {
  max-width: 760px;
  padding-top: clamp(24px, 6vh, 64px);
}
header {
  margin-bottom: 24px;
}
h1 {
  font-size: clamp(1.8rem, 4vw, 2.5rem);
  line-height: 1.12;
  letter-spacing: -0.04em;
  margin: 8px 0 24px;
}
h2 {
  font-size: 1.2rem;
  line-height: 1.3;
  margin: 0 0 12px;
}
h3 {
  font-size: 1rem;
}
p {
  margin: 12px 0 20px;
}
.eyebrow,
.support {
  color: var(--situate-muted);
  font-size: 0.875rem;
}
.eyebrow {
  margin: 0;
  font-weight: 650;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 24px 0;
}
legend,
.field {
  font-weight: 600;
}
.choice {
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 48px;
}
input {
  accent-color: var(--situate-violet-deep);
  flex-shrink: 0;
  width: 18px;
  height: 18px;
}
textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 112px;
  margin-top: 10px;
  padding: 16px;
  border: 1px solid var(--situate-muted);
  border-radius: 16px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  font: inherit;
  font-weight: 400;
  resize: vertical;
}
textarea::placeholder {
  color: var(--situate-muted);
}
.field {
  display: block;
  margin: 24px 0;
}
.method-card {
  display: flex;
  gap: 12px;
  padding: 16px 0;
  border-top: 1px solid var(--situate-line);
}
.method-card span span {
  display: block;
  margin-top: 6px;
  font-weight: 400;
}
.notice,
.welcome,
.suggestion {
  padding: 24px;
  border-radius: 24px;
  background: var(--situate-lilac);
  margin: 24px 0;
}
.notice p:last-child,
.welcome p:last-child {
  margin-bottom: 0;
}
.quiet {
  margin-top: 32px;
  border-top: 1px solid var(--situate-line);
  padding-top: 24px;
}
.actions,
footer {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
footer {
  margin-top: 32px;
  padding-bottom: 16px;
}
.secondary,
.note-link {
  cursor: pointer;
  min-height: 44px;
  border: 1px solid var(--situate-muted);
  border-radius: 99px;
  color: var(--situate-ink);
  background: var(--situate-surface);
  padding: 10px 18px;
  font: inherit;
  font-size: 0.875rem;
}
.secondary:disabled {
  cursor: default;
}
button:focus-visible,
textarea:focus-visible,
input:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.plan-section {
  padding: 24px 0;
  border-top: 1px solid var(--situate-line);
}
blockquote {
  margin: 20px 0;
  padding-left: 20px;
  border-left: 3px solid var(--situate-violet-deep);
  white-space: pre-wrap;
}
.arrival-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 32px;
}
.development {
  display: grid;
  justify-items: start;
  gap: 12px;
}
.suggestion {
  background: var(--situate-surface);
  border: 1px solid var(--situate-line);
}
.note-link {
  font-weight: 650;
}
.note-editor {
  min-height: 260px;
}
.request {
  background: var(--situate-lilac);
  border-radius: 18px;
  padding: 20px;
}
.change-card {
  background: var(--situate-surface);
  border: 2px solid var(--situate-violet-deep);
  border-radius: 18px;
  padding: 20px;
}
dt {
  font-size: 0.875rem;
  font-weight: 650;
}
dd {
  margin: 6px 0 18px;
}
ins {
  text-decoration: none;
  background: var(--situate-lilac);
}
del {
  color: var(--situate-muted);
}
.hint-dialog {
  box-sizing: border-box;
  max-width: 760px;
  width: calc(100% - 32px);
  max-height: calc(100% - 32px);
  overflow: auto;
  border: 0;
  border-radius: 24px;
  padding: 24px;
  color: var(--situate-ink);
  background: var(--situate-paper);
}
.hint-dialog[open] {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
.hint-dialog::backdrop {
  background: color-mix(in srgb, var(--situate-ink) 65%, transparent);
}
@media (max-width: 700px) {
  .onboarding-body {
    padding: 24px 20px;
  }
  .arrival-grid,
  .hint-dialog[open] {
    grid-template-columns: 1fr;
  }
  .arrival-grid {
    gap: 0;
  }
  footer {
    align-items: stretch;
  }
  footer button {
    flex: 1 1 auto;
  }
  .notice,
  .suggestion,
  .welcome {
    padding: 20px;
  }
}
.companion.guided .onboarding-body {
  max-width: none;
  padding: 0;
  height: 100%;
}
.embedded-setup {
  height: auto;
  overflow: visible;
  background: transparent;
}
.onboarding.embedded-setup .step-surface {
  animation: none;
}
.embedded-setup .onboarding-body {
  height: auto;
  max-width: none;
  padding: 0;
}
.companion.guided[data-step="access"] .onboarding-body {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.companion.guided header {
  margin-bottom: 20px;
}
.companion.guided h1 {
  font-size: clamp(2rem, 3.8vw, 3rem);
  font-weight: 550;
  letter-spacing: -0.05em;
  white-space: pre-line;
  margin: 10px 0 0;
}
.companion.guided:not([data-step="access"]) h1 {
  font-size: clamp(1.8rem, 3vw, 2.35rem);
}
.companion.guided .eyebrow {
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.companion.guided .intro-copy {
  color: var(--situate-muted);
  line-height: 1.65;
  margin: 0 0 24px;
}
.companion.guided .quiet {
  margin-top: 24px;
  padding-top: 20px;
}
.companion.guided .quiet .secondary {
  border: 0;
  padding: 0;
  min-height: 44px;
  text-decoration: underline;
  text-underline-offset: 4px;
  background: transparent;
}
.companion.guided .quiet p {
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--situate-muted);
  margin: 4px 0 0;
}
.companion .method-choice {
  align-items: flex-start;
  padding: 16px;
  margin: 10px 0;
  gap: 12px;
  border: 1px solid var(--situate-control-line);
  border-radius: 16px;
  cursor: pointer;
  transition:
    background 160ms,
    border-color 160ms;
}
.companion .method-choice input {
  margin: 3px 0 0;
}
.companion .method-choice:has(input:checked) {
  border-color: var(--situate-violet-deep);
  background: var(--situate-lilac);
  box-shadow: inset 0 0 0 1px var(--situate-violet-deep);
}
.method-choice strong {
  font-size: 0.875rem;
  font-weight: 600;
}
.method-choice small {
  display: block;
  font-size: 0.8125rem;
  color: var(--situate-muted);
  line-height: 1.5;
  margin-top: 3px;
}
.companion.guided legend {
  font-size: 0.8125rem;
}
.companion.guided .field {
  font-size: 0.875rem;
}
.companion.guided textarea {
  font-size: 1rem;
  background: var(--situate-surface);
  border-radius: 12px;
  padding: 14px;
}
.companion.guided .notice {
  background: var(--situate-paper);
  border-radius: 16px;
  padding: 18px;
  font-size: 0.875rem;
  border-left: 3px solid var(--situate-violet-deep);
}
.companion.guided .notice p {
  margin-top: 0;
}
.companion.guided .plan-section {
  margin-top: 20px;
  padding: 20px;
  border: 1px solid var(--situate-line);
  border-radius: 16px;
}
.companion.guided .plan-section:first-of-type {
  background: var(--situate-note);
}
.companion.guided .plan-section p {
  font-size: 0.875rem;
}
.companion.guided .plan-section blockquote {
  font-size: 1rem;
  border-color: var(--situate-tangerine);
}
.companion.guided footer {
  margin-top: 24px;
  padding: 0;
  justify-content: space-between;
}
.companion .step-surface {
  animation: step-arrival 260ms cubic-bezier(0.22, 0.7, 0.25, 1) both;
}
@keyframes step-arrival {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.motion-off .step-surface,
.companion[data-step="access"] .step-surface {
  animation: none;
}
.arrival-welcome {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 8px 0;
}
.arrival-bend {
  width: 88px;
  flex: none;
  background: var(--situate-lilac);
  border-radius: 50%;
}
.arrival-welcome.after-finale {
  display: none;
}
.motion-off .arrival-welcome.after-finale {
  display: flex;
}
@media (prefers-reduced-motion: reduce) {
  .arrival-welcome.after-finale {
    display: flex;
  }
}
.arrival-welcome h2 {
  font-size: clamp(1.6rem, 3vw, 2.2rem);
  letter-spacing: -0.035em;
  font-weight: 550;
}
.arrival-welcome p {
  color: var(--situate-muted);
  margin: 0;
  max-width: 52ch;
}
.arrival-method {
  margin-block: 16px;
}
.arrival-method :deep(summary) {
  cursor: pointer;
  min-height: 44px;
  padding-block: 12px;
}
.arrival-method p {
  white-space: pre-line;
  line-height: 1.6;
}
.arrival-keepsake {
  padding: 14px 20px;
  margin: 16px 0;
  background: var(--situate-note);
  border-radius: 16px;
}
.arrival-keepsake > span {
  font-size: 0.75rem;
  color: var(--situate-muted);
}
.arrival-keepsake blockquote {
  border-left-color: var(--situate-tangerine);
  margin: 8px 0 0;
  font-size: 0.875rem;
  max-height: 160px;
  overflow: auto;
}
.companion[data-step="home"] h1 {
  font-size: 1.6rem;
  margin-block: 8px 12px;
}
.companion[data-step="home"] header {
  margin-bottom: 16px;
}
.companion .welcome h2 {
  font-size: 1rem;
  margin-bottom: 8px;
}
.companion .welcome p {
  font-size: 0.875rem;
  margin-block: 8px;
}
.companion .welcome {
  background: transparent;
  padding: 12px 0;
  margin: 0;
}
@media (max-width: 760px) {
  .companion.guided h1 {
    font-size: 2rem;
  }
  .companion.guided .plan-section {
    padding: 16px;
  }
  .companion.guided .method-choice {
    padding: 12px;
  }
  .arrival-welcome {
    gap: 16px;
    align-items: flex-start;
  }
  .arrival-bend {
    width: 80px;
  }
  .arrival-welcome p {
    font-size: 0.875rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .companion .step-surface {
    animation: none;
  }
  .companion .method-choice {
    transition: none;
  }
}
</style>
