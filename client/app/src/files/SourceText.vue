<script setup lang="ts">
import type { SourceToken } from "./source-highlighting";
defineProps<{ tokens: readonly SourceToken[] }>();
</script>
<template>
  <span class="source-highlight"
    ><span
      v-for="(token, index) in tokens"
      :key="index"
      :class="token.kind ? 'syntax-' + token.kind : undefined"
      data-localization-content="user"
      >{{ token.text }}</span
    ></span
  >
</template>
<style scoped>
.syntax-keyword {
  color: var(--situate-violet-deep);
}
.syntax-string {
  color: var(--situate-cobalt);
}
.syntax-number {
  color: var(--situate-cobalt);
}
.syntax-comment {
  color: var(--situate-muted);
  font-style: italic;
}
</style>
