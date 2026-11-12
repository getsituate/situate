<script setup lang="ts">
import { SituateButton } from "@situate/ui";
import { t } from "@situate/localization";
import {
  nextTick,
  onMounted,
  onBeforeUnmount,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import SetupFrame from "./SetupFrame.vue";
import { finaleTiming, newFinale } from "./setup-journey/finale/score";
import { useFinalePlayback } from "./setup-journey/finale/use-finale-playback";

const props = defineProps<{ workspaceName: string; ready: boolean }>();
const emit = defineEmits<{
  finished: [];
  presentation: [frame: { reveal: boolean; scale: number }];
}>();
const root = ref<HTMLElement>();
const skip = useTemplateRef<InstanceType<typeof SituateButton>>("skip");
const state = ref(newFinale());
const clock = useFinalePlayback(
  root,
  () => ({ ...state.value, paused: state.value.paused || !props.ready }),
  () => false,
  () => emit("finished"),
);
watch(
  () => [clock.time.value, props.ready],
  () => {
    const frame = finaleTiming(clock.time.value);
    emit("presentation", {
      reveal: props.ready && frame.reveal > 0,
      scale: frame.workspaceScale,
    });
  },
);
let alive = true;
onBeforeUnmount(() => {
  alive = false;
});
onMounted(async () => {
  state.value.status = "playing";
  await nextTick();
  if (alive) skip.value?.element?.focus({ preventScroll: true });
});
</script>

<template>
  <div ref="root" class="setup-finale-overlay">
    <SetupFrame
      continuous
      :step="4"
      :workspace="workspaceName"
      :finale-time="ready ? clock.time.value : 0"
    >
      <template #finale-actions>
        <SituateButton
          variant="secondary"
          :aria-pressed="state.paused"
          @click="state.paused = !state.paused"
          >{{
            t(
              state.paused
                ? "onboarding.finale.resume"
                : "onboarding.finale.pause",
            )
          }}</SituateButton
        >
        <SituateButton ref="skip" class="finale-skip" @click="clock.finish">
          {{ t("onboarding.finale.skip") }} <span aria-hidden="true">↗</span>
        </SituateButton>
      </template>
    </SetupFrame>
  </div>
</template>

<style scoped>
.setup-finale-overlay {
  position: absolute;
  inset: 0;
}
.finale-skip {
  background: var(--situate-violet-deep);
  color: var(--situate-surface);
  border-color: var(--situate-violet-deep);
}
.finale-skip span {
  margin-left: 12px;
}
</style>
