<script setup lang="ts">
import { computed } from "vue";
import { t } from "@situate/localization";
import { fileDiff } from "../../plugins/assignment-diff";
import type { VerifiedChange } from "./transcript";

const props = defineProps<{
  changes: VerifiedChange[];
  isError?: boolean;
  lineDiff?: boolean;
}>();

type ChangeBlock = {
  kind: "added" | "removed";
  lines: string[];
  missingFinalNewline: boolean;
};

function editPreview(before: string, after: string) {
  const { rows, simplified } = fileDiff(before, after);
  const blocks: ChangeBlock[] = [];
  if (simplified) return { blocks, simplified };

  const finalNewlineChanged = before.endsWith("\n") !== after.endsWith("\n");
  let block: ChangeBlock | undefined;
  for (const row of rows) {
    if (row.kind === "same") {
      block = undefined;
      continue;
    }
    if (block?.kind !== row.kind) {
      block = { kind: row.kind, lines: [], missingFinalNewline: false };
      blocks.push(block);
    }
    block.lines.push(row.text);
    block.missingFinalNewline = finalNewlineChanged && row.noNewline;
  }
  return { blocks, simplified };
}

const previews = computed(() =>
  props.changes.map((change) => ({
    change,
    diff:
      props.lineDiff && change.before !== null
        ? editPreview(change.before, change.after)
        : undefined,
  })),
);
</script>

<template>
  <template v-for="{ change, diff } in previews" :key="change.path">
    <header
      class="change-header"
      :class="{ 'created-file': !isError && change.before === null }"
    >
      <span class="change-path" data-localization-content="user">{{
        change.path
      }}</span
      ><span class="change-saved">{{
        t(isError ? "chat.written" : "chat.saved")
      }}</span>
    </header>
    <div v-if="diff" class="change-content">
      <p v-if="diff.simplified">{{ t("chat.diffTooLarge") }}</p>
      <p v-else-if="!diff.blocks.length">{{ t("files.noChangesToShow") }}</p>
      <section
        v-for="(block, index) in diff.blocks"
        :key="index"
        :class="block.kind === 'added' ? 'change-added' : 'change-removed'"
        :aria-label="t(block.kind === 'added' ? 'chat.added' : 'chat.removed')"
      >
        <span aria-hidden="true">{{ block.kind === "added" ? "+" : "−" }}</span>
        <pre data-localization-content="user">{{ block.lines.join("\n") }}</pre>
        <small v-if="block.missingFinalNewline" class="newline-note">{{
          t("chat.noFinalNewline")
        }}</small>
      </section>
    </div>
    <div v-else class="change-content">
      <section
        v-if="change.before !== null"
        class="change-removed"
        :aria-label="t('chat.removed')"
      >
        <span aria-hidden="true">−</span>
        <pre data-localization-content="user">{{ change.before }}</pre>
      </section>
      <section
        class="change-added"
        :aria-label="
          change.before === null ? t('chat.written') : t('chat.added')
        "
      >
        <span aria-hidden="true">+</span>
        <pre data-localization-content="user">{{ change.after }}</pre>
      </section>
    </div>
  </template>
</template>

<style scoped>
.change-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: var(--situate-paper);
  font-size: 12px;
  border-bottom: 1px solid var(--situate-line);
}
.change-header.created-file {
  background: var(--situate-content-wash, var(--situate-paper));
}
.change-path {
  font-family: var(--situate-font-mono);
  overflow-wrap: anywhere;
  min-width: 0;
}
.change-saved {
  margin-inline-start: auto;
  color: var(--situate-muted);
  white-space: nowrap;
}
.change-content {
  max-height: 360px;
  overflow: auto;
  padding: 8px;
}
.change-content section {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 4px;
  padding: 8px;
}
.change-content pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.6;
}
.newline-note {
  grid-column: 2;
  color: var(--situate-muted);
}
.change-removed {
  color: var(--situate-muted);
  background: var(--situate-paper);
}
.change-removed pre {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}
.change-added {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
</style>
