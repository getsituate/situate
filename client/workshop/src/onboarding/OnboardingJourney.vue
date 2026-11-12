<script setup lang="ts">
import { computed } from "vue";
import SetupFrame from "../workspaces/SetupFrame.vue";
import { c } from "./content";
import type { OnboardingState } from "./model";
const props = defineProps<{
  state: OnboardingState;
  active: boolean;
  embedded?: boolean;
}>();
defineEmits<{ patch: [patch: Partial<OnboardingState>] }>();
const index = computed(() =>
  props.state.step === "access"
    ? 1
    : ["method", "proposal"].includes(props.state.step)
      ? 2
      : props.state.step === "plan"
        ? 4
        : 3,
);
const blocked = computed(
  () => !props.state.connected || props.state.importState === "failed",
);
const keepsake = computed(() =>
  !["access", "method", "proposal"].includes(props.state.step)
    ? props.state.context
    : "",
);
</script>
<template>
  <SetupFrame
    v-if="active && !embedded"
    :focused="state.step === 'source-chat'"
    :step="index"
    :paused="state.motionPaused"
    :blocked="blocked"
  >
    <template v-if="keepsake" #aside>
      <div class="keepsake">
        <span>{{ c.journey.keepsake }}</span>
        <blockquote>{{ keepsake }}</blockquote>
      </div>
    </template>
    <slot />
  </SetupFrame>
  <slot v-else />
</template>
<style scoped>
.keepsake {
  margin: 24px 20px 0;
  padding: 0 0 0 16px;
  border-left: 3px solid var(--situate-tangerine);
}
.keepsake span {
  font-size: 12px;
  color: var(--situate-muted);
}
blockquote {
  margin: 8px 0 0;
  font-size: 15px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
