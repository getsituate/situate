<script setup lang="ts">
import { SituateSelect, SituateButton, SituateCheckbox } from "../ui";
import {
  currentFile,
  flushSaves,
  openChat,
  referenceForCurrent,
  setHistory,
  setMode,
  type EditorState,
} from "./model";
import { useEditorState } from "./use-editor-state";
import {
  automaticMerge,
  changeConflictSource,
  completeConflictOperation,
} from "./conflicts";
const props = defineProps<{ state: EditorState }>();
const emit = defineEmits<{ "update:state": [state: EditorState] }>();
const { state, update } = useEditorState(props, emit);
function showDialog(kind: string) {
  update((next) => {
    const file = currentFile(next);
    const target = file
      ? { kind: "file" as const, key: file.key }
      : { kind: "folder" as const, path: "" };
    if (kind === "none") next.dialog = null;
    else if (kind === "menu")
      next.dialog = { kind, target, document: !!file, point: { x: 24, y: 80 } };
    else if (kind === "name")
      next.dialog = {
        kind,
        target,
        action: "create",
        name: "untitled.md",
        folder: file?.folder || "",
        error: "",
      };
    else if (kind === "delete" && file) next.dialog = { kind, target };
    else if (kind === "id" && file) {
      next.mode = "source";
      next.historical = null;
      next.filesOpen = true;
      next.activePane = "files";
      next.dialog = {
        kind,
        key: file.key,
        value: file.draft.replace(/^id:.*$/m, "id: " + crypto.randomUUID()),
        start: 0,
        end: 0,
      };
    } else if (kind === "attach" || kind === "close") {
      if (!next.chats.length) openChat(next);
      const chat =
        next.chats.find((chat) => chat.key === next.activeChat) ||
        next.chats[0];
      next.activePane = chat.key;
      next.activeChat = chat.key;
      next.dialog = { kind, key: chat.key };
    }
  });
}
function complete(outcome?: "success" | "failure" | "race") {
  const conflict = state.value.conflict;
  if (!conflict?.pending) return;
  const { epoch, pending } = conflict;
  update((next) => completeConflictOperation(next, epoch, pending, outcome));
}
function outcome(event: Event) {
  update((next) => {
    next.saveOutcome = (event.target as HTMLInputElement).checked
      ? "failure"
      : "success";
    if (next.saveOutcome === "success") flushSaves(next);
  });
}
</script>
<template>
  <section class="editor-controls" aria-label="Editor controls">
    <section
      v-if="state.conflict"
      class="conflict-controls"
      aria-label="Conflict controls"
    >
      <label v-if="state.conflict.status !== 'resolved'"
        >Next application result<SituateSelect
          :value="state.conflict.nextOutcome"
          @change="
            update((next) => {
              next.conflict!.nextOutcome = ($event.target as HTMLSelectElement)
                .value as 'success' | 'failure' | 'race';
            })
          "
        >
          <option value="success">Save selected version</option>
          <option value="failure">Local write fails</option>
          <option value="race">File changes during application</option>
        </SituateSelect></label
      >
      <p v-if="state.conflict.status !== 'resolved'">
        Applications and refreshes wait for manual completion.
      </p>
      <SituateButton v-if="state.conflict.pending" @click="complete()">{{
        state.conflict.status === "refreshing"
          ? "Complete refresh"
          : "Complete application"
      }}</SituateButton>
      <SituateButton
        v-if="state.conflict.status === 'applying'"
        @click="complete('failure')"
        >Fail application</SituateButton
      >
      <SituateButton
        v-if="state.conflict.status !== 'resolved'"
        @click="update(changeConflictSource)"
        >Change file again</SituateButton
      >
      <SituateButton
        :disabled="state.conflict.status !== 'resolved'"
        @click="update(automaticMerge)"
        >Simulate automatic merge</SituateButton
      >
    </section>
    <template v-if="!state.dialog && !state.conflict?.open">
      <label v-if="currentFile(state) && !state.historical"
        ><SituateCheckbox
          type="checkbox"
          :checked="state.saveOutcome === 'failure'"
          @change="outcome"
        />Simulate an automatic-save failure</label
      >
      <p v-if="currentFile(state) && !state.historical">
        Failed saves retain the edited text. Turn this off to retry pending
        saves.
      </p>
      <div class="representations">
        <SituateButton
          variant="secondary"
          size="small"
          :disabled="!currentFile(state)"
          :aria-pressed="state.mode === 'read' && !state.historical"
          @click="
            update((next) => {
              next.filesOpen = true;
              next.activePane = 'files';
              setMode(next, 'read');
            })
          "
        >
          Read
        </SituateButton>
        <SituateButton
          variant="secondary"
          size="small"
          :disabled="!currentFile(state)"
          :aria-pressed="state.mode === 'source' && !state.historical"
          @click="
            update((next) => {
              next.filesOpen = true;
              next.activePane = 'files';
              setMode(next, 'source');
            })
          "
        >
          Edit source
        </SituateButton>
        <SituateButton
          variant="secondary"
          size="small"
          :disabled="!currentFile(state)"
          :aria-pressed="state.historyOpen"
          @click="
            update((next) => {
              next.filesOpen = true;
              next.activePane = 'files';
              setHistory(next, !next.historyOpen);
            })
          "
        >
          Version history
        </SituateButton>
      </div>
    </template>
    <label v-if="!state.conflict?.open"
      >Dialog<SituateSelect
        :value="state.dialog?.kind || 'none'"
        @change="showDialog(($event.target as HTMLSelectElement).value)"
      >
        <option value="none">None</option>
        <option value="menu">File actions</option>
        <option value="name">New file</option>
        <option value="id" :disabled="!currentFile(state)">
          ID confirmation
        </option>
        <option value="delete" :disabled="!currentFile(state)">
          Delete confirmation
        </option>
        <option value="attach">Attach a file</option>
        <option value="close">Close chat confirmation</option>
      </SituateSelect></label
    >
    <SituateButton
      v-if="!state.dialog && !state.conflict?.open"
      :disabled="!currentFile(state)"
      @click="update((next) => openChat(next, referenceForCurrent(next)))"
      >New chat with this file</SituateButton
    >
  </section>
</template>
<style scoped>
.conflict-controls {
  display: grid;
  gap: 12px;
}
.editor-controls {
  display: grid;
  gap: 16px;
  color: var(--situate-ink);
  font: 14px/1.5 var(--situate-font-body);
}
label {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
}
input {
  width: 18px;
  height: 18px;
  accent-color: var(--situate-violet-deep);
}
p {
  color: var(--situate-muted);
  margin: 0;
}
span:where(.situate-select) {
  min-width: 0;
}
.representations {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.representations button[aria-pressed="true"] {
  background: var(--situate-lilac);
}
</style>
