<script setup lang="ts">
import { ref } from "vue";
import ChatComposer from "../components/ChatComposer.vue";
defineProps<{
  modelValue: string;
  placeholder?: string;
  label?: string;
  showLabel?: boolean;
  description?: string;
  compact?: boolean;
  working?: boolean;
  allowFollowup?: boolean;
  sendEnabled?: boolean;
  sendUnavailableReason?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  stop: [];
  send: [];
}>();
const composer = ref<InstanceType<typeof ChatComposer>>();
defineExpose({ focus: () => composer.value?.focus() });
</script>
<template>
  <ChatComposer
    ref="composer"
    :model-value="modelValue"
    :placeholder="placeholder"
    :label="label"
    :show-label="showLabel"
    :description="description"
    :compact="compact"
    :working="working"
    :enabled="sendEnabled && (!working || allowFollowup)"
    :unavailable-reason="sendUnavailableReason"
    :readonly="false"
    @update:model-value="emit('update:modelValue', $event)"
    @stop="emit('stop')"
    @send="emit('send')"
  >
    <template v-if="$slots.options" #options><slot name="options" /></template>
  </ChatComposer>
</template>
