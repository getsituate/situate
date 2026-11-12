<script setup lang="ts">
import { advanceWorkTime, finishWorkTime, workTimeCopy } from "./work-time";
import WorkHistoryControls from "./WorkHistoryControls.vue";
import QuestionControls from "./QuestionControls.vue";
import presetCopy from "../localization/en.conversation-presets.json";
import { historyCopy } from "./work-history";
import { activeQuestion } from "./question";
import { SituateSelect, SituateButton } from "../ui";
import {
  changePhase,
  mainChatRequest,
  type ChatState,
  type Phase,
} from "./model";
import {
  applyOutcome,
  availableOutcomes,
  chatGuard,
  cloneAiState,
  createAiState,
  currentWorkspace,
} from "../ai/model";
import { gestures } from "../mini-bend-playful/gestures";
import {
  pluginAvailableText,
  systemMessageCopy,
  systemMessageFixture,
  type SystemMessageLocale,
} from "./system-message";
const props = defineProps<{ state: ChatState }>();
const emit = defineEmits<{ "update:state": [state: ChatState] }>();
function noticeLanguage(event: Event) {
  const locale = (event.target as HTMLSelectElement)
    .value as SystemMessageLocale;
  emit("update:state", {
    ...props.state,
    systemMessageLocale: locale,
    transcript:
      props.state.transcript?.map(
        (event) =>
          systemMessageFixture(locale).find(
            (translated) => translated.id === event.id,
          ) ?? event,
      ) ?? null,
    systemAnnouncement: "",
  });
}
function deliverNotice() {
  if (
    !props.state.transcript ||
    props.state.transcript.some((event) => event.id === "plugin-available-live")
  )
    return;
  emit("update:state", {
    ...props.state,
    transcript: [
      ...props.state.transcript,
      { kind: "system", id: "plugin-available-live", pluginName: "Book shelf" },
    ],
    systemAnnouncement: pluginAvailableText(
      "Book shelf",
      props.state.systemMessageLocale,
    ),
  });
}
function fixture(event: Event) {
  if (props.state.phase === "working") return;
  const example = (event.target as HTMLSelectElement).value;
  const ai = createAiState(
    `chat-${example === "reasoning-limited" ? "existing" : example === "reasoning-default" ? "new" : example === "long-manual" ? "custom" : example}`,
  );
  if (example === "reasoning-limited")
    currentWorkspace(ai).model.selected = "example-desktop";
  const current = currentWorkspace(props.state.ai);
  const next = currentWorkspace(ai);
  next.thinkingDefaults = { ...current.thinkingDefaults };
  next.showModelPicker = current.showModelPicker;
  if (next.connection?.provider === current.connection?.provider)
    next.defaultModel = current.defaultModel;
  if (example === "reasoning-default") {
    next.defaultModel = "example-reasoning-long";
    next.model.selected = null;
  }
  if (example === "long-manual")
    next.model.selected =
      "example-lab/extended-context-conversational-model-2026-09";
  ai.mobile = props.state.ai.mobile;
  emit("update:state", { ...props.state, ai });
}
function outcome(id: string) {
  const ai = cloneAiState(props.state.ai);
  applyOutcome(ai, id);
  emit("update:state", { ...props.state, ai });
}
</script>

<template>
  <p>
    Synthetic conversations and saved changes. Question replies update the
    conversation; ordinary messages report a handoff without contacting an AI
    provider. Activity groups contain only consecutive hidden calls.
  </p>
  <WorkHistoryControls
    v-if="state.workHistory || state.workTimeMs !== undefined"
    :state="state"
    @update:state="emit('update:state', $event)"
  />
  <QuestionControls
    v-if="state.questionVariant"
    :state="state"
    @update:state="emit('update:state', $event)"
  />
  <template v-if="state.transcript?.some((event) => event.kind === 'system')">
    <label for="system-message-language">{{
      systemMessageCopy.en.language
    }}</label>
    <SituateSelect
      id="system-message-language"
      :value="state.systemMessageLocale"
      @change="noticeLanguage"
    >
      <option value="en">English</option>
      <option value="de">Deutsch</option>
    </SituateSelect>
    <SituateButton
      variant="secondary"
      size="small"
      :disabled="
        state.transcript.some((event) => event.id === 'plugin-available-live')
      "
      @click="deliverNotice"
      >{{ systemMessageCopy.en.deliver }}</SituateButton
    >
  </template>
  <label for="composer-control-language">Composer control language</label>
  <SituateSelect
    id="composer-control-language"
    :value="state.composerLocale ?? 'en'"
    @change="
      emit('update:state', {
        ...state,
        composerLocale: ($event.target as HTMLSelectElement).value as
          'en' | 'de',
      })
    "
  >
    <option value="en">English</option>
    <option value="de">Deutsch</option>
  </SituateSelect>
  <p>
    Compact controls show resolved values. ↳ follows the workspace default; ☆
    follows the recommendation; an unmarked value is a conversation choice. Open
    either menu for the full name and source. Changes apply to the next message,
    not the active request. Below 480 px of pane width, activity gets its own
    left-aligned row; controls remain on the right below it.
  </p>
  <template v-if="state.workTimeMs !== undefined">
    <p>{{ workTimeCopy.en.controlsNote }}</p>
    <SituateButton
      v-if="state.phase === 'working'"
      variant="secondary"
      size="small"
      @click="emit('update:state', advanceWorkTime(state))"
      >Advance work by 15 seconds</SituateButton
    >
    <SituateButton
      v-if="state.phase === 'working'"
      variant="secondary"
      size="small"
      @click="emit('update:state', finishWorkTime(state, 'complete', true))"
      >Ask a question and end block</SituateButton
    >
  </template>
  <label for="chat-response-state">Response state</label>
  <SituateSelect
    id="chat-response-state"
    :value="state.phase"
    @change="
      emit(
        'update:state',
        state.workTimeMs !== undefined &&
          ($event.target as HTMLSelectElement).value !== 'working'
          ? finishWorkTime(
              state,
              ($event.target as HTMLSelectElement).value as Exclude<
                Phase,
                'working'
              >,
            )
          : changePhase(
              state,
              ($event.target as HTMLSelectElement).value as Phase,
            ),
      )
    "
  >
    <option value="complete">Complete</option>
    <option
      value="working"
      :disabled="
        state.phase !== 'working' &&
        (!!chatGuard(state.ai) || !!activeQuestion(state.transcript ?? []))
      "
    >
      Working
    </option>
    <option value="cancelled">Stopped</option>
    <option value="error">
      {{
        state.workHistory
          ? historyCopy.en.interruptedState
          : "Interrupted after saved changes"
      }}
    </option>
  </SituateSelect>
  <label for="chat-model-fixture">Model choice example</label>
  <SituateSelect
    id="chat-model-fixture"
    :value="''"
    :disabled="state.phase === 'working'"
    @change="fixture"
  >
    <option value="" disabled>Choose an example…</option>
    <option value="unconfigured">{{ presetCopy.unavailable }}</option>
    <option value="new">Recommended from Settings</option>
    <option value="existing">Conversation override</option>
    <option value="one">One eligible model</option>
    <option value="zero">No eligible models</option>
    <option value="long">Reasoning model · three levels</option>
    <option value="reasoning-limited">Reasoning model · two levels</option>
    <option value="reasoning-default">Inherited reasoning model</option>
    <option value="long-manual">Long manual model ID</option>
    <option value="custom">Manual endpoint model ID</option>
    <option value="loading">Loading models</option>
    <option value="load-error">Catalog failed</option>
    <option value="unavailable">Selected model unavailable</option>
    <option value="saving">Saving choice</option>
    <option value="save-error">Save failed, unchanged</option>
    <option value="uncertain">Save outcome uncertain</option>
    <option value="unsaved">Response not yet saved</option>
    <option value="disconnected">Access unavailable</option>
  </SituateSelect>
  <SituateButton
    variant="secondary"
    size="small"
    v-for="item in availableOutcomes(state.ai).filter(
      (item) =>
        state.phase !== 'working' || !item.id.startsWith('model-response-'),
    )"
    :key="item.id"
    type="button"
    @click="outcome(item.id)"
  >
    {{ item.label }}
  </SituateButton>
  <SituateButton
    variant="secondary"
    size="small"
    type="button"
    @click="outcome('conversation-synced')"
  >
    Receive a reply from another device
  </SituateButton>
  <p v-if="state.ai.handoff" role="status">{{ state.ai.handoff }}</p>
  <p>
    <strong>{{ state.run ? "Active request" : "Next request" }}</strong
    ><br />
    Connection: {{ mainChatRequest(state).connection || "Not configured" }}.
    Chat model:
    {{ mainChatRequest(state).model || "No suitable model available" }}.
    Thinking: {{ mainChatRequest(state).thinking || "Not adjustable" }}. Model
    persistence advances with the outcome buttons above. Thinking choices are
    stored in memory per workspace and model.
  </p>
  <template v-if="state.phase === 'working'">
    <label for="chat-bend-movement">Mini Bend movement</label>
    <SituateSelect
      id="chat-bend-movement"
      :value="state.motion"
      @change="
        emit('update:state', {
          ...state,
          motion: ($event.target as HTMLSelectElement)
            .value as ChatState['motion'],
        })
      "
    >
      <option value="mixed">Mixed gestures</option>
      <option v-for="gesture in gestures" :key="gesture.id" :value="gesture.id">
        {{ gesture.label }}
      </option>
    </SituateSelect>
    <p>
      Ten body gestures alternate with small glances and blinks. Click Mini Bend
      to pause movement without stopping work. These movements are workshop
      proposals, not changes to the canonical brand motion.
    </p>
  </template>
</template>
