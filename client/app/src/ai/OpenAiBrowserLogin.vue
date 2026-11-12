<script setup lang="ts">
import { t, localizeError } from "@situate/localization";
import { onBeforeUnmount, ref, watch } from "vue";
import { SituateButton } from "@situate/ui";
import {
  cancelOpenAiLogin,
  startOpenAiLogin,
  waitOpenAiLogin,
  type Status,
} from "./api";

const props = defineProps<{
  scope: string;
  connectionId?: string;
  label?: string;
}>();
const emit = defineEmits<{ connected: [status: Status]; cancel: [] }>();
const busy = ref(false);
const error = ref<unknown>("");
let alive = true;
let attempt:
  | {
      scope: string;
      cancelled: boolean;
      started: Promise<string>;
      finished: Promise<void>;
    }
  | undefined;
function start(): void {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  const current = {
    scope: props.scope,
    cancelled: false,
    started: startOpenAiLogin(props.scope, props.connectionId, props.label),
    finished: Promise.resolve(),
  };
  attempt = current;
  current.finished = (async () => {
    try {
      const id = await current.started;
      if (current.cancelled || !alive || current.scope !== props.scope) {
        await cancelOpenAiLogin(current.scope, id);
        return;
      }
      const status = await waitOpenAiLogin(current.scope, id);
      if (!status.available || status.config?.auth !== "oauth")
        throw status.reason ?? "ai.theSavedConnectionIsUnavailable";
      if (
        alive &&
        !current.cancelled &&
        current.scope === props.scope &&
        status.available &&
        status.config?.auth === "oauth"
      )
        emit("connected", status);
    } catch (reason) {
      if (alive && !current.cancelled && current.scope === props.scope) {
        error.value =
          typeof reason === "string" && reason.startsWith("native.ai.")
            ? reason
            : "ai.openaiSignInCouldNotFinishCheckYourConnection";
      }
    } finally {
      if (attempt === current) {
        attempt = undefined;
        if (alive) busy.value = false;
      }
    }
  })();
}
async function cancelAndWait(): Promise<void> {
  const current = attempt;
  if (!current) return;
  current.cancelled = true;
  let id: string;
  try {
    id = await current.started;
  } catch {
    await current.finished;
    return;
  }
  await cancelOpenAiLogin(current.scope, id);
  await current.finished;
}
defineExpose({ cancelAndWait });
watch(
  () => props.scope,
  () => {
    void cancelAndWait().catch(() => {});
  },
);
onBeforeUnmount(() => {
  alive = false;
  void cancelAndWait().catch(() => {});
});
</script>

<template>
  <div class="openai-browser-login">
    <div class="sign-in-panel">
      <p v-if="busy" class="sign-in-status" role="status">
        {{ t("ai.waitingForSignIn") }}
      </p>
      <p>
        {{
          busy
            ? t("ai.keepThisWorkspaceOpenReturningToSituateDoesNot")
            : t("ai.yourProviderHandlesSignInNoPasswordIsEntered")
        }}
      </p>
      <SituateButton :disabled="busy" @click="start">{{
        error ? t("ai.trySignInAgain") : t("ai.openSignInInBrowser")
      }}</SituateButton>
      <p v-if="busy" class="help">
        {{ t("ai.completeTheBrowserStepsWithinFiveMinutesYouCan") }}
      </p>
    </div>
    <p v-if="error" role="alert">{{ localizeError(error) }}</p>
  </div>
</template>

<style scoped>
.openai-browser-login {
  display: grid;
  gap: 16px;
  color: var(--situate-ink);
}
p {
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.help {
  color: var(--situate-muted);
  font-size: var(--situate-text-caption);
}
.sign-in-panel {
  display: grid;
  justify-items: start;
  gap: 16px;
  padding: 24px;
  background: var(--situate-surface);
  border: 1px solid var(--situate-control-line);
  border-radius: 20px;
}
.sign-in-status {
  font-weight: 600;
}
</style>
