<script setup lang="ts">
import { t } from "@situate/localization";
import type { VerifiedChange } from "./transcript";
defineProps<{ changes: VerifiedChange[]; isError?: boolean }>();
</script>

<template>
  <template v-for="change in changes" :key="change.path">
    <header class="change-header">
      <span class="change-path" data-localization-content="user">{{
        change.path
      }}</span
      ><span class="change-saved">{{
        t(isError ? "chat.written" : "chat.saved")
      }}</span>
    </header>
    <div class="change-content">
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
