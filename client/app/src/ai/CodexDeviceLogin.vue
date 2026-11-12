<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { localizeError, t } from "@situate/localization";
import { SituateButton } from "@situate/ui";
import {
  cancelCodexLogin,
  openCodexLogin,
  startCodexLogin,
  waitCodexLogin,
  type DeviceChallenge,
  type Status,
} from "./api";
const props = defineProps<{
  scope: string;
  connectionId?: string;
  label?: string;
}>();
const emit = defineEmits<{ connected: [status: Status] }>();
const challenge = ref<DeviceChallenge>();
const busy = ref(false);
const error = ref<unknown>("");
const cancelled = ref(false);
let alive = true;
let attempt:
  | {
      scope: string;
      cancelled: boolean;
      started: Promise<DeviceChallenge>;
      waiting?: Promise<void>;
    }
  | undefined;
function wait(current: NonNullable<typeof attempt>): void {
  if (current.waiting || current.cancelled) return;
  current.waiting = (async () => {
    try {
      const value = await current.started;
      const status = await waitCodexLogin(current.scope, value.id);
      if (alive && attempt === current && !current.cancelled) {
        if (!status.available || !status.config)
          throw status.reason ?? "ai.theSavedConnectionIsUnavailable";
        emit("connected", status);
        challenge.value = undefined;
      }
    } catch (reason) {
      if (alive && attempt === current && !current.cancelled) {
        error.value = reason;
        challenge.value = undefined;
      }
    } finally {
      if (attempt === current) {
        attempt = undefined;
        busy.value = false;
      }
    }
  })();
}
async function start(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  cancelled.value = false;
  const current = {
    scope: props.scope,
    cancelled: false,
    started: startCodexLogin(props.scope, props.connectionId, props.label),
  };
  attempt = current;
  try {
    const value = await current.started;
    if (!alive || current.cancelled || current.scope !== props.scope) return;
    challenge.value = value;
    wait(current);
  } catch (reason) {
    if (alive && attempt === current && !current.cancelled)
      error.value = reason;
    if (attempt === current) {
      attempt = undefined;
      busy.value = false;
    }
  }
}
async function open(): Promise<void> {
  const current = attempt;
  if (!current || !challenge.value) return;
  error.value = "";
  try {
    await openCodexLogin(current.scope, challenge.value.id);
  } catch (reason) {
    if (alive && attempt === current) error.value = reason;
  }
}
async function cancelAndWait(): Promise<void> {
  const current = attempt;
  if (!current) return;
  current.cancelled = true;
  let value: DeviceChallenge;
  try {
    value = await current.started;
  } catch {
    return;
  }
  try {
    await cancelCodexLogin(current.scope, value.id);
    await current.waiting;
    if (attempt === current) attempt = undefined;
    challenge.value = undefined;
    busy.value = false;
    cancelled.value = true;
  } catch (reason) {
    if (alive) error.value = reason;
    throw reason;
  }
}
function resume(): void {
  if (document.visibilityState === "visible" && attempt) wait(attempt);
}
defineExpose({ cancelAndWait });
watch(
  () => props.scope,
  () => {
    void cancelAndWait().catch(() => {});
  },
);
onMounted(() => {
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
});
onBeforeUnmount(() => {
  alive = false;
  window.removeEventListener("focus", resume);
  document.removeEventListener("visibilitychange", resume);
  void cancelAndWait().catch(() => {});
});
</script>
<template>
  <div class="device-login">
    <p>
      {{
        t(challenge ? "ai.device.codeInstructions" : "ai.device.instructions")
      }}
    </p>
    <template v-if="challenge">
      <p>{{ t("ai.device.code") }}</p>
      <output class="device-code" data-localization-content="identity">{{
        challenge.userCode
      }}</output>
      <p data-localization-content="identity">
        {{ challenge.verificationUri }}
      </p>
      <SituateButton @click="open">{{ t("ai.device.open") }}</SituateButton>
      <p role="status">{{ t("ai.device.waiting") }}</p>
    </template>
    <SituateButton v-else :disabled="busy" @click="start">{{
      t("ai.device.start")
    }}</SituateButton>
    <p v-if="busy && !challenge" role="status">
      {{ t("ai.device.preparing") }}
    </p>
    <p v-if="cancelled" role="status">{{ t("ai.device.cancelled") }}</p>
    <p v-if="error" role="alert">{{ localizeError(error) }}</p>
  </div>
</template>
<style scoped>
.device-login {
  display: grid;
  gap: 16px;
  justify-items: start;
  box-sizing: border-box;
  width: 100%;
  max-width: 640px;
  padding: 24px;
  background: var(--situate-surface);
  border: 1px solid var(--situate-control-line);
  border-radius: 20px;
}
p {
  margin: 0;
  overflow-wrap: anywhere;
}
.device-code {
  padding: 12px 16px;
  background: var(--situate-accent-soft, var(--situate-lilac));
  border-radius: var(--situate-radius-small);
  font-size: 28px;
  font-weight: 600;
  letter-spacing: 0.08em;
  user-select: all;
  overflow-wrap: anywhere;
}
</style>
