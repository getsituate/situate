<script setup lang="ts">
import { SituateSelect, SituateButton, SituateInput } from "../ui";
import { useId } from "vue";
import resultCopy from "../localization/en.import-result.json";
import { importHandoffDuration } from "./import-result";
import SourceConversationControls from "./SourceConversationControls.vue";
import SupportPlanControls from "./SupportPlanControls.vue";
import instructionsCopy from "../localization/en.workspace-instructions.json";
import methodCopy from "../localization/en.working-method.json";
import sourceCopy from "../localization/en.import-preparation.json";
const presentationId = useId(),
  connectionId = useId(),
  outcomeId = useId(),
  revisionId = useId();
import {
  hasImport,
  type OnboardingAction,
  type OnboardingState,
} from "./model";
import OnboardingImportControls from "./OnboardingImportControls.vue";
defineProps<{ state: OnboardingState }>();
const emit = defineEmits<{ action: [action: OnboardingAction] }>();
const patch = (patch: Partial<OnboardingState>) =>
  emit("action", { type: "patch", patch });
</script>
<template>
  <section>
    <p v-if="state.recovery">{{ sourceCopy.controls.recovery }}</p>
    <label v-if="state.step === 'samples' && state.imported.length <= 50">
      {{ resultCopy.controls.viewer }}
      <SituateSelect
        :aria-label="resultCopy.controls.viewer"
        :value="state.importFile ?? ''"
        @change="
          emit('action', {
            type: 'view-import-file',
            key: ($event.target as HTMLSelectElement).value || null,
          })
        "
      >
        <option value="">{{ resultCopy.controls.closed }}</option>
        <option
          v-for="file in state.imported.filter((file) => !file.deleted)"
          :key="file.key"
          :value="file.key"
        >
          {{ file.name }}
        </option>
      </SituateSelect>
    </label>
    <template v-if="state.step === 'samples' && state.imported.length > 50">
      <p>{{ resultCopy.controls.collection }}</p>
      <SituateButton
        variant="plain"
        v-if="state.importFile"
        @click="emit('action', { type: 'view-import-file', key: null })"
      >
        {{ resultCopy.closeFile }}
      </SituateButton>
    </template>
    <template v-if="!state.importFile || state.step !== 'samples'">
      <div
        v-if="
          state.step === 'source-chat' &&
          state.importHandoff.status === 'playing'
        "
      >
        <label
          >{{ resultCopy.controls.frame
          }}<SituateInput
            appearance="plain"
            type="range"
            min="0"
            :max="importHandoffDuration"
            step="10"
            :aria-label="resultCopy.controls.frame"
            :value="state.importHandoff.timeMs ?? 0"
            @input="
              emit('action', {
                type: 'import-handoff-time',
                timeMs: Number(($event.target as HTMLInputElement).value),
              })
            "
        /></label>
        <SituateButton
          variant="plain"
          @click="emit('action', { type: 'import-handoff-time', timeMs: null })"
        >
          {{ resultCopy.controls.live }}
        </SituateButton>
        <p>{{ resultCopy.controls.detail }}</p>
      </div>
      <SupportPlanControls
        v-if="state.step === 'plan'"
        :state="state"
        @action="emit('action', $event)"
      />
      <SourceConversationControls
        v-if="
          state.importHandoff.status !== 'playing' &&
          (['sources', 'source-chat'].includes(state.step) ||
            (state.step === 'import-chat' &&
              state.sourceConversation.messages.length))
        "
        :state="state.sourceConversation"
        @action="emit('action', { type: 'source-chat', action: $event })"
      />
      <p v-else-if="!['samples', 'plan'].includes(state.step)">
        {{ methodCopy.controls.intro }}
      </p>
      <label v-if="state.step === 'method'"
        >{{ methodCopy.controls.explanation }}
        <SituateSelect
          :aria-label="methodCopy.controls.explanation"
          :value="state.methodInfo ?? ''"
          :disabled="!!state.methodRequest"
          @change="
            emit('action', {
              type: 'method-info',
              id: ($event.target as HTMLSelectElement).value || null,
            })
          "
        >
          <option value="">{{ methodCopy.controls.none }}</option>
          <option
            v-for="method in methodCopy.methods"
            :key="method.id"
            :value="method.id"
          >
            {{ method.name }}
          </option>
        </SituateSelect>
      </label>
      <label v-if="state.step === 'proposal' && !state.instructionsOpen">
        {{ instructionsCopy.controls.example }}
        <SituateSelect
          :aria-label="instructionsCopy.controls.example"
          :value="state.instructionExample"
          @change="
            emit('action', {
              type: 'instructions-example',
              example: ($event.target as HTMLSelectElement)
                .value as OnboardingState['instructionExample'],
            })
          "
        >
          <option value="standard">
            {{ instructionsCopy.controls.standard }}
          </option>
          <option value="short">{{ instructionsCopy.controls.short }}</option>
        </SituateSelect>
      </label>
      <label v-if="state.step === 'proposal'"
        >{{ instructionsCopy.controls.viewer }}
        <SituateSelect
          :aria-label="instructionsCopy.controls.viewer"
          :value="String(state.instructionsOpen)"
          :disabled="
            !!state.methodRequest || state.instructionSave === 'saving'
          "
          @change="
            emit('action', {
              type: 'instructions-view',
              open: ($event.target as HTMLSelectElement).value === 'true',
            })
          "
        >
          <option value="false">{{ instructionsCopy.controls.closed }}</option>
          <option value="true">{{ instructionsCopy.controls.open }}</option>
        </SituateSelect>
      </label>
      <template v-if="state.step === 'proposal' && !state.instructionsOpen">
        <label
          >{{ instructionsCopy.controls.save }}
          <SituateSelect
            :aria-label="instructionsCopy.controls.save"
            :value="state.instructionSaveOutcome"
            @change="
              patch({
                instructionSaveOutcome: ($event.target as HTMLSelectElement)
                  .value as OnboardingState['instructionSaveOutcome'],
              })
            "
          >
            <option value="success">{{ methodCopy.controls.success }}</option>
            <option value="failure">{{ methodCopy.controls.failure }}</option>
            <option value="wait">{{ methodCopy.controls.wait }}</option>
          </SituateSelect>
        </label>
        <template v-if="state.instructionSave === 'saving'">
          <SituateButton
            variant="plain"
            @click="emit('action', { type: 'complete-instructions' })"
          >
            {{ instructionsCopy.controls.complete }}
          </SituateButton>
          <SituateButton
            variant="plain"
            @click="emit('action', { type: 'fail-instructions' })"
          >
            {{ instructionsCopy.controls.fail }}
          </SituateButton>
        </template>
      </template>
      <template
        v-if="
          ['method', 'proposal'].includes(state.step) &&
          !state.methodInfo &&
          !state.instructionsOpen &&
          state.instructionSave !== 'saving'
        "
      >
        <label :for="outcomeId">{{ methodCopy.controls.result }}</label>
        <SituateSelect
          :id="outcomeId"
          :value="state.methodOutcome"
          @change="
            patch({
              methodOutcome: ($event.target as HTMLSelectElement)
                .value as OnboardingState['methodOutcome'],
            })
          "
        >
          <option value="success">{{ methodCopy.controls.success }}</option>
          <option value="wait">{{ methodCopy.controls.wait }}</option>
          <option value="failure">{{ methodCopy.controls.failure }}</option>
        </SituateSelect>
        <template v-if="state.step === 'proposal'">
          <label :for="revisionId">{{ methodCopy.controls.revision }}</label>
          <SituateSelect
            :id="revisionId"
            :value="state.revisionExample"
            @change="
              patch({
                revisionExample: ($event.target as HTMLSelectElement)
                  .value as OnboardingState['revisionExample'],
              })
            "
          >
            <option value="lighter">{{ methodCopy.controls.lighter }}</option>
            <option value="focus">{{ methodCopy.controls.focus }}</option>
            <option value="reflect">{{ methodCopy.controls.reflect }}</option>
          </SituateSelect>
        </template>
        <template v-if="state.methodRequest">
          <SituateButton
            variant="plain"
            @click="emit('action', { type: 'complete-method' })"
          >
            {{ methodCopy.controls.complete }}
          </SituateButton>
          <SituateButton
            variant="plain"
            @click="emit('action', { type: 'fail-method' })"
          >
            {{ methodCopy.controls.fail }}
          </SituateButton>
        </template>
      </template>
      <label :for="presentationId">Presentation</label
      ><SituateSelect
        :id="presentationId"
        :value="state.presentation"
        @change="
          patch({
            presentation: ($event.target as HTMLSelectElement)
              .value as OnboardingState['presentation'],
          })
        "
      >
        <option value="companion">Bend companion journey</option>
        <option value="plain">Plain guided surface</option>
      </SituateSelect>
      <template v-if="state.step === 'access' || !state.connected">
        <label :for="connectionId">Connection retry result</label
        ><SituateSelect
          :id="connectionId"
          :value="state.connectionOutcome"
          @change="
            patch({
              connectionOutcome: ($event.target as HTMLSelectElement)
                .value as OnboardingState['connectionOutcome'],
            })
          "
        >
          <option value="success">Connected</option>
          <option value="blocked">Still blocked</option>
        </SituateSelect>
        <p>
          Provider and purchase choices describe recovery paths only. They do
          not authenticate, switch providers or buy capacity.
        </p>
      </template>
      <SituateButton
        variant="plain"
        v-if="state.connected && !hasImport(state)"
        @click="emit('action', { type: 'interrupt' })"
      >
        Block shared provider
      </SituateButton>
      <OnboardingImportControls
        v-if="hasImport(state)"
        :state="state"
        @action="emit('action', $event)"
      />
      <template v-if="['home', 'conversation', 'note'].includes(state.step)"
        ><SituateButton
          variant="plain"
          v-if="!state.editAvailable"
          @click="patch({ editAvailable: true })"
        >
          Save an edit in another conversation
        </SituateButton>
        <p>
          Hints appear only when the saved edit is visible. Dismissal is shared
          across workspace fixtures, not persisted or synchronized. Reset
          restores the scenario.
        </p></template
      >
    </template>
  </section>
</template>
<style scoped>
section {
  display: grid;
  gap: 12px;
}
label {
  display: grid;
  gap: 8px;
}
select,
button {
  font: inherit;
  min-height: 40px;
}
p {
  font-size: 0.875rem;
  line-height: 1.5;
}
</style>
