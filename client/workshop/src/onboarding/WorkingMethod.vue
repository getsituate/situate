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
import { SituateButton, SituateTextarea } from "../ui";
import MethodPicker from "./MethodPicker.vue";
import ChatWorkingIndicator from "../components/ChatWorkingIndicator.vue";
import InstructionFile from "./InstructionFile.vue";
import instructionsCopy from "../localization/en.workspace-instructions.json";
import copy from "../localization/en.working-method.json";
import { type OnboardingAction, type OnboardingState } from "./model";
const props = defineProps<{ state: OnboardingState }>();
const emit = defineEmits<{ action: [action: OnboardingAction] }>();
const id = useId();
const result = ref<{ focus: () => void }>();
const fieldControl = ref<InstanceType<typeof SituateTextarea>>();
const field = computed(() => fieldControl.value?.element);
const actions = ref<HTMLElement>();
let viewportObserver: ResizeObserver | undefined;
onMounted(() => {
  const viewport =
    field.value?.closest(".setup-frame") ?? field.value?.closest(".onboarding");
  if (!viewport || typeof ResizeObserver === "undefined") return;
  viewportObserver = new ResizeObserver(() => {
    if (field.value && document.activeElement === field.value) {
      field.value.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  });
  viewportObserver.observe(viewport);
});
onBeforeUnmount(() => viewportObserver?.disconnect());
const busy = computed(
  () =>
    props.state.methodRequest !== null ||
    props.state.instructionSave === "saving",
);
watch(busy, async (value) => {
  if (!value) return;
  await nextTick();
  actions.value?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
});
const describing = computed(() => props.state.step === "method");
const unapplied = computed(
  () =>
    !!props.state.feedback.trim() &&
    props.state.feedback.trim() !== props.state.appliedFeedback,
);
const patch = (patch: Partial<OnboardingState>) =>
  emit("action", { type: "patch", patch });
const input = (event: Event) => (event.target as HTMLTextAreaElement).value;
async function cancel() {
  emit("action", {
    type:
      props.state.instructionSave === "saving"
        ? "cancel-instructions"
        : "cancel-method",
  });
  await nextTick();
  field.value?.focus();
}
watch(
  () => props.state.appliedFeedback,
  async (value, before) => {
    if (value && value !== before) {
      await nextTick();
      result.value?.focus();
    }
  },
);
</script>
<template>
  <section class="working-method">
    <template v-if="describing">
      <div class="writing">
        <label :for="`${id}-description`">{{ copy.describe }}</label>
        <p :id="`${id}-description-help`" class="help">
          {{ copy.describeHelp }}
        </p>
        <SituateTextarea
          appearance="plain"
          ref="fieldControl"
          :id="`${id}-description`"
          :aria-describedby="`${id}-description-help`"
          :value="state.context"
          :placeholder="copy.describePlaceholder"
          :disabled="busy"
          rows="3"
          @input="patch({ context: input($event) })"
        />
      </div>
      <MethodPicker :state="state" @action="emit('action', $event)" />
    </template>
    <template v-else>
      <p class="intro">{{ instructionsCopy.intro }}</p>
      <InstructionFile
        ref="result"
        :state="state"
        :busy="busy"
        @action="emit('action', $event)"
      />
      <section
        v-if="state.openPoints.length"
        class="open-points"
        :aria-labelledby="`${id}-open-points`"
      >
        <h2 :id="`${id}-open-points`">{{ copy.openPoints }}</h2>
        <p class="help">{{ copy.openPointsHelp }}</p>
        <ul>
          <li v-for="point in state.openPoints" :key="point">{{ point }}</li>
        </ul>
      </section>
      <p class="help">{{ instructionsCopy.later }}</p>
      <div class="writing">
        <label :for="`${id}-feedback`">{{ copy.feedback }}</label>
        <p :id="`${id}-feedback-help`" class="help">{{ copy.feedbackHelp }}</p>
        <SituateTextarea
          appearance="plain"
          ref="fieldControl"
          :id="`${id}-feedback`"
          :aria-describedby="`${id}-feedback-help`"
          :value="state.feedback"
          :placeholder="copy.feedbackPlaceholder"
          :disabled="busy"
          rows="2"
          @input="patch({ feedback: input($event) })"
        />
      </div>
    </template>
    <div class="method-status">
      <ChatWorkingIndicator
        class="form-working"
        v-if="state.methodRequest"
        :key="state.methodRequest"
        :comment="describing ? copy.generating : copy.updating"
        :status="describing ? copy.generating : copy.updating"
        :covered="
          state.motionPaused || state.instructionsOpen || !!state.methodInfo
        "
      />
      <p v-else-if="state.instructionSave === 'saving'" role="status">
        {{ instructionsCopy.saving }}
      </p>
      <p
        v-else-if="
          state.instructionSave === 'error' &&
          state.existingInstructions === null
        "
        role="alert"
        class="error"
      >
        {{ instructionsCopy.saveError }}
      </p>
      <p v-else-if="state.methodError" role="alert" class="error">
        {{ describing ? copy.failed : copy.failedRevision }}
      </p>
      <p v-else-if="!describing && unapplied" class="help">
        {{ copy.unapplied }}
      </p>
      <p
        v-else-if="!describing && state.appliedFeedback"
        role="status"
        class="help"
      >
        {{ copy.updated }}
      </p>
      <p v-else-if="describing" class="help">{{ copy.reviewBeforeConfirm }}</p>
    </div>
    <section
      v-if="state.existingInstructions !== null"
      class="error"
      role="alert"
    >
      <p>{{ instructionsCopy.conflict }}</p>
      <pre>{{ state.existingInstructions }}</pre>
      <SituateButton
        :disabled="!state.connected"
        @click="emit('action', { type: 'use-existing-instructions' })"
        >{{ instructionsCopy.useExisting }}</SituateButton
      >
    </section>
    <footer ref="actions">
      <SituateButton
        variant="plain"
        v-if="busy"
        class="secondary"
        @click="cancel"
      >
        {{ copy.cancel }}
      </SituateButton>
      <SituateButton
        variant="plain"
        v-else
        class="secondary"
        @click="patch({ step: describing ? 'access' : 'method' })"
      >
        {{ copy.back }}
      </SituateButton>
      <SituateButton
        v-if="describing"
        :disabled="busy || !state.connected"
        @click="emit('action', { type: 'generate-proposal' })"
        >{{ copy.generate }}</SituateButton
      >
      <SituateButton
        v-else-if="unapplied"
        :disabled="busy || !state.connected"
        @click="emit('action', { type: 'revise-proposal' })"
        >{{ copy.update }}</SituateButton
      >
      <SituateButton
        v-else
        :disabled="
          busy ||
          !state.connected ||
          state.methodError ||
          state.existingInstructions !== null
        "
        @click="emit('action', { type: 'confirm-method' })"
        >{{ copy.confirm }}</SituateButton
      >
    </footer>
  </section>
</template>
<style scoped>
.working-method {
  min-width: 0;
}
p,
li {
  line-height: 1.6;
}
.method-status {
  min-block-size: 68px;
  display: grid;
  align-content: center;
}
.method-status > p {
  margin: 0;
}
.form-working {
  padding: 12px 0;
  gap: 10px;
}
.form-working :deep(.bend-comment) {
  white-space: normal;
  overflow: visible;
  font-size: 0.875rem;
  color: var(--situate-ink);
}
.open-points {
  margin-block: 20px;
}
.open-points h2 {
  font-size: 1rem;
  margin: 0 0 8px;
}
.open-points ul {
  padding-inline-start: 24px;
}
.intro {
  margin: 0 0 16px;
}
.writing {
  display: grid;
  gap: 8px;
  margin-block: 20px;
}
.writing label {
  font-weight: 600;
  line-height: 1.5;
}
.help {
  color: var(--situate-muted);
  font-size: 0.875rem;
  line-height: 1.6;
}
.writing p {
  margin: 0;
}
textarea {
  font: inherit;
  line-height: 1.6;
  padding: 12px 14px;
  width: 100%;
  box-sizing: border-box;
  min-height: 90px;
  resize: vertical;
  border: 1px solid var(--situate-control-line);
  border-radius: 12px;
  background: var(--situate-surface);
  color: var(--situate-ink);
}
textarea::placeholder {
  color: var(--situate-muted);
}
textarea:focus-visible,
button:focus-visible,
input:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.error {
  padding: 12px 16px;
  background: var(--situate-paper);
  border-left: 3px solid var(--situate-tangerine);
}
footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
}
.secondary {
  font: inherit;
  color: var(--situate-ink);
  background: var(--situate-surface);
  border: 1px solid var(--situate-control-line);
  border-radius: 24px;
  padding: 10px 18px;
  min-height: 44px;
  cursor: pointer;
}
</style>
