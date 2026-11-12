<script setup lang="ts">
import { SituateSelect, SituateButton, SituateCheckbox } from "../../ui";
import { computed, useId, watch } from "vue";
import {
  profiles,
  profileFor,
  selectProfile,
  targetSize,
  type PlatformId,
  type PlatformState,
  type ViewSize,
} from "./model";

const profileId = useId();
const state = defineModel<PlatformState>("state", { required: true });
const props = defineProps<{ editing: boolean }>();
const emit = defineEmits<{
  resize: [size: ViewSize];
  platform: [mobile: boolean];
}>();
const profile = computed(() => profileFor(state.value.profile));
const keyboardAvailable = computed(() => profile.value.mobile && props.editing);

watch(
  [keyboardAvailable, () => state.value.keyboardOpen],
  ([available, open]) => {
    if (!available && open)
      state.value = { ...state.value, keyboardOpen: false };
  },
  { immediate: true },
);

function choose(event: Event): void {
  const next = selectProfile(
    state.value,
    (event.target as HTMLSelectElement).value as PlatformId,
  );
  state.value = next;
  emit("platform", profileFor(next.profile).mobile);
  emit("resize", targetSize(next));
}
function keyboard(event: Event): void {
  state.value = {
    ...state.value,
    keyboardOpen: (event.target as HTMLInputElement).checked,
  };
}
</script>

<template>
  <fieldset class="environment-controls">
    <legend>Environment</legend>
    <label :for="profileId">Platform profile</label>
    <SituateSelect :id="profileId" :value="state.profile" @change="choose">
      <option v-for="item in profiles" :key="item.id" :value="item.id">
        {{ item.label }}
      </option>
    </SituateSelect>
    <p>{{ profile.width }} × {{ profile.height }} CSS px</p>
    <SituateButton
      variant="secondary"
      size="small"
      type="button"
      @click="emit('resize', targetSize(state))"
    >
      Use profile size
    </SituateButton>
    <label v-if="keyboardAvailable" class="keyboard">
      <SituateCheckbox :checked="state.keyboardOpen" @change="keyboard" />
      Keyboard occlusion
    </label>
    <p class="help">
      Profiles set a target size and mobile content insets. Window controls
      belong to the host operating system. Keyboard occlusion reduces the
      available content area; it does not open a real keyboard.
    </p>
  </fieldset>
</template>

<style scoped>
.environment-controls {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  color: var(--situate-ink);
}
legend {
  font-size: 18px;
  font-weight: 650;
  margin-bottom: 16px;
}
label {
  display: block;
  font-size: 14px;
  font-weight: 600;
}
span:where(.situate-select) {
  display: block;
  width: 100%;
  margin-top: 6px;
}
p {
  margin: 12px 0;
  font-variant-numeric: tabular-nums;
}
.help {
  font-size: 13px;
  line-height: 1.5;
}
.keyboard {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  margin-top: 12px;
}
input {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
</style>
