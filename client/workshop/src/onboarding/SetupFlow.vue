<script setup lang="ts">
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import { useId } from "vue";
import { SituateButton, SituateTextarea } from "../ui";
import SampleBrowser from "./SampleBrowser.vue";
import ImportResult from "./ImportResult.vue";
import WorkingMethod from "./WorkingMethod.vue";
import SupportPlan from "./SupportPlan.vue";
import sourceCopy from "../localization/en.import-preparation.json";
import supportCopy from "../localization/en.support-plan.json";
import { c } from "./content";
import { f } from "./flow-content";
import type { OnboardingState, OnboardingAction } from "./model";
const sourceHelpId = useId();
defineProps<{ state: OnboardingState }>();
const emit = defineEmits<{
  action: [action: OnboardingAction];
  development: [id: string];
}>();
const act = (action: OnboardingAction) => emit("action", action);
const patch = (patch: Partial<OnboardingState>) =>
  act({ type: "patch", patch });
const input = (event: Event) => (event.target as HTMLInputElement).value;
</script>
<template>
  <div class="setup-flow">
    <section v-if="!state.connected" class="notice" role="status">
      <p>
        {{ state.step === "plan" ? supportCopy.restoreDetail : f.recovery }}
      </p>
      <SituateButton
        variant="plain"
        @click="patch({ step: 'access', resumeStep: state.step })"
      >
        {{ c.change }}
      </SituateButton>
    </section>
    <WorkingMethod
      v-if="['method', 'proposal'].includes(state.step)"
      :state="state"
      @action="act"
    />
    <template v-else-if="state.step === 'sources'">
      <template v-if="state.sourceConversation.messages.length">
        <p>{{ sourceCopy.resumeDetail }}</p>
        <div class="actions">
          <SituateButton @click="act({ type: 'open-source-chat' })">{{
            sourceCopy.resume
          }}</SituateButton>
          <SituateButton variant="plain" @click="act({ type: 'defer' })">{{
            f.defer
          }}</SituateButton>
        </div>
      </template>
      <form v-else @submit.prevent="act({ type: 'start-source-chat' })">
        <p>{{ sourceCopy.intro }}</p>
        <label class="field"
          >{{ sourceCopy.label
          }}<SituateTextarea
            appearance="plain"
            :value="state.source"
            :placeholder="sourceCopy.placeholder"
            :aria-describedby="sourceHelpId"
            @input="patch({ source: input($event) })"
          />
        </label>
        <p :id="sourceHelpId">{{ sourceCopy.help }}</p>
        <div class="actions">
          <SituateButton
            type="submit"
            :disabled="!state.connected || !state.source.trim()"
            >{{ sourceCopy.start }}</SituateButton
          >
          <SituateButton
            variant="plain"
            type="button"
            @click="patch({ step: 'plan' })"
          >
            {{ sourceCopy.skip }}
          </SituateButton>
        </div>
      </form>
      <footer>
        <SituateButton variant="plain" @click="act({ type: 'revise-method' })">
          {{ f.reviseMethod }}
        </SituateButton>
      </footer>
    </template>
    <ImportResult
      v-else-if="state.step === 'samples'"
      :state="state"
      @action="act"
    />
    <template v-else-if="state.step === 'import-chat'">
      <p class="agent-message">
        <strong>{{ f.agent }}</strong
        >{{ f.importStates[state.importState] }}
      </p>
      <p>{{ f.availableCount(state.imported.length) }}</p>
      <p>{{ f.importScope }}</p>
      <p>{{ f.capacity }}</p>
      <p>{{ f.execution }}</p>
      <div class="actions">
        <SituateButton
          variant="plain"
          v-if="
            ['failed', 'blocked', 'paused', 'deferred'].includes(
              state.importState,
            ) && state.importApproved
          "
          :disabled="!state.connected"
          @click="act({ type: 'resume-import' })"
        >
          {{ f.retryImport }}</SituateButton
        ><SituateButton
          variant="plain"
          v-if="!state.importApproved"
          :disabled="!state.connected"
          @click="patch({ step: 'samples' })"
        >
          {{ f.inspectSource }}</SituateButton
        ><SituateButton
          variant="plain"
          v-if="!state.connected"
          @click="patch({ step: 'access', resumeStep: 'import-chat' })"
        >
          {{ c.change }}
        </SituateButton>
      </div>
      <SituateDisclosure v-if="state.importApproved">
        <template #label>{{ f.approvedStructure }}</template>
        <SampleBrowser
          :files="state.samples"
          :selected="state.sampleKey"
          approved
          @select="patch({ sampleKey: $event })"
        />
      </SituateDisclosure>
      <footer>
        <SituateButton
          @click="
            patch({ step: state.confirmed || state.manual ? 'home' : 'plan' })
          "
          >{{
            state.confirmed || state.manual ? f.backHome : f.importContinue
          }}</SituateButton
        >
      </footer>
    </template>
    <SupportPlan
      v-else-if="state.step === 'plan'"
      :state="state"
      @action="act"
    />
  </div>
</template>
<style scoped>
.setup-flow {
  min-width: 0;
}
p,
li {
  line-height: 1.6;
}
h2 {
  font-size: 1.2rem;
}
h3 {
  font-size: 1rem;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 20px 0;
  min-width: 0;
}
legend {
  font-weight: 650;
  margin-bottom: 8px;
}
.choice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 44px;
  padding: 10px 0;
}
input {
  accent-color: var(--situate-violet-deep);
  margin-top: 5px;
  flex: none;
  width: 18px;
  height: 18px;
}
button {
  font: inherit;
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--situate-control-line);
  border-radius: 22px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
button:focus-visible,
:deep(summary):focus-visible,
textarea:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
:deep(summary) {
  cursor: pointer;
  min-height: 44px;
  padding: 10px 0;
}
details p {
  font-size: 0.875rem;
}
.field {
  display: grid;
  gap: 8px;
  margin: 20px 0;
}
textarea {
  font: inherit;
  min-height: 86px;
  padding: 12px;
  border: 1px solid var(--situate-control-line);
  border-radius: 12px;
  resize: vertical;
  color: var(--situate-ink);
  background: var(--situate-surface);
  width: 100%;
  box-sizing: border-box;
}
footer,
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
  align-items: center;
}
.agent-message {
  padding: 16px 20px;
  background: var(--situate-paper);
  border-radius: 0 18px 18px 18px;
}
.agent-message strong {
  display: block;
  font-size: 0.75rem;
  color: var(--situate-muted);
  margin-bottom: 6px;
}
.proposal,
.milestone,
.notice {
  padding: 16px 20px;
  border-radius: 16px;
  background: var(--situate-lilac);
  margin: 16px 0;
}
.proposal ul {
  padding-left: 20px;
}
.proposal li {
  margin: 10px 0;
}
</style>
