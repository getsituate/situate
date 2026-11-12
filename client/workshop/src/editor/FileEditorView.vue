<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import {
  SituateButton,
  SituateIconButton,
  SituateSelect,
  SituateInput,
  SituateTextarea,
  SituateCheckbox,
} from "../ui";
import EditorChatPane from "./EditorChatPane.vue";
import EditorDialog from "./EditorDialog.vue";
import SituateMenu from "../ui/SituateMenu.vue";
import ConflictReview from "./ConflictReview.vue";
import { conflictBlocksFile } from "./conflicts";
import FileTree from "./FileTree.vue";
import MarkdownContent from "./MarkdownContent.vue";
import { diffLines } from "./markdown";
import {
  affectedFiles,
  applyItemAction,
  closePane,
  currentFile,
  deleteItem,
  destinationFolders,
  editDraft,
  flushSaves,
  inspectVersion,
  liveFiles,
  openChat,
  openReference,
  referenceForCurrent,
  saveFile,
  selectFile,
  setHistory,
  setMode,
  targetFolder,
  targetLabel,
  type EditorState,
  type FileReference,
  type ItemAction,
  type ItemTarget,
} from "./model";
import { useEditorState } from "./use-editor-state";

const props = withDefaults(
  defineProps<{
    state: EditorState;
    navigationId?: string;
    navigationOpen?: boolean;
    showNavigation?: boolean;
  }>(),
  { navigationOpen: false, showNavigation: true },
);
const emit = defineEmits<{
  "update:state": [state: EditorState];
  openNavigation: [event: MouseEvent];
}>();
const { state, update } = useEditorState(props, emit);
const instanceId = useId();
const root = ref<HTMLElement>(),
  filesPane = ref<HTMLElement>(),
  source = ref<InstanceType<typeof SituateTextarea>>(),
  documentTitle = ref<HTMLElement>();
const single = ref(false),
  fileCompact = ref(false);
const file = computed(() => currentFile(state.value));
const versions = computed(() => file.value?.versions || []);
const differences = computed(() =>
  state.value.historical && file.value
    ? diffLines(
        state.value.historical.content,
        state.value.historicalComparison ?? file.value.draft,
      )
    : [],
);
watch(
  () => file.value?.content,
  async (content, previous) => {
    if (content === previous || state.value.historical) return;
    const input = source.value?.element,
      scroll = root.value?.querySelector<HTMLElement>(".document-scroll");
    const selection = input
      ? ([
          input.selectionStart,
          input.selectionEnd,
          input.selectionDirection,
        ] as const)
      : null;
    const positions = [
      input?.scrollTop || 0,
      input?.scrollLeft || 0,
      scroll?.scrollTop || 0,
      scroll?.scrollLeft || 0,
    ];
    await nextTick();
    if (input && input === source.value?.element && selection) {
      input.setSelectionRange(...selection);
      input.scrollTop = positions[0];
      input.scrollLeft = positions[1];
    }
    if (scroll) {
      scroll.scrollTop = positions[2];
      scroll.scrollLeft = positions[3];
    }
  },
  { flush: "pre" },
);
const saveStatus = computed(() =>
  conflictBlocksFile(state.value, state.value.currentKey)
    ? "Local save paused · Review versions"
    : file.value?.saveError
      ? "Couldn’t save. Changes are kept here."
      : file.value && file.value.draft !== file.value.content
        ? "Saving…"
        : "Saved",
);
const tabs = computed(() => [
  ...(state.value.filesOpen ? [{ key: "files", title: "Files" }] : []),
  ...state.value.chats.map((chat) => ({ key: chat.key, title: chat.title })),
]);
const filesVisible = computed(
  () =>
    state.value.filesOpen &&
    (!single.value || state.value.activePane === "files"),
);
const chatVisible = (key: string) =>
  single.value
    ? state.value.activePane === key
    : state.value.activeChat === key;
const feedback = ref("");
const rootTarget: ItemTarget = { kind: "folder", path: "" };
const dialog = computed({
  get: () => state.value.dialog,
  set: (value) =>
    update((next) => {
      next.dialog = value;
    }),
});
const menuTitle = computed(() =>
  dialog.value?.kind === "menu"
    ? targetLabel(state.value, dialog.value.target)
    : "",
);
const nameTitle = computed(() => {
  if (dialog.value?.kind !== "name") return "";
  const { action, target } = dialog.value;
  return action === "create"
    ? "New file"
    : action === "folder"
      ? "New folder"
      : `${action === "rename" ? "Rename" : action === "move" ? "Move" : "Duplicate"} ${target.kind}`;
});
const deletingDirty = computed(
  () =>
    dialog.value?.kind === "delete" &&
    affectedFiles(state.value, dialog.value.target).some(
      (item) => item.draft !== item.content,
    ),
);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
watch(
  () =>
    state.value.files
      .filter(
        (item) =>
          !item.deleted &&
          item.draft !== item.content &&
          !item.saveError &&
          !conflictBlocksFile(state.value, item.key),
      )
      .map((item) => [item.key, item.draft]),
  (pending) => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const [key] of pending)
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          update((next) => saveFile(next, key));
        }, 350),
      );
  },
  { immediate: true },
);
watch(
  () => state.value.saveOutcome,
  (value, previous) => {
    if (value === "success" && previous === "failure") update(flushSaves);
  },
);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver((entries) => {
      const focused = root.value?.contains(document.activeElement)
        ? (document.activeElement as HTMLElement)
        : null;
      for (const entry of entries) {
        if (entry.target === root.value)
          single.value =
            entry.contentRect.width < 840 || entry.contentRect.height < 480;
        if (entry.target === filesPane.value)
          fileCompact.value = entry.contentRect.width <= 560;
      }
      void nextTick(() => {
        if (focused && !focused.getClientRects().length && !dialog.value)
          focusPane();
      });
    });
    if (root.value) observer.observe(root.value);
    if (filesPane.value) observer.observe(filesPane.value);
  }
  const width = root.value?.getBoundingClientRect().width || 1000;
  single.value = width < 840;
  if (width <= 560) {
    fileCompact.value = true;
    update((next) => {
      next.treeOpen = false;
    });
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  for (const timer of timers.values()) clearTimeout(timer);
});
function focusPane() {
  const key = single.value
    ? state.value.activePane
    : state.value.activeChat || "files";
  if (key === "files") documentTitle.value?.focus();
  else
    root.value
      ?.querySelector<HTMLElement>(`[data-chat="${key}"] textarea`)
      ?.focus();
  if (!key)
    root.value?.querySelector<HTMLElement>(".empty-tabs button")?.focus();
}
function switchTab(key: string) {
  update((next) => {
    next.activePane = key;
    if (key !== "files") next.activeChat = key;
  });
}
function tabKeyboard(event: KeyboardEvent, key: string) {
  if (event.key === "Delete") {
    event.preventDefault();
    if (!event.repeat) requestClose(key);
    return;
  }
  const index = tabs.value.findIndex((tab) => tab.key === key),
    length = tabs.value.length;
  const next =
    event.key === "ArrowRight"
      ? (index + 1) % length
      : event.key === "ArrowLeft"
        ? (index + length - 1) % length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? length - 1
            : null;
  if (next !== null) {
    event.preventDefault();
    const tab = tabs.value[next];
    switchTab(tab.key);
    void nextTick(() =>
      root.value
        ?.querySelector<HTMLElement>(`[data-tab="${tab.key}"]`)
        ?.focus(),
    );
  }
}
function chooseFile(key: string) {
  update((next) => {
    selectFile(next, key);
    if (fileCompact.value) next.treeOpen = false;
  });
  void nextTick(() => documentTitle.value?.focus());
}
function changeMode(mode: "read" | "source", offset?: number) {
  update((next) => setMode(next, mode));
  void nextTick(() => {
    if (mode === "source") {
      const position =
        offset ??
        /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(
          file.value?.draft || "",
        )?.[0].length ??
        0;
      source.value?.element?.focus();
      source.value?.element?.setSelectionRange(position, position);
      const element = source.value?.element;
      if (element)
        element.scrollTop = Math.max(
          0,
          (file.value?.draft.slice(0, position).split("\n").length || 1) * 25 -
            element.clientHeight / 3,
        );
    } else root.value?.querySelector<HTMLElement>(".markdown")?.focus();
  });
}
function inputSource(event: Event) {
  const input = event.target as HTMLTextAreaElement;
  const value = input.value;
  if (!file.value || conflictBlocksFile(state.value, file.value.key)) return;
  let accepted = false;
  update((next) => {
    accepted = editDraft(next, value);
  });
  if (!accepted) {
    dialog.value = {
      kind: "id",
      key: file.value.key,
      value,
      start: input.selectionStart,
      end: input.selectionEnd,
    };
    input.value = file.value.draft;
  }
}
function finishId(apply: boolean) {
  if (dialog.value?.kind !== "id") return;
  const pending = dialog.value;
  if (apply && state.value.currentKey === pending.key)
    update((next) => {
      next.idEditingAllowed = true;
      editDraft(next, pending.value);
    });
  dialog.value = null;
  void nextTick(() => {
    source.value?.element?.focus();
    source.value?.element?.setSelectionRange(pending.start, pending.end);
  });
}
function dismissDialog() {
  if (dialog.value?.kind === "id") finishId(false);
  else dialog.value = null;
}
function showMenu(
  target: ItemTarget,
  point: { x: number; y: number },
  document = false,
) {
  update((next) => {
    next.selected = target;
    next.dialog = { kind: "menu", target, point, document };
  });
}
function creationMenu(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const folder = targetFolder(state.value, state.value.selected);
  dialog.value = {
    kind: "menu",
    target: {
      kind: "folder",
      path: state.value.folders.includes(folder) ? folder : "",
    },
    document: false,
    creationOnly: true,
    point: { x: rect.right, y: rect.bottom },
  };
}
function buttonMenu(event: MouseEvent, target: ItemTarget, document = false) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  showMenu(target, { x: rect.right, y: rect.bottom }, document);
}
function nameAction(action: ItemAction) {
  if (dialog.value?.kind !== "menu") return;
  const target = dialog.value.target,
    label = targetLabel(state.value, target);
  const folder = targetFolder(state.value, target);
  const originalParent =
    target.kind === "folder"
      ? folder.split("/").slice(0, -1).join("/")
      : folder;
  dialog.value = {
    kind: "name",
    target,
    action,
    name:
      action === "create"
        ? "untitled.md"
        : action === "folder"
          ? "New folder"
          : action === "duplicate"
            ? target.kind === "folder"
              ? label + " copy"
              : label.replace(/\.md$/i, "-copy.md")
            : label,
    folder:
      action === "create" || action === "folder" ? folder : originalParent,
    error: "",
  };
}
function submitName() {
  if (dialog.value?.kind !== "name") return;
  const form = dialog.value;
  let error: string | null = null;
  update((next) => {
    error = applyItemAction(
      next,
      form.action,
      form.target,
      form.name,
      form.folder,
    );
    if (!error && form.action === "create" && fileCompact.value)
      next.treeOpen = false;
  });
  if (error) {
    update((next) => {
      if (next.dialog?.kind === "name") next.dialog.error = error!;
    });
    return;
  }
  dialog.value = null;
  feedback.value = form.name + " is ready.";
  if (form.action === "create")
    void nextTick(() => source.value?.element?.focus());
}
function askDelete() {
  if (dialog.value?.kind !== "menu") return;
  const target = dialog.value.target;
  update((next) =>
    affectedFiles(next, target).forEach((item) => saveFile(next, item.key)),
  );
  dialog.value = { kind: "delete", target };
}
function confirmDelete() {
  if (dialog.value?.kind !== "delete") return;
  const target = dialog.value.target;
  update((next) => deleteItem(next, target));
  dialog.value = null;
  feedback.value = "Deleted from the current collection.";
}
function toggleTree() {
  update((next) => {
    if (next.historyOpen) {
      next.historyOpen = false;
      next.historical = null;
    }
    next.treeOpen = !next.treeOpen;
  });
  void nextTick(() =>
    root.value?.querySelector<HTMLInputElement>(".file-filter")?.focus(),
  );
}
function history(open: boolean) {
  update((next) => setHistory(next, open));
  void nextTick(() =>
    root.value
      ?.querySelector<HTMLElement>(open ? ".close-history" : ".history-toggle")
      ?.focus(),
  );
}
function chooseVersion(index: number) {
  update((next) => {
    inspectVersion(
      next,
      index === 0 ? null : currentFile(next)!.versions[index],
    );
    if (fileCompact.value) next.historyOpen = false;
  });
  void nextTick(() => documentTitle.value?.focus());
}
function newChat(withFile = false) {
  update((next) =>
    openChat(next, withFile ? referenceForCurrent(next) : undefined),
  );
  void nextTick(focusPane);
}
function requestClose(key: string) {
  if (state.value.chats.find((chat) => chat.key === key)?.draft)
    dialog.value = { kind: "close", key };
  else {
    update((next) => closePane(next, key));
    void nextTick(focusPane);
  }
}
function discardChat() {
  if (dialog.value?.kind !== "close") return;
  const key = dialog.value.key;
  dialog.value = null;
  update((next) => closePane(next, key));
  void nextTick(focusPane);
}
function attach(key: string) {
  if (dialog.value?.kind !== "attach") return;
  const chatKey = dialog.value.key;
  update((next) => {
    flushSaves(next);
    const chat = next.chats.find((item) => item.key === chatKey),
      target = liveFiles(next).find((item) => item.key === key);
    if (
      chat &&
      target &&
      !chat.references.some(
        (reference) => reference.fileKey === key && !reference.version,
      )
    )
      chat.references.push({ fileKey: key, name: target.name, version: null });
  });
  dialog.value = null;
  void nextTick(focusPane);
}
function followReference(reference: FileReference) {
  update((next) => {
    openReference(next, reference);
    if (fileCompact.value) next.treeOpen = false;
  });
  void nextTick(() => documentTitle.value?.focus());
}
function updateChat(key: string, value: string) {
  update((next) => {
    const chat = next.chats.find((item) => item.key === key);
    if (chat) {
      chat.draft = value;
      next.activePane = key;
      next.activeChat = key;
    }
  });
}
function removeReference(key: string, index: number) {
  update((next) => {
    next.chats.find((item) => item.key === key)?.references.splice(index, 1);
  });
}
function shortcut(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === "s" && !dialog.value) {
    event.preventDefault();
    update(flushSaves);
  }
}
</script>

<template>
  <section
    ref="root"
    class="editor-workspace"
    :class="{ single }"
    aria-label="Files and chats"
    @keydown="shortcut"
  >
    <div class="workspace-content">
      <section
        ref="filesPane"
        v-show="filesVisible"
        class="files-pane"
        :id="instanceId + '-files'"
        aria-label="Files"
        :role="single ? 'tabpanel' : undefined"
        :aria-labelledby="single ? instanceId + '-tab-files' : undefined"
      >
        <div class="file-layout" :class="{ 'compact-files': fileCompact }">
          <aside
            v-if="state.treeOpen"
            class="file-browser"
            aria-label="Workspace files"
          >
            <div class="browser-header">
              <SituateIconButton
                v-if="showNavigation"
                icon="menu"
                label="Open navigation"
                :aria-controls="navigationId"
                :aria-expanded="navigationOpen"
                @click="emit('openNavigation', $event)"
              /><span>Files</span>
              <SituateIconButton
                icon="plus"
                label="New file or folder"
                aria-haspopup="menu"
                @click="creationMenu"
              />
              <SituateIconButton
                icon="collapse"
                label="Hide file browser"
                :aria-expanded="true"
                @click="toggleTree"
              />
            </div>
            <SituateInput
              appearance="plain"
              class="file-filter"
              type="search"
              :value="state.filter"
              placeholder="Find a file…"
              aria-label="Filter files by name"
              @input="
                update((next) => {
                  next.filter = ($event.target as HTMLInputElement).value;
                })
              "
            />
            <FileTree
              :state="state"
              @select="chooseFile"
              @toggle="
                (path) =>
                  update((next) => {
                    next.selected = { kind: 'folder', path };
                    next.expanded = next.expanded.includes(path)
                      ? next.expanded.filter((item) => item !== path)
                      : [...next.expanded, path];
                  })
              "
              @actions="showMenu"
            />
            <footer class="browser-footer">
              <span>{{ liveFiles(state).length }} files</span
              ><span>On this device</span>
            </footer>
          </aside>
          <section
            v-show="!fileCompact || (!state.treeOpen && !state.historyOpen)"
            class="document-pane"
            aria-label="Open document"
          >
            <header class="document-bar">
              <div class="document-heading">
                <SituateIconButton
                  v-if="showNavigation && !state.treeOpen"
                  icon="menu"
                  label="Open navigation"
                  :aria-controls="navigationId"
                  :aria-expanded="navigationOpen"
                  @click="emit('openNavigation', $event)"
                />
                <SituateIconButton
                  v-if="!state.treeOpen"
                  icon="collapse"
                  label="Show file browser"
                  :aria-expanded="false"
                  @click="toggleTree"
                />
                <div class="document-location">
                  <p :title="file?.folder || 'Personal'">
                    {{ file?.folder.split("/").join(" / ") || "Personal" }}
                  </p>
                  <h3 ref="documentTitle" tabindex="-1" :title="file?.name">
                    {{ file?.name || "Your files" }}
                  </h3>
                </div>
              </div>
              <div class="document-actions">
                <SituateButton
                  variant="plain"
                  v-if="file"
                  class="text-button history-toggle"
                  :aria-expanded="state.historyOpen"
                  aria-label="Version history"
                  @click="history(!state.historyOpen)"
                >
                  History
                </SituateButton>
                <SituateIconButton
                  v-if="file"
                  icon="chat"
                  label="New chat with this file"
                  @click="newChat(true)"
                />
                <SituateButton
                  variant="plain"
                  v-if="file"
                  class="more-button"
                  aria-label="File actions"
                  aria-haspopup="menu"
                  @click="
                    buttonMenu($event, { kind: 'file', key: file.key }, true)
                  "
                >
                  ···
                </SituateButton>
                <SituateIconButton
                  icon="close"
                  label="Close pane — Files"
                  @click="requestClose('files')"
                />
              </div>
            </header>
            <div v-if="state.historical" class="historical-notice">
              <div>
                <strong>Earlier version</strong
                ><span
                  >{{ state.historical.label }} ·
                  {{ state.historical.author }}</span
                >
              </div>
              <SituateButton
                variant="plain"
                class="text-button"
                @click="
                  update((next) => {
                    next.historical = null;
                  })
                "
              >
                Back to current
              </SituateButton>
            </div>
            <div class="document-scroll">
              <template v-if="file">
                <div
                  v-if="state.historical && state.compare"
                  class="diff-view"
                  aria-label="Version differences"
                >
                  <div class="diff-summary">
                    <span>Earlier version → current document</span
                    ><span
                      >+
                      {{
                        differences.filter((row) => row.kind === "added").length
                      }}
                      added</span
                    ><span
                      >−
                      {{
                        differences.filter((row) => row.kind === "removed")
                          .length
                      }}
                      removed</span
                    >
                  </div>
                  <div
                    v-for="(row, index) in differences"
                    :key="index"
                    class="diff-line"
                    :class="row.kind"
                  >
                    <span class="marker">{{
                      row.kind === "added"
                        ? "+"
                        : row.kind === "removed"
                          ? "−"
                          : " "
                    }}</span
                    ><span>{{ row.text || " " }}</span>
                  </div>
                </div>
                <div
                  v-else-if="state.mode === 'source' && !state.historical"
                  class="source-wrap"
                >
                  <div class="source-hint">
                    {{
                      state.idEditingAllowed
                        ? "ID editing allowed until you leave Source."
                        : "IDs are protected from accidental changes."
                    }}
                  </div>
                  <SituateTextarea
                    appearance="plain"
                    ref="source"
                    class="source-text"
                    :readonly="conflictBlocksFile(state, file.key)"
                    :value="file.draft"
                    aria-label="Markdown source"
                    spellcheck="false"
                    autocapitalize="off"
                    autocomplete="off"
                    wrap="soft"
                    @input="inputSource"
                    @focus="
                      state.activePane !== 'files' &&
                      update((next) => {
                        next.activePane = 'files';
                      })
                    "
                    @blur="update((next) => saveFile(next))"
                  />
                </div>
                <MarkdownContent
                  v-else
                  :key="file.key + ':' + (state.historical?.key || 'current')"
                  :content="state.historical?.content ?? file.draft"
                  :readonly="
                    !!state.historical ||
                    !!dialog ||
                    conflictBlocksFile(state, file.key)
                  "
                  @edit="changeMode('source', $event)"
                />
              </template>
              <div v-else class="empty-document">
                <h3>A place for your next thought.</h3>
                <p>Choose a file or create a new one.</p>
                <SituateButton
                  @click="
                    dialog = {
                      kind: 'name',
                      action: 'create',
                      target: rootTarget,
                      name: 'untitled.md',
                      folder: '',
                      error: '',
                    }
                  "
                  >New file</SituateButton
                >
              </div>
            </div>
            <footer class="document-footer">
              <span>{{
                state.historical
                  ? "Read-only · Earlier version"
                  : state.mode === "source"
                    ? "Markdown · Source"
                    : "Markdown"
              }}</span
              ><span v-if="file"
                >{{
                  file.draft
                    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean).length
                }}
                words</span
              ><span
                class="save-state"
                role="status"
                :data-state="
                  file?.saveError
                    ? 'error'
                    : file && file.draft !== file.content
                      ? 'saving'
                      : 'saved'
                "
                >{{ saveStatus }}</span
              >
            </footer>
          </section>
          <aside
            v-if="state.historyOpen && file"
            class="version-panel"
            aria-label="File history"
          >
            <header>
              <h3>Version history</h3>
              <SituateIconButton
                class="close-history"
                icon="close"
                label="Close history"
                @click="history(false)"
              />
            </header>
            <p>Select a version to see what changed.</p>
            <div class="versions">
              <SituateButton
                variant="plain"
                v-for="(version, index) in versions"
                :key="version.key"
                class="version"
                :aria-pressed="
                  state.historical?.key === version.key ||
                  (!state.historical && index === 0)
                "
                @click="chooseVersion(index)"
              >
                <strong>{{
                  index === 0 ? "Current document" : version.label
                }}</strong
                ><span>{{ version.label }} · {{ version.author }}</span
                ><small>{{ version.note }}</small>
              </SituateButton>
            </div>
            <label class="history-controls"
              ><SituateCheckbox
                appearance="plain"
                type="checkbox"
                :checked="state.compare"
                @change="
                  update((next) => {
                    next.compare = ($event.target as HTMLInputElement).checked;
                  })
                "
              />Compare with current</label
            >
            <p>Includes file metadata</p>
            <p class="history-footer">
              Viewing history leaves your current file unchanged.
            </p>
          </aside>
        </div>
      </section>
      <div
        v-show="state.chats.length && (!single || state.activePane !== 'files')"
        class="chat-stack"
      >
        <EditorChatPane
          v-for="chat in state.chats"
          :key="chat.key"
          v-show="chatVisible(chat.key)"
          :id="instanceId + '-' + chat.key"
          :data-chat="chat.key"
          :state="state"
          :chat="chat"
          :visible="chatVisible(chat.key)"
          :navigation-id="navigationId"
          :navigation-open="navigationOpen"
          :show-navigation="showNavigation"
          :role="single || state.chats.length > 1 ? 'tabpanel' : undefined"
          :aria-labelledby="
            single || state.chats.length > 1
              ? instanceId + '-tab-' + chat.key
              : undefined
          "
          @draft="updateChat(chat.key, $event)"
          @remove="removeReference(chat.key, $event)"
          @open="followReference"
          @attach="dialog = { kind: 'attach', key: chat.key }"
          @close="requestClose(chat.key)"
          @open-navigation="emit('openNavigation', $event)"
        />
      </div>
      <div v-if="!state.filesOpen && !state.chats.length" class="empty-tabs">
        <SituateIconButton
          v-if="showNavigation"
          icon="menu"
          label="Open navigation"
          :aria-controls="navigationId"
          :aria-expanded="navigationOpen"
          @click="emit('openNavigation', $event)"
        />
        <h3>Your workspace is open.</h3>
        <p>Open a view from navigation or start a new chat.</p>
        <SituateButton @click="newChat()">New chat</SituateButton
        ><SituateButton
          variant="plain"
          class="text-button"
          @click="
            update((next) => {
              next.filesOpen = true;
              next.activePane = 'files';
            })
          "
        >
          Open Files
        </SituateButton>
      </div>
    </div>
    <div v-if="single || state.chats.length > 1" class="pane-switcher">
      <div
        class="tab-strip"
        role="tablist"
        :aria-label="single ? 'Open tabs' : 'Open chats'"
      >
        <template v-for="tab in tabs" :key="tab.key"
          ><div v-if="single || tab.key !== 'files'" class="tab-item">
            <SituateButton
              variant="plain"
              :id="instanceId + '-tab-' + tab.key"
              :data-tab="tab.key"
              role="tab"
              :aria-controls="instanceId + '-' + tab.key"
              :aria-selected="
                (single ? state.activePane : state.activeChat) === tab.key
              "
              :tabindex="
                (single ? state.activePane : state.activeChat) === tab.key
                  ? 0
                  : -1
              "
              @click="switchTab(tab.key)"
              @keydown="tabKeyboard($event, tab.key)"
            >
              {{ tab.title }}</SituateButton
            ><SituateIconButton
              v-if="(single ? state.activePane : state.activeChat) === tab.key"
              icon="close"
              :label="'Close tab — ' + tab.title"
              @click="requestClose(tab.key)"
            /></div
        ></template>
      </div>
      <SituateIconButton icon="plus" label="New chat" @click="newChat()" />
    </div>
    <ConflictReview
      v-if="state.conflict"
      :key="state.conflict.epoch"
      :state="state"
      @update:state="(value) => update((next) => Object.assign(next, value))"
      @resolved="documentTitle?.focus()"
    />
    <p class="sr-only" role="status">{{ feedback }}</p>

    <SituateMenu
      v-if="dialog?.kind === 'menu'"
      :key="'menu'"
      :label="
        dialog.document
          ? 'File actions'
          : dialog.target.kind === 'file'
            ? 'File actions'
            : dialog.target.path
              ? 'Folder actions'
              : 'Create'
      "
      :open="true"
      :close-on-select="false"
      :point="dialog.point"
      @close="dismissDialog"
    >
      <p class="menu-context">{{ menuTitle }}</p>
      <div class="action-choices">
        <template v-if="dialog.document"
          ><SituateButton
            variant="plain"
            role="menuitemradio"
            tabindex="-1"
            :aria-checked="state.mode === 'read' && !state.historical"
            @click="
              dialog = null;
              changeMode('read');
            "
          >
            Read</SituateButton
          ><SituateButton
            variant="plain"
            role="menuitemradio"
            tabindex="-1"
            :aria-checked="state.mode === 'source' && !state.historical"
            @click="
              dialog = null;
              changeMode('source');
            "
          >
            Edit source</SituateButton
          ><SituateButton
            variant="plain"
            role="menuitem"
            tabindex="-1"
            @click="
              dialog = null;
              history(true);
            "
          >
            Version history
          </SituateButton>
          <hr
        /></template>
        <SituateButton
          variant="plain"
          role="menuitem"
          tabindex="-1"
          @click="nameAction('create')"
          >New file…</SituateButton
        ><SituateButton
          variant="plain"
          role="menuitem"
          tabindex="-1"
          @click="nameAction('folder')"
        >
          New folder…
        </SituateButton>
        <template
          v-if="
            !dialog.creationOnly &&
            (dialog.target.kind === 'file' || dialog.target.path)
          "
          ><hr />
          <SituateButton
            variant="plain"
            role="menuitem"
            tabindex="-1"
            @click="nameAction('rename')"
            >Rename…</SituateButton
          ><SituateButton
            variant="plain"
            role="menuitem"
            tabindex="-1"
            @click="nameAction('move')"
            >Move to…</SituateButton
          ><SituateButton
            variant="plain"
            role="menuitem"
            tabindex="-1"
            @click="nameAction('duplicate')"
          >
            Duplicate…
          </SituateButton>
          <hr />
          <SituateButton
            variant="plain"
            role="menuitem"
            tabindex="-1"
            @click="askDelete"
            >Delete…</SituateButton
          ></template
        >
      </div>
    </SituateMenu>
    <EditorDialog
      v-else-if="dialog?.kind === 'name'"
      :key="'name'"
      :title="nameTitle"
      @close="dismissDialog"
      ><form class="name-form" @submit.prevent="submitName">
        <p>
          {{
            dialog.action === "duplicate"
              ? "Copies receive new file and task identities."
              : dialog.action === "move" || dialog.action === "rename"
                ? "Existing file identities and version histories stay with the content."
                : "Choose a name and a destination folder."
          }}
        </p>
        <label
          >Name<SituateInput
            appearance="plain"
            :value="dialog.name"
            @input="
              update((next) => {
                if (next.dialog?.kind === 'name')
                  next.dialog.name = ($event.target as HTMLInputElement).value;
              })
            "
            :readonly="dialog.action === 'move'"
            :aria-invalid="!!dialog.error"
            :aria-describedby="instanceId + '-name-error'"
            required
            maxlength="120"
            autocomplete="off"
        /></label>
        <label
          >Folder<SituateSelect
            :value="dialog.folder"
            @change="
              update((next) => {
                if (next.dialog?.kind === 'name')
                  next.dialog.folder = (
                    $event.target as HTMLSelectElement
                  ).value;
              })
            "
            :disabled="dialog.action === 'rename'"
          >
            <option
              v-for="folder in destinationFolders(
                state,
                dialog.target,
                dialog.action,
              )"
              :key="folder"
              :value="folder"
            >
              {{ folder || "Personal" }}
            </option>
          </SituateSelect></label
        >
        <p :id="instanceId + '-name-error'" role="alert">{{ dialog.error }}</p>
        <div class="dialog-actions">
          <SituateButton
            variant="secondary"
            size="small"
            type="button"
            @click="dismissDialog"
          >
            Cancel</SituateButton
          ><SituateButton type="submit">{{
            dialog.action === "create"
              ? "Create file"
              : dialog.action === "folder"
                ? "Create folder"
                : dialog.action === "duplicate"
                  ? "Create copy"
                  : dialog.action === "move"
                    ? "Move"
                    : "Rename"
          }}</SituateButton>
        </div>
      </form></EditorDialog
    >
    <EditorDialog
      v-else-if="dialog?.kind === 'id'"
      :key="'id'"
      title="Change a system ID?"
      @close="finishId(false)"
      ><p>
        Existing links to this file or its tasks may stop working. Keep the ID
        unless you intend to change what those links point to.
      </p>
      <p>This also applies when replacing a larger block of text.</p>
      <div class="dialog-actions">
        <SituateButton
          variant="secondary"
          size="small"
          autofocus
          @click="finishId(false)"
        >
          Keep ID</SituateButton
        ><SituateButton @click="finishId(true)"
          >Apply this change</SituateButton
        >
      </div></EditorDialog
    >
    <EditorDialog
      v-else-if="dialog?.kind === 'delete'"
      :key="'delete'"
      :title="
        dialog.target.kind === 'folder'
          ? 'Delete this folder?'
          : 'Delete this file?'
      "
      @close="dismissDialog"
      ><p>
        “{{ targetLabel(state, dialog.target) }}”{{
          dialog.target.kind === "folder" ? " and its contents" : ""
        }}
        will leave the current collection. Previous file versions remain in
        history.
      </p>
      <p v-if="deletingDirty">
        Changes that could not be saved will be discarded.
      </p>
      <div class="dialog-actions">
        <SituateButton
          variant="secondary"
          size="small"
          autofocus
          @click="dismissDialog"
        >
          Keep {{ dialog.target.kind }}</SituateButton
        ><SituateButton variant="danger" @click="confirmDelete"
          >Delete {{ dialog.target.kind }}</SituateButton
        >
      </div></EditorDialog
    >
    <EditorDialog
      v-else-if="dialog?.kind === 'close'"
      :key="'close'"
      title="Close this chat?"
      @close="dismissDialog"
      ><p>
        Closing “{{
          state.chats.find(
            (chat) => chat.key === (dialog?.kind === "close" ? dialog.key : ""),
          )?.title
        }}” will discard its unsent message.
      </p>
      <div class="dialog-actions">
        <SituateButton
          variant="secondary"
          size="small"
          autofocus
          @click="dismissDialog"
        >
          Keep chat</SituateButton
        ><SituateButton variant="danger" @click="discardChat"
          >Discard message</SituateButton
        >
      </div></EditorDialog
    >
    <EditorDialog
      v-else-if="dialog?.kind === 'attach'"
      :key="'attach'"
      title="Attach a file"
      @close="dismissDialog"
      ><div class="attachment-options">
        <SituateButton
          variant="plain"
          v-for="item in liveFiles(state)"
          :key="item.key"
          @click="attach(item.key)"
        >
          {{ item.name }} · {{ item.folder || "Personal" }}
        </SituateButton>
        <p v-if="!liveFiles(state).length">No files in this workspace.</p>
      </div></EditorDialog
    >
  </section>
</template>

<style scoped>
.editor-workspace {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--situate-ink);
  background: var(--situate-paper);
  font-family: var(--situate-font-body);
  font-size: 14px;
  container-type: inline-size;
}
.editor-workspace :deep(*) {
  box-sizing: border-box;
}
.workspace-content {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 9px;
  overflow: hidden;
}
.files-pane {
  display: flex;
  flex: 1.15;
  min-width: 0;
  min-height: 0;
  background: var(--situate-surface);
}
.file-layout {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.file-browser {
  width: 228px;
  flex: 0 0 228px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--situate-line);
  background: color-mix(
    in srgb,
    var(--situate-paper) 45%,
    var(--situate-surface)
  );
  min-height: 0;
}
.browser-header {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  min-height: 56px;
}
.browser-header > span {
  flex: 1;
  color: var(--situate-muted);
  font-size: 12px;
  font-weight: 600;
}
.file-filter {
  min-width: 0;
  min-height: 44px;
  margin: 0 16px 16px;
  padding: 10px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-small);
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 13px;
}
.browser-footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid var(--situate-line);
  padding: 8px 16px;
  font-size: 11px;
  color: var(--situate-muted);
}
.document-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  container: document / inline-size;
}
.document-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 56px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--situate-line);
}
.document-heading {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.document-location {
  min-width: 0;
  flex: 1;
  margin-inline-start: 4px;
}
.document-location p,
.document-location h3 {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  margin: 0;
}
.document-location p {
  font-size: 11px;
  color: var(--situate-muted);
  line-height: 1.4;
}
.document-location h3 {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}
.document-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.text-button,
.more-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--situate-radius-small);
  background: transparent;
  color: var(--situate-muted);
  font: inherit;
  font-size: 13px;
}
.more-button {
  width: 44px;
  font-size: 20px;
  font-weight: 600;
}
.history-toggle[aria-expanded="true"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.document-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.document-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  min-height: 32px;
  align-items: center;
  padding: 6px 20px;
  border-top: 1px solid var(--situate-line);
  color: var(--situate-muted);
  font-size: 11px;
}
.save-state {
  margin-inline-start: auto;
}
.save-state[data-state="error"] {
  background: var(--situate-note);
  color: var(--situate-ink);
  padding: 4px 8px;
  border-radius: 4px;
}
.source-wrap {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.source-hint {
  padding: 12px 24px;
  background: var(--situate-paper);
  color: var(--situate-muted);
  font-size: 11px;
}
.source-text {
  display: block;
  width: 100%;
  flex: 1;
  min-height: 440px;
  border: 0;
  resize: vertical;
  background: var(--situate-surface);
  color: var(--situate-ink);
  padding: 24px;
  font: 13px/1.9 var(--situate-font-mono);
  tab-size: 2;
  border-radius: 0;
}
.source-text:focus-visible {
  outline-offset: -4px;
}
.historical-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 24px;
  background: var(--situate-note);
  border-bottom: 1px solid var(--situate-line);
  font-size: 12px;
}
.historical-notice strong,
.historical-notice span {
  display: block;
}
.historical-notice span {
  font-size: 11px;
  color: var(--situate-muted);
}
.version-panel {
  flex: 0 0 256px;
  width: 256px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--situate-line);
  background: color-mix(
    in srgb,
    var(--situate-paper) 45%,
    var(--situate-surface)
  );
  overflow: auto;
}
.version-panel > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
}
.version-panel h3 {
  font-size: 16px;
}
.version-panel p {
  padding-inline: 24px;
  color: var(--situate-muted);
  font-size: 12px;
}
.versions {
  padding: 0 12px;
}
.version {
  display: block;
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  text-align: left;
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 8px;
  min-height: 76px;
  color: inherit;
}
.version[aria-pressed="true"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
  border-color: var(--situate-line);
}
.version strong {
  display: block;
  font-size: 13px;
}
.version span,
.version small {
  display: block;
  font-size: 11px;
  color: var(--situate-muted);
  margin-top: 4px;
}
.history-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  margin: 16px 24px 0;
  font-size: 12px;
}
.history-controls input {
  accent-color: var(--situate-accent-strong, var(--situate-violet-deep));
  width: 18px;
  height: 18px;
}
.history-footer {
  margin-top: auto;
  padding-block: 24px;
}
.diff-view {
  padding: 24px;
  font: 12px/1.85 var(--situate-font-mono);
}
.diff-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font: 12px/1.5 var(--situate-font-body);
  margin-bottom: 20px;
  color: var(--situate-muted);
}
.diff-line {
  display: flex;
  padding: 4px 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-left: 2px solid transparent;
}
.marker {
  width: 24px;
  flex-shrink: 0;
  user-select: none;
}
.diff-line.added {
  background: var(--situate-lilac);
  border-color: var(--situate-violet-deep);
}
.diff-line.removed {
  background: var(--situate-note);
  border-color: var(--situate-book-line);
}
.empty-document,
.empty-tabs {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 240px;
  padding: 24px;
  text-align: center;
  overflow: auto;
}
.empty-tabs {
  flex: 1;
}
.chat-stack {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.pane-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px
    max(8px, var(--app-safe-area-bottom, env(safe-area-inset-bottom)));
  border-top: 1px solid var(--situate-line);
  background: var(--situate-paper);
  min-width: 0;
}
.tab-strip {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  gap: 8px;
}
.tab-item {
  display: flex;
  flex-shrink: 0;
  border-radius: var(--situate-radius-control);
}
.tab-item:has([aria-selected="true"]) {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.tab-item > button[role="tab"] {
  border: 0;
  background: transparent;
  color: inherit;
  min-height: 44px;
  padding: 8px 16px;
  border-radius: inherit;
  font: inherit;
}
.single .workspace-content {
  gap: 0;
}
.compact-files .file-browser,
.compact-files .version-panel {
  flex: 1;
  width: 100%;
  border: 0;
}
.menu-context {
  margin: 0 8px 8px;
  font-size: 11px;
  overflow-wrap: anywhere;
  color: var(--situate-muted);
}
.action-choices,
.attachment-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.attachment-options button {
  text-align: left;
  padding: 12px;
  border: 0;
  border-radius: 8px;
  min-height: 44px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: inherit;
  overflow-wrap: anywhere;
}
.action-choices hr {
  width: calc(100% - 16px);
  border: 0;
  border-top: 1px solid var(--situate-line);
  margin: 5px 8px;
}
.action-choices [aria-checked="true"] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 600;
}
.name-form label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin: 16px 0 8px;
}
.name-form input,
.name-form select {
  display: block;
  width: 100%;
  min-height: 44px;
  margin-top: 8px;
  border: 1px solid var(--situate-control-line);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--situate-surface);
  color: inherit;
  font: inherit;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 24px;
}
button:not(:disabled) {
  cursor: pointer;
}
button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
button:hover:not(:disabled):not(.situate-button) {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
@container document (max-width: 620px) {
  .document-bar {
    gap: 4px;
    padding: 6px 8px;
    flex-wrap: wrap;
  }
  .document-heading {
    flex-basis: 120px;
  }
  .document-actions {
    margin-inline-start: auto;
  }
}
@container (max-width: 400px) {
  .source-text {
    padding: 18px;
    font-size: 12px;
  }
  .document-footer {
    padding-inline: 12px;
  }
  .pane-switcher {
    padding-inline: 8px;
  }
}
</style>
