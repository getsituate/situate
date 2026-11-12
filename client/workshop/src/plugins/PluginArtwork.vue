<script setup lang="ts">
defineProps<{ kind: string }>();
</script>

<template>
  <svg
    class="plugin-artwork"
    viewBox="0 0 100 100"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="kind === 'calendar'">
      <rect
        x="9"
        y="18"
        width="74"
        height="72"
        rx="16"
        fill="var(--situate-sky)"
      />
      <rect
        x="20"
        y="10"
        width="70"
        height="72"
        rx="14"
        fill="var(--situate-cobalt)"
      />
      <path
        d="M20 33H90V68C90 76 84 82 76 82H34C26 82 20 76 20 68Z"
        fill="var(--situate-surface)"
      />
      <path
        d="M38 6V20M72 6V20"
        stroke="var(--situate-ink)"
        stroke-width="5"
        stroke-linecap="round"
      />
      <path
        d="M36 48H44M60 48H68M36 63H44"
        stroke="var(--situate-line)"
        stroke-width="5"
        stroke-linecap="round"
      />
      <circle cx="65" cy="64" r="8" fill="var(--situate-cobalt)" />
    </template>
    <template v-else-if="kind === 'weekly'">
      <rect
        x="8"
        y="20"
        width="67"
        height="72"
        rx="12"
        fill="var(--situate-tangerine)"
      />
      <path
        d="M30 8H68L88 29V73C88 80 83 85 76 85H30C23 85 18 80 18 73V20C18 13 23 8 30 8Z"
        fill="var(--situate-lemon)"
      />
      <path d="M68 8V23C68 27 70 29 74 29H88Z" fill="var(--situate-peach)" />
      <path
        d="M34 43L38 47L45 38M34 61L38 65L45 56"
        stroke="var(--situate-ink)"
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M55 43H72M55 61H66"
        stroke="var(--situate-ink)"
        stroke-width="3.5"
        stroke-linecap="round"
      />
    </template>
    <template v-else-if="kind === 'inbox' || kind === 'follow-up'">
      <rect
        x="8"
        y="26"
        width="76"
        height="62"
        rx="12"
        fill="var(--situate-sky)"
      />
      <rect
        x="18"
        y="17"
        width="74"
        height="62"
        rx="12"
        fill="var(--situate-lilac)"
      />
      <path
        d="M20 25L55 51L89 25M20 73L42 52M90 73L68 52"
        stroke="var(--situate-violet-deep)"
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        v-if="kind === 'follow-up'"
        d="M63 8H83V39L73 32L63 39Z"
        fill="var(--situate-tangerine)"
      />
    </template>
    <template v-else-if="kind === 'morning'">
      <path
        d="M11 68C11 43 28 20 51 20C74 20 90 43 90 68Z"
        fill="var(--situate-peach)"
      />
      <path
        d="M28 67C28 49 36 37 51 37C66 37 73 49 73 67"
        stroke="var(--situate-tangerine)"
        stroke-width="16"
      />
      <path
        d="M51 6V12M17 19L22 24M79 24L84 19"
        stroke="var(--situate-ink)"
        stroke-width="3.5"
        stroke-linecap="round"
      />
      <rect
        x="7"
        y="68"
        width="87"
        height="7"
        rx="3.5"
        fill="var(--situate-ink)"
      />
      <path
        d="M23 86H77"
        stroke="var(--situate-peach)"
        stroke-width="7"
        stroke-linecap="round"
      />
    </template>
    <template v-else>
      <path
        d="M12 18C26 14 38 18 50 25C62 18 74 14 88 18V81C74 77 62 81 50 88C38 81 26 77 12 81Z"
        fill="var(--situate-lilac)"
      />
      <path
        d="M50 25V88M24 34L37 39M63 39L76 34M24 48L37 53M63 53L76 48"
        stroke="var(--situate-violet-deep)"
        stroke-width="3.5"
        stroke-linecap="round"
      />
    </template>
  </svg>
</template>

<style scoped>
.plugin-artwork {
  width: 80px;
  height: 80px;
  flex-shrink: 0;
}
</style>
