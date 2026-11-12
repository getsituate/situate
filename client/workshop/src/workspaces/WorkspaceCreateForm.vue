<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { SituateButton, SituateField, SituateInput } from "../ui";
import fieldCopy from "../localization/en.field-feedback.json";
import { nameError, type RunAction, type Workspace } from "./api";
import { useWorkspaceFormServices } from "./form-services";

const props = withDefaults(
  defineProps<{ run: RunAction; busy: boolean; operationError?: string }>(),
  { operationError: "" },
);
const emit = defineEmits<{
  cancel: [];
  opened: [];
  open: [];
  location: [path: string];
}>();
const name = defineModel<string>("name", { default: "" });
const services = useWorkspaceFormServices();
const { chooseParent, preflight } = services;
const parent = ref<Workspace | null>(null);
const error = ref("");
const checking = ref(false);
const choosing = ref(false);
const checked = ref(false);
const touched = ref(false);
const announceValidation = ref(true);
const preview = ref("");
const chooseButton =
  useTemplateRef<InstanceType<typeof SituateButton>>("chooseButton");
const errorBox = useTemplateRef<HTMLElement>("errorBox");
const nameControl =
  useTemplateRef<InstanceType<typeof SituateInput>>("nameControl");
let generation = 0;
let alive = true;
const validation = computed(() => nameError(name.value));
const target = computed(() =>
  parent.value && name.value
    ? parent.value.display.replace(/\/$/u, "") + "/" + name.value
    : "",
);
const canCreate = computed(
  () =>
    checked.value &&
    !validation.value &&
    !checking.value &&
    !choosing.value &&
    !props.busy,
);
const collision = computed(() => error.value === "This folder already exists.");
const message = computed(() => props.operationError || error.value);
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
    if (alive && request === generation) error.value = String(e);
  } finally {
    if (alive && request === generation) checking.value = false;
  }
}
watch([name, parent, () => services.validationKey?.()], check, {
  flush: "sync",
});
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
    if (alive && selected) {
      parent.value = selected;
      emit("location", selected.display);
    }
  } catch (e) {
    if (alive) error.value = String(e);
  } finally {
    choosing.value = false;
    await nextTick();
    if (pick && alive) chooseButton.value?.element?.focus();
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
  if (await props.run("create", parent.value.id, name.value)) emit("opened");
  else await check();
}
onMounted(() => choose(false));
onBeforeUnmount(() => {
  alive = false;
  generation++;
});
</script>

<template>
  <div class="entry-layout without-list">
    <section class="creation" aria-labelledby="create-title">
      <p class="entry-eyebrow">New workspace</p>
      <h1 id="create-title" tabindex="-1">Make room for what matters.</h1>
      <p>Choose a name and where to keep your workspace.</p>
      <form @submit.prevent="create">
        <SituateField
          id="workspace-name"
          class="workspace-name-field"
          :label="fieldCopy.name"
          :help="fieldCopy.help"
          :error="touched ? validation : undefined"
          reserve-feedback
          :announce="announceValidation"
          v-slot="{ controlAttrs }"
        >
          <SituateInput
            ref="nameControl"
            v-bind="controlAttrs"
            id="workspace-name"
            v-model="name"
            :disabled="busy"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            :placeholder="fieldCopy.placeholder"
            :aria-invalid="!!(touched && validation) || collision"
            :aria-describedby="
              [
                controlAttrs['aria-describedby'],
                collision ? 'folder-error' : undefined,
              ]
                .filter(Boolean)
                .join(' ') || undefined
            "
            @blur="
              announceValidation = true;
              touched = true;
            "
          />
        </SituateField>
        <label for="workspace-parent">Create inside</label>
        <div class="directory-field">
          <SituateInput
            id="workspace-parent"
            :value="parent?.display ?? ''"
            readonly
            placeholder="Choose a folder to continue."
            aria-describedby="parent-help"
          />
          <SituateButton
            variant="secondary"
            size="small"
            ref="chooseButton"
            type="button"
            :disabled="busy || choosing"
            @click="choose(true)"
          >
            Choose…
          </SituateButton>
        </div>
        <p v-if="!parent" class="entry-help">Choose a folder to continue.</p>
        <p id="parent-help" class="entry-help">
          Choose a parent folder. Its existing contents won’t become a
          workspace.
        </p>
        <slot name="appearance" />
        <div class="path-preview" :class="{ 'has-error': !!message }">
          <span>New workspace folder</span>
          <output for="workspace-name workspace-parent">{{
            preview || target || "Enter a name to see the complete path."
          }}</output>
          <div
            v-if="message"
            id="folder-error"
            ref="errorBox"
            class="creation-error"
            role="alert"
          >
            <span class="error-icon" aria-hidden="true">!</span>
            <div>
              <strong>{{
                collision && !operationError
                  ? "This folder already exists."
                  : "Couldn’t create the workspace."
              }}</strong>
              <p>
                {{
                  collision && !operationError
                    ? "Choose a different name or parent folder to create a new workspace."
                    : message
                }}
              </p>
              <SituateButton
                variant="ghost"
                size="small"
                v-if="collision"
                class="error-action"
                type="button"
                :disabled="busy || choosing"
                @click="emit('open')"
              >
                Open an existing workspace…
              </SituateButton>
            </div>
          </div>
          <p v-else-if="checking" class="entry-help" role="status">
            Checking folder…
          </p>
        </div>
      </form>
    </section>
  </div>
  <footer class="form-actions">
    <SituateButton
      variant="secondary"
      size="small"
      type="button"
      :disabled="busy || choosing"
      @click="emit('cancel')"
    >
      Cancel
    </SituateButton>
    <SituateButton
      class="entry-primary"
      :disabled="busy || choosing || checking || (!validation && !canCreate)"
      :aria-describedby="message ? 'folder-error' : undefined"
      @click="create"
      >Create workspace</SituateButton
    >
  </footer>
</template>
