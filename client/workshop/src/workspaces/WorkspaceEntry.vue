<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from "vue";
import SituateMenu from "../ui/SituateMenu.vue";
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import { SituateButton, SituateDialog } from "../ui";
import wordmark from "../brand/assets/wordmark.svg";
import bend from "../brand/bend/svg/wave-welcome.svg";
import WorkspaceCreateForm from "./WorkspaceCreateForm.vue";
import WorkspaceRow from "./WorkspaceRow.vue";
import type { RunAction, Snapshot, Workspace } from "./api";
import "./workspace-entry.css";

const props = defineProps<{
  state: Snapshot;
  run: RunAction;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{ back: []; opened: [] }>();
const creating = defineModel<boolean>("creating", { default: false });
const removing = defineModel<Workspace | null>("removing", { default: null });
const draftName = defineModel<string>("draftName", { default: "" });
const confirmation =
  useTemplateRef<InstanceType<typeof SituateDialog>>("confirmation");
const createButton =
  useTemplateRef<InstanceType<typeof SituateButton>>("createButton");
const appTrigger =
  useTemplateRef<InstanceType<typeof SituateButton>>("appTrigger");
const appMenuOpen = ref(false);
const appMenuId = useId();
const appInitialFocus = ref<"first" | "last">("first");
function showAppMenu(last = false) {
  appInitialFocus.value = last ? "last" : "first";
  appMenuOpen.value = true;
}
const rows = new Map<string, InstanceType<typeof WorkspaceRow>>();
const known = computed(() =>
  props.state.known.filter((k) => !props.state.open.some((o) => o.id === k.id)),
);
const empty = computed(
  () => !props.state.known.length && !props.state.open.length,
);
const sections = computed(() =>
  props.state.mobile
    ? [
        { title: "Open workspaces", items: props.state.open },
        { title: "Your workspaces", items: known.value },
      ].filter((section) => section.items.length)
    : [
        {
          title: "Your workspaces",
          items: [
            ...props.state.known,
            ...props.state.open.filter(
              (o) => !props.state.known.some((k) => k.id === o.id),
            ),
          ],
        },
      ],
);
watch(
  removing,
  async (value) => {
    await nextTick();
    if (value && !confirmation.value?.element?.open)
      confirmation.value?.element?.showModal();
    else if (!value) confirmation.value?.element?.close();
  },
  { immediate: true },
);
let removeOrigin: string | null = null;
async function showCreation(): Promise<void> {
  draftName.value = "";
  creating.value = true;
  await nextTick();
  document.getElementById("create-title")?.focus();
}
async function cancelCreation(): Promise<void> {
  creating.value = false;
  await nextTick();
  createButton.value?.element?.focus();
}
async function open(
  action: "pick" | "open" | "regrant",
  id?: string,
): Promise<void> {
  if (await props.run(action, id)) {
    creating.value = false;
    emit("opened");
  }
}
async function askRemoval(workspace: Workspace): Promise<void> {
  removeOrigin = workspace.id;
  removing.value = workspace;
}
function cancelRemoval(): void {
  confirmation.value?.element?.close();
  removing.value = null;
  if (removeOrigin) rows.get(removeOrigin)?.focus();
}
async function remove(): Promise<void> {
  if (!removing.value) return;
  const id = removing.value.id;
  const index = sections.value
    .flatMap((section) => section.items)
    .findIndex((item) => item.id === id);
  if (await props.run("remove", id)) {
    confirmation.value?.element?.close();
    removing.value = null;
    await nextTick();
    const remaining = sections.value.flatMap((section) => section.items);
    const neighbor = remaining[Math.min(index, remaining.length - 1)];
    const row = rows.get(id) ?? (neighbor ? rows.get(neighbor.id) : undefined);
    if (row) row.focus();
    else createButton.value?.element?.focus();
  }
}
function back(): boolean {
  if (props.busy) return true;
  if (confirmation.value?.element?.open) {
    cancelRemoval();
    return true;
  }
  const menu = document.querySelector<HTMLElement>(
    '[role="menu"]:popover-open',
  );
  if (menu) {
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    return true;
  }
  if (creating.value) {
    void cancelCreation();
    return true;
  }
  if (props.state.current) {
    emit("back");
    return true;
  }
  return false;
}
defineExpose({ back });
</script>

<template>
  <main class="workspace-entry" :class="{ 'mobile-entry': state.mobile }">
    <div
      class="workspace-window"
      :class="{ 'compact-entry': empty || creating }"
    >
      <header class="entry-titlebar">
        <img :src="wordmark" alt="Situate" width="110" height="34" />
        <div class="entry-titlebar-actions">
          <SituateButton
            variant="ghost"
            size="small"
            v-if="state.current && !creating"
            type="button"
            class="entry-back"
            :disabled="busy"
            @click="emit('back')"
          >
            Back
          </SituateButton>
          <span>Workspaces</span>
          <template v-if="!state.mobile">
            <SituateButton
              ref="appTrigger"
              variant="plain"
              class="entry-app-trigger"
              aria-label="Application actions"
              aria-haspopup="menu"
              :aria-expanded="appMenuOpen"
              :aria-controls="appMenuId"
              :popovertarget="appMenuId"
              @click.prevent="appMenuOpen = !appMenuOpen"
              @keydown.down.prevent="showAppMenu()"
              @keydown.up.prevent="showAppMenu(true)"
              >⋯</SituateButton
            >
            <SituateMenu
              :id="appMenuId"
              :open="appMenuOpen"
              :anchor="appTrigger?.element"
              label="Application actions"
              :initial-focus="appInitialFocus"
              @close="appMenuOpen = false"
            >
              <SituateButton
                variant="plain"
                role="menuitem"
                tabindex="-1"
                :disabled="busy"
                @click="run('quit')"
                >Quit Situate</SituateButton
              >
            </SituateMenu>
          </template>
        </div>
      </header>
      <div
        v-if="!creating"
        class="entry-layout"
        :class="{ 'without-list': empty }"
      >
        <aside
          v-if="!empty && !creating"
          class="workspace-lists"
          aria-label="Workspaces on this device"
        >
          <section
            v-for="section in sections"
            :key="section.title"
            :aria-label="section.title"
          >
            <div class="list-heading">
              <h2>{{ section.title }}</h2>
              <span v-if="!state.mobile">On this device</span>
            </div>
            <ul>
              <WorkspaceRow
                v-for="workspace in section.items"
                :key="workspace.id"
                :ref="
                  (value) => {
                    if (value)
                      rows.set(
                        workspace.id,
                        value as InstanceType<typeof WorkspaceRow>,
                      );
                    else rows.delete(workspace.id);
                  }
                "
                :workspace="workspace"
                :open="state.open.some((o) => o.id === workspace.id)"
                :listed="state.known.some((k) => k.id === workspace.id)"
                :current="state.current?.id === workspace.id"
                :mobile="state.mobile"
                :busy="busy"
                @open="open('open', workspace.id)"
                @close="run('close', workspace.id)"
                @remove="askRemoval(workspace)"
              />
            </ul>
          </section>
        </aside>
        <section class="entry-content" aria-labelledby="entry-title">
          <div class="entry-welcome">
            <div>
              <p class="entry-eyebrow">A place for your own way of working</p>
              <h1 id="entry-title">
                {{
                  empty
                    ? "Welcome to Situate."
                    : "Where would you like to begin?"
                }}
              </h1>
              <p>
                {{
                  empty
                    ? "Keep your tasks, knowledge and documents together in a workspace."
                    : "Return to a workspace, or make room for something new."
                }}
              </p>
            </div>
            <img
              v-if="empty && !error && !state.failures.length"
              :src="bend"
              alt=""
              width="128"
              height="128"
            />
          </div>
          <div class="entry-actions" aria-label="Workspace actions">
            <SituateButton
              variant="plain"
              ref="createButton"
              type="button"
              class="entry-action primary-choice"
              :disabled="busy"
              @click="showCreation"
            >
              <span class="action-icon" aria-hidden="true">＋</span>
              <span
                ><strong>Create a workspace</strong
                ><small
                  >Start fresh in a new folder on this device.</small
                ></span
              >
              <span aria-hidden="true">→</span>
            </SituateButton>
            <SituateButton
              variant="plain"
              type="button"
              class="entry-action"
              :disabled="busy"
              @click="open('pick')"
            >
              <span class="action-icon" aria-hidden="true">↗</span>
              <span
                ><strong>Open a workspace</strong
                ><small
                  >Choose an existing Situate workspace folder.</small
                ></span
              >
              <span aria-hidden="true">→</span>
            </SituateButton>
            <SituateButton
              variant="plain"
              type="button"
              class="entry-action sync-choice"
              disabled
              aria-describedby="sync-unavailable"
            >
              <span class="action-icon" aria-hidden="true">⇄</span>
              <span
                ><strong>Bring a workspace from sync</strong
                ><small
                  >Make an existing synced workspace available here.</small
                ></span
              >
              <span aria-hidden="true">→</span>
            </SituateButton>
            <p id="sync-unavailable" class="entry-help sync-help">
              Sync is unavailable.
            </p>
          </div>
          <p v-if="error" role="alert" class="entry-error">{{ error }}</p>
          <section
            v-if="state.failures.length"
            class="restore-failures"
            aria-label="Workspaces that need attention"
          >
            <h2>Some workspaces couldn’t be reopened.</h2>
            <SituateDisclosure label="Review">
              <div
                v-for="failure in state.failures"
                :key="failure.location.id"
                class="restore-failure"
              >
                <strong>{{ failure.location.name }}</strong>
                <p class="location">{{ failure.location.display }}</p>
                <p>{{ failure.message }}</p>
                <SituateButton
                  variant="secondary"
                  size="small"
                  type="button"
                  :disabled="busy"
                  @click="open('open', failure.location.id)"
                >
                  Retry
                </SituateButton>
                <SituateButton
                  variant="secondary"
                  size="small"
                  type="button"
                  :disabled="busy"
                  @click="open('regrant', failure.location.id)"
                >
                  Grant access…
                </SituateButton>
                <SituateButton
                  variant="secondary"
                  size="small"
                  type="button"
                  :disabled="busy"
                  @click="run('close', failure.location.id)"
                >
                  Close workspace
                </SituateButton>
              </div>
            </SituateDisclosure>
          </section>
        </section>
      </div>
      <WorkspaceCreateForm
        v-else
        v-model:name="draftName"
        :run="run"
        :busy="busy"
        :operation-error="error"
        @cancel="cancelCreation"
        @open="open('pick')"
        @opened="
          creating = false;
          emit('opened');
        "
      />
      <p class="operation-status" role="status">{{ busy ? "Working…" : "" }}</p>
    </div>
    <SituateDialog
      ref="confirmation"
      class="removal-dialog"
      aria-labelledby="remove-title"
      aria-describedby="remove-description"
      @cancel.prevent="cancelRemoval"
    >
      <template v-if="removing">
        <h2 id="remove-title">Remove from your list?</h2>
        <p>
          <strong>{{ removing.name }}</strong>
        </p>
        <p id="remove-description">
          The workspace folder and its files will not be deleted.
        </p>
        <p v-if="state.open.some((o) => o.id === removing?.id)">
          This workspace will remain open.
        </p>
        <p v-if="error" class="entry-error" role="alert">{{ error }}</p>
        <footer>
          <SituateButton
            variant="secondary"
            size="small"
            type="button"
            autofocus
            :disabled="busy"
            @click="cancelRemoval"
          >
            Keep in list
          </SituateButton>
          <SituateButton class="entry-primary" :disabled="busy" @click="remove"
            >Remove from list</SituateButton
          >
        </footer>
      </template>
    </SituateDialog>
  </main>
</template>
