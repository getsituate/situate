<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { SituateButton, SituateRadio } from "../ui";
import ChatWorkingIndicator from "../components/ChatWorkingIndicator.vue";
import copy from "../localization/en.support-plan.json";
import {
  canConfirm,
  type OnboardingAction,
  type OnboardingState,
} from "./model";
import type { SupportChoice } from "./support-plan";

const props = defineProps<{ state: OnboardingState }>();
const emit = defineEmits<{ action: [action: OnboardingAction] }>();
const groupId = useId();
const root = ref<HTMLElement>();
const choices: SupportChoice[] = ["develop", "save", "discard"];
const proposals = computed(() => props.state.support.proposals.slice(0, 3));
const count = (choice: SupportChoice) =>
  proposals.value.filter(
    (idea) => props.state.support.choices[idea.id] === choice,
  ).length;
const developments = computed(() => count("develop"));
const notes = computed(() => count("save"));
const finishLabel = computed(() =>
  developments.value === 0
    ? copy.finish
    : developments.value === 1
      ? copy.finishOne
      : copy.finishMany.replace("{count}", String(developments.value)),
);
const readySummary = computed(() =>
  proposals.value.length === 1
    ? copy.readyOne
    : copy.readyMany.replace("{count}", String(proposals.value.length)),
);
function retry(event: MouseEvent) {
  (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  emit("action", { type: "support-request" });
}
watch(
  () => props.state.support.phase,
  async (phase) => {
    const previousFocus = document.activeElement;
    if (
      !root.value?.querySelector(".analysis")?.contains(previousFocus) ||
      !["ready", "error"].includes(phase)
    )
      return;
    await nextTick();
    if (
      props.state.step !== "plan" ||
      props.state.confirmed ||
      props.state.support.phase !== phase ||
      !root.value?.isConnected
    )
      return;
    if (
      document.activeElement !== document.body &&
      document.activeElement !== previousFocus
    )
      return;
    root.value
      .querySelector<HTMLElement>(
        phase === "error" ? ".analysis button" : ".suggestion h2, .empty",
      )
      ?.focus({ preventScroll: true });
  },
);
const saveSummary = computed(() =>
  notes.value === 1
    ? copy.saveOne
    : copy.saveMany.replace("{count}", String(notes.value)),
);
</script>
<template>
  <section ref="root" class="support-plan">
    <span class="sr-only" role="status">{{
      state.support.phase === "ready" && proposals.length ? readySummary : ""
    }}</span>
    <div class="explanation">
      <p class="intro">{{ copy.intro }}</p>
      <p>{{ copy.capabilities }}</p>
    </div>
    <div v-if="state.support.phase === 'working'" class="analysis">
      <ChatWorkingIndicator :status="copy.working" :comment="copy.working" />
      <p>
        {{
          state.support.inputs?.paths.documents.length
            ? copy.workingWithFiles
            : copy.workingWithoutFiles
        }}
      </p>
      <p>{{ copy.waitingHelp }}</p>
    </div>
    <div v-else-if="state.support.phase === 'error'" class="analysis">
      <p role="status">{{ copy.error }}</p>
      <SituateButton
        variant="secondary"
        :disabled="!state.connected"
        @click="retry"
      >
        {{ copy.retry }}
      </SituateButton>
    </div>
    <template v-else-if="state.support.phase === 'ready'">
      <p v-if="!proposals.length" class="empty" tabindex="-1" role="status">
        {{ copy.empty }}
      </p>
      <div v-else class="recommendations">
        <div class="explanation">
          <p>
            {{
              state.support.inputs?.paths.documents.length
                ? copy.suggestionsWithFiles
                : copy.suggestionsWithoutFiles
            }}
          </p>
          <p>{{ copy.choiceHelp }}</p>
        </div>
        <ul class="suggestions">
          <li
            v-for="idea in proposals"
            :key="idea.id"
            class="suggestion"
            :data-suggestion="idea.id"
          >
            <h2 :id="`${groupId}-${idea.id}`" tabindex="-1">
              {{ idea.title }}
            </h2>
            <p class="detail">{{ idea.detail }}</p>
            <p class="reason">{{ idea.reason }}</p>
            <fieldset
              :aria-labelledby="`${groupId}-${idea.id}`"
              class="choices"
            >
              <label
                v-for="choice in choices"
                :key="choice"
                class="choice"
                :class="{ selected: state.support.choices[idea.id] === choice }"
              >
                <SituateRadio
                  appearance="plain"
                  :name="`${groupId}-${idea.id}`"
                  :value="choice"
                  :checked="state.support.choices[idea.id] === choice"
                  @change="
                    emit('action', {
                      type: 'support-choice',
                      id: idea.id,
                      choice,
                    })
                  "
                />
                <span>{{ copy.choices[choice] }}</span>
              </label>
            </fieldset>
          </li>
        </ul>
      </div>
    </template>
    <p class="inspiration">{{ copy.inspiration }}</p>
    <footer>
      <p v-if="notes" class="summary" role="status">{{ saveSummary }}</p>
      <p v-if="developments" class="capacity">{{ copy.capacity }}</p>
      <p v-if="developments && !state.connected" role="status">
        {{ copy.offline }}
      </p>
      <p v-if="state.support.confirmError === 'save'" role="alert">
        {{ copy.saveError }}
      </p>
      <SituateButton
        :disabled="!canConfirm(state)"
        @click="emit('action', { type: 'confirm' })"
      >
        {{ finishLabel }}
      </SituateButton>
    </footer>
  </section>
</template>
<style scoped>
.support-plan {
  display: grid;
  gap: 24px;
  min-width: 0;
  container-type: inline-size;
}
p,
h2 {
  margin: 0;
}
p {
  line-height: 1.55;
}
.explanation {
  display: grid;
  gap: 12px;
  max-width: 58ch;
}
.explanation p:not(.intro) {
  font-size: 0.875rem;
}
.recommendations {
  display: grid;
  gap: 24px;
}
.suggestions {
  display: grid;
  gap: 24px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.suggestion {
  min-width: 0;
}
h2 {
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.4;
}
.detail {
  margin-top: 6px;
  font-size: 0.875rem;
}
.reason {
  margin-top: 6px;
  font-size: 0.8125rem;
  color: var(--situate-muted);
}
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  padding: 0;
  margin: 12px 0 0;
  border: 0;
}
.choice {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--situate-control-line);
  border-radius: 10px;
  background: var(--situate-surface);
  font-size: 0.8125rem;
  line-height: 1.4;
  cursor: pointer;
}
.choice input {
  flex: none;
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--situate-accent-strong);
}
.choice.selected {
  border-color: var(--situate-accent-strong);
  background: var(--situate-accent-soft);
}
.choice:has(input:focus-visible) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.choice:hover {
  background: var(--situate-accent-soft);
}
.inspiration {
  color: var(--situate-muted);
  font-size: 0.875rem;
  max-width: 58ch;
}
.analysis {
  display: grid;
  justify-items: start;
  gap: 12px;
  padding-block: 12px;
}
.analysis p,
.empty {
  font-size: 0.875rem;
}
.analysis :deep(.bend-comment) {
  font-size: 0.875rem;
  white-space: normal;
}
.analysis :deep(.bend-motion) {
  width: 44px;
  min-height: 44px;
}
footer {
  display: grid;
  justify-items: start;
  gap: 12px;
}
.summary,
.capacity {
  font-size: 0.8125rem;
  color: var(--situate-muted);
}
footer button {
  min-height: 44px;
  white-space: normal;
  text-align: center;
}
@container (max-width: 340px) {
  .choices {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }
  .choice {
    flex-direction: column;
    gap: 6px;
    padding: 8px 4px;
    text-align: center;
  }
  .choice span {
    overflow-wrap: anywhere;
  }
}
</style>
