<script setup lang="ts">
import { computed, useId } from "vue";
import SituateSelect from "../ui/SituateSelect.vue";
import { deviceAiCopy } from "./content";
import { cloneSettings, connectionName, type SettingsState } from "./model";
import { settingsThinking } from "./thinking";
import { connectionCatalog } from "./catalog";
import { thinkingLabels, type ThinkingPreference } from "../chat/thinking";
import { modelChoiceCopy as copy } from "../chat/content";
const props = withDefaults(
  defineProps<{ state: SettingsState; conversationId?: string }>(),
  { conversationId: "chat" },
);
const thinkingModel = computed(() => settingsThinking(props.state));
const thinkingChoice = computed(() => {
  const model = thinkingModel.value;
  return model
    ? (props.state.conversationThinking[props.conversationId]?.[model.key] ??
        "")
    : "";
});
function chooseThinking(event: Event) {
  const model = thinkingModel.value;
  const value = (event.target as HTMLSelectElement).value;
  if (
    !model ||
    (value &&
      value !== "recommended" &&
      !model.capability.levels.some((level) => level === value))
  )
    return;
  const next = cloneSettings(props.state);
  const choices = (next.conversationThinking[props.conversationId] ??= {});
  if (!value) delete choices[model.key];
  else choices[model.key] = value as ThinkingPreference;
  emit("update:state", next);
}
const emit = defineEmits<{ "update:state": [state: SettingsState] }>();
const models = computed(() => connectionCatalog(props.state).models);
function choose(event: Event) {
  const next = cloneSettings(props.state);
  next.chatModel = (event.target as HTMLSelectElement).value;
  emit("update:state", next);
}
const pickerId = useId();
</script>
<template>
  <p v-if="state.useManaged" class="chat-model-picker">
    {{
      state.managedAvailable
        ? deviceAiCopy.managedTitle
        : deviceAiCopy.managedUnavailable
    }}
  </p>
  <div v-else-if="state.showModelPicker" class="chat-model-picker">
    <div>
      <label :for="`${pickerId}-model`"
        >Chat model<template v-if="state.provider">
          · {{ connectionName(state, state.provider) }}</template
        ></label
      >
      <SituateSelect
        :id="`${pickerId}-model`"
        aria-label="Chat model"
        :value="state.chatModel"
        :disabled="!state.provider || state.unavailable === state.provider"
        @change="choose"
      >
        <option value="recommended">Use recommended model</option>
        <option v-for="model in models" :key="model" :value="model">
          {{ model }}
        </option>
      </SituateSelect>
    </div>
    <div v-if="thinkingModel">
      <label :for="`${pickerId}-thinking`">{{ copy.thinking }}</label>
      <SituateSelect
        :id="`${pickerId}-thinking`"
        :aria-label="copy.thinking"
        :value="thinkingChoice"
        :disabled="!state.provider || state.unavailable === state.provider"
        @change="chooseThinking"
      >
        <option value="">
          {{
            thinkingModel.preference === "recommended"
              ? copy.recommended
              : copy.workspaceDefault
          }}
          · {{ thinkingLabels[thinkingModel.level] }}
        </option>
        <option
          v-if="thinkingModel.preference !== 'recommended'"
          value="recommended"
        >
          {{
            copy.recommendedLevel(
              thinkingLabels[thinkingModel.capability.default],
            )
          }}
        </option>
        <option
          v-for="level in thinkingModel.capability.levels"
          :key="level"
          :value="level"
        >
          {{ thinkingLabels[level] }}
        </option>
      </SituateSelect>
    </div>
    <small v-if="!state.provider || state.unavailable === state.provider"
      >Choose a connected provider in Settings.</small
    >
  </div>
</template>
<style scoped>
.chat-model-picker {
  display: grid;
  gap: 6px;
  max-width: 100%;
  font-size: 12px;
  color: var(--situate-muted);
}
.chat-model-picker > div {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.situate-select {
  width: 264px;
  max-width: 100%;
}
</style>
