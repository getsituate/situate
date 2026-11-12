<script setup lang="ts">
import { t, localizeError, localizeProvidedText } from "@situate/localization";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { SituateField, SituateInput, SituateButton } from "@situate/ui";
import AppearanceSettings from "../settings/AppearanceSettings.vue";
import { accentStyle, type Accent } from "../settings/accents";
import {
  chooseParent,
  nameError,
  preflight,
  type RunAction,
  type Workspace,
} from "./api";

const props = defineProps<{
  run: RunAction;
  busy: boolean;
  setup?: boolean;
  operationError?: unknown;
}>();
const emit = defineEmits<{
  cancel: [];
  opened: [];
  open: [event: MouseEvent];
  accent: [accent: Accent];
}>();
const accent = ref<Accent>("violet");
watch(accent, (value) => emit("accent", value));
const name = ref(props.setup ? t("onboarding.creation.defaultName") : "");
const parent = ref<Workspace | null>(null);
const error = ref<unknown>("");
const checking = ref(false);
const choosing = ref(false);
const checked = ref(false);
const touched = ref(false);
const announceValidation = ref(true);
const nameControl =
  useTemplateRef<InstanceType<typeof SituateInput>>("nameControl");
const preview = ref("");
const chooseButtonControl = useTemplateRef<InstanceType<typeof SituateButton>>(
  "chooseButtonControl",
);
const chooseButton = computed(() => chooseButtonControl.value?.element);
const errorBox = useTemplateRef<HTMLElement>("errorBox");
let generation = 0;
let alive = true;
const validation = computed(() => nameError(name.value));
const target = computed(() =>
  parent.value && name.value
    ? localizeProvidedText(parent.value.display).replace(/\/$/u, "") +
      "/" +
      name.value
    : "",
);
const canCreate = computed(
  () =>
    checked.value &&
    !validation.value &&
    !destinationError.value &&
    !checking.value &&
    !choosing.value &&
    !props.busy,
);
const canAttempt = computed(
  () =>
    !props.busy &&
    !choosing.value &&
    !!parent.value &&
    !destinationError.value &&
    (!!validation.value || canCreate.value),
);
const operationError = ref(props.operationError);
watch(
  () => props.operationError,
  (value) => (operationError.value = value),
);
function isDestinationError(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^native\.workspace\.(folder|parent|name)\./u.test(value)
  );
}
const message = computed(() => operationError.value || error.value);
const destinationError = computed(() =>
  isDestinationError(operationError.value) ? operationError.value : error.value,
);
const collision = computed(
  () => destinationError.value === "native.workspace.folder.exists",
);
async function check(): Promise<void> {
  const request = ++generation;
  checked.value = false;
  error.value = "";
  preview.value = "";
  if (!parent.value || validation.value) {
    checking.value = false;
    return;
  }
  checking.value = true;
  try {
    const result = await preflight(parent.value.id, name.value);
    if (alive && request === generation) {
      preview.value = result;
      checked.value = true;
    }
  } catch (e) {
    if (alive && request === generation) error.value = e;
  } finally {
    if (alive && request === generation) checking.value = false;
  }
}
watch(
  [name, parent],
  () => {
    if (isDestinationError(operationError.value)) operationError.value = "";
    void check();
  },
  { flush: "sync" },
);
watch(message, async (value) => {
  if (!value) return;
  await nextTick();
  requestAnimationFrame(() =>
    errorBox.value?.scrollIntoView({ block: "nearest" }),
  );
});
async function choose(pick: boolean): Promise<void> {
  choosing.value = true;
  try {
    const selected = await chooseParent(pick);
    if (alive && selected) parent.value = selected;
  } catch (e) {
    if (alive) error.value = e;
  } finally {
    choosing.value = false;
    await nextTick();
    if (pick && alive) chooseButton.value?.focus();
  }
}
async function create(): Promise<void> {
  announceValidation.value = false;
  touched.value = true;
  if (validation.value) {
    await nextTick();
    nameControl.value?.focus();
    return;
  }
  if (!canCreate.value || !parent.value) return;
  if (await props.run("create", parent.value.id, name.value, accent.value))
    emit("opened");
  else await check();
}
onMounted(() => {
  if (props.setup) document.getElementById("create-title")?.focus();
  emit("accent", accent.value);
  return choose(false);
});
onBeforeUnmount(() => {
  alive = false;
  generation++;
});
</script>

<template>
  <div class="entry-layout without-list" :style="accentStyle(accent)">
    <section class="creation" aria-labelledby="create-title">
      <p class="entry-eyebrow">{{ t("workspace.newWorkspace") }}</p>
      <h1 id="create-title" tabindex="-1">
        {{ t("workspace.createAWorkspace") }}
      </h1>
      <form id="workspace-create" @submit.prevent="create">
        <SituateField
          id="workspace-name"
          class="workspace-name-field"
          :label="t('workspace.workspaceName')"
          :help="t('workspace.nameHelp')"
          :error="touched && validation ? localizeError(validation) : undefined"
          reserve-feedback
          :announce="announceValidation"
          v-slot="{ controlAttrs }"
        >
          <SituateInput
            v-bind="controlAttrs"
            ref="nameControl"
            v-model="name"
            :disabled="busy"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            :placeholder="t('workspace.eGFieldNotes')"
            :aria-invalid="
              controlAttrs['aria-invalid'] || collision || undefined
            "
            :aria-describedby="
              [
                controlAttrs['aria-describedby'],
                collision ? 'folder-error' : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined
            "
            @blur="
              touched = true;
              announceValidation = true;
            "
          />
        </SituateField>
        <label for="workspace-parent">{{
          t("workspace.workspaceFolder")
        }}</label>
        <div class="directory-field">
          <SituateInput
            id="workspace-parent"
            :value="preview ? localizeProvidedText(preview) : target"
            data-localization-content="user"
            readonly
            :placeholder="t('workspace.chooseAFolderToContinue')"
            :aria-invalid="!!destinationError"
            :aria-describedby="destinationError ? 'folder-error' : undefined"
          />
          <SituateButton
            variant="secondary"
            size="small"
            ref="chooseButtonControl"
            type="button"
            :disabled="busy || choosing"
            @click="choose(true)"
          >
            {{ t("workspace.choose") }}
          </SituateButton>
        </div>
        <p v-if="!parent" class="entry-help">
          {{ t("workspace.chooseAFolderToContinue") }}
        </p>
        <div
          v-if="destinationError"
          id="folder-error"
          ref="errorBox"
          class="creation-error"
          role="alert"
        >
          <span class="error-icon" aria-hidden="true">!</span>
          <div>
            <strong>{{
              collision
                ? t("workspace.thisFolderAlreadyExists")
                : t("workspace.couldntCreateTheWorkspace")
            }}</strong>
            <p>
              {{
                collision
                  ? t("workspace.chooseADifferentNameOrParentFolderToCreate")
                  : localizeError(destinationError)
              }}
            </p>
            <SituateButton
              variant="ghost"
              size="small"
              v-if="collision"
              class="error-action"
              type="button"
              :disabled="busy || choosing"
              @click="emit('open', $event)"
            >
              {{ t("workspace.openAnExistingWorkspace") }}
            </SituateButton>
          </div>
        </div>
        <p
          v-else
          class="entry-help"
          role="status"
          :style="{ visibility: checking ? 'visible' : 'hidden' }"
          :aria-hidden="!checking"
        >
          {{ t("workspace.checkingFolder") }}
        </p>
        <AppearanceSettings
          swatches
          :accent="accent"
          :workspace-name="name || t('workspace.newWorkspace')"
          :loading="false"
          :saving="busy"
          :available="true"
          :writable="!busy"
          error=""
          @select="accent = $event"
        />
        <slot name="operation-error">
          <div
            v-if="message && !destinationError"
            class="creation-error"
            role="alert"
          >
            <p>{{ localizeError(message) }}</p>
          </div>
        </slot>
      </form>
    </section>
  </div>
  <footer class="form-actions workspace-create-actions">
    <SituateButton
      variant="secondary"
      size="small"
      type="button"
      :disabled="busy || choosing"
      @click="emit('cancel')"
    >
      {{ t("navigation.cancel") }}
    </SituateButton>
    <SituateButton
      class="entry-primary"
      :busy="busy"
      type="submit"
      form="workspace-create"
      :disabled="!canAttempt"
      :aria-describedby="destinationError ? 'folder-error' : undefined"
      >{{ t("workspace.createWorkspace") }}</SituateButton
    >
  </footer>
</template>
