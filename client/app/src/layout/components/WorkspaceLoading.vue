<script setup lang="ts">
import { SituateLoading } from "@situate/ui";
import { t } from "@situate/localization";

withDefaults(defineProps<{ pending?: boolean }>(), { pending: true });
</script>

<template>
  <SituateLoading
    class="workspace-loading"
    :pending="pending"
    :label="t('layoutHost.openingWorkspace')"
  >
    <template #backdrop>
      <svg class="workspace-paper" viewBox="0 0 156 104" focusable="false">
        <rect
          class="back-sheet"
          x="24"
          y="13"
          width="108"
          height="70"
          rx="12"
          transform="rotate(-10 78 48)"
        />
        <rect
          class="front-sheet"
          x="23"
          y="23"
          width="110"
          height="64"
          rx="12"
        />
        <path d="M23 39h110" />
        <rect class="active-tab" x="31" y="29" width="20" height="4" rx="2" />
        <rect class="other-tab" x="56" y="29" width="13" height="4" rx="2" />
      </svg>
    </template>
  </SituateLoading>
</template>

<style scoped>
.workspace-loading[data-pending] {
  padding: 24px 16px;
  gap: 8px;
  background: var(--situate-paper);
  color: var(--situate-ink);
  font-size: var(--situate-text-lead);
}
.workspace-paper {
  inline-size: min(156px, 50vw);
  display: block;
}
.workspace-paper path,
.back-sheet,
.front-sheet {
  stroke: var(--situate-line);
}
.back-sheet {
  fill: var(--situate-accent-soft, var(--situate-lilac));
}
.front-sheet {
  fill: var(--situate-surface);
}
.active-tab {
  fill: var(--situate-accent-strong, var(--situate-violet-deep));
}
.other-tab {
  fill: var(--situate-line);
}
</style>
