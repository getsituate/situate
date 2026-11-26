<script setup lang="ts">
import { computed } from "vue";
import { preferences, t } from "@situate/localization";
import type { ReleaseText } from "./release-history";

defineProps<{
  releases: {
    version: string;
    date?: string;
    entries: ReleaseText["entries"];
  }[];
}>();

const date = computed(
  () =>
    new Intl.DateTimeFormat(preferences.value.language, {
      dateStyle: "long",
      timeZone: "UTC",
    }),
);
</script>

<template>
  <div class="release-history">
    <div
      v-if="releases.length"
      class="history-feed"
      role="region"
      :aria-label="t('releaseHistory.history')"
      tabindex="0"
    >
      <div
        v-for="release in releases"
        :key="release.version"
        class="release"
        :data-version="release.version"
      >
        <div class="release-meta">
          <time v-if="release.date" :datetime="release.date">{{
            date.format(new Date(release.date))
          }}</time>
          <span>{{ t("updates.version", { version: release.version }) }}</span>
        </div>
        <div class="release-entries">
          <section v-for="entry in release.entries" :key="entry.id">
            <h3>{{ entry.title }}</h3>
            <p
              v-if="
                entry.type === 'important' || !entry.platforms.includes('macos')
              "
              class="entry-meta"
            >
              <strong v-if="entry.type === 'important'">{{
                t("releaseHistory.type.important")
              }}</strong>
              <span v-if="!entry.platforms.includes('macos')">{{
                t("releaseHistory.platform.ios")
              }}</span>
            </p>
            <p
              v-for="(paragraph, index) in entry.paragraphs"
              :key="index"
              class="entry-description"
            >
              {{ paragraph }}
            </p>
          </section>
        </div>
      </div>
    </div>
    <p v-else class="history-empty" role="status">
      {{ t("releaseHistory.empty") }}
    </p>
  </div>
</template>

<style scoped>
.release-history {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.history-feed {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.history-feed:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: -3px;
}
.release {
  display: grid;
  grid-template-columns: 9rem minmax(0, 1fr);
  gap: 1.5rem;
  padding: 1.5rem 0;
  border-top: 1px solid var(--situate-line);
  overflow-wrap: anywhere;
}
.release:first-child {
  border-top: 0;
  padding-top: 0.5rem;
}
.release-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  color: var(--situate-muted);
  font-size: 0.8125rem;
  line-height: 1.55;
  padding-top: 0.15rem;
  font-variant-numeric: tabular-nums;
}
.release-meta time {
  color: var(--situate-ink);
  font-weight: 600;
}
.release-entries {
  display: grid;
  gap: 1rem;
}
.release-entries h3 {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  line-height: var(--situate-leading-compact);
  font-weight: 600;
}
.release-entries p {
  margin: 0;
  line-height: 1.6;
}
.release-entries .entry-meta {
  display: flex;
  gap: 0.75rem;
  color: var(--situate-muted);
  font-size: 0.8125rem;
  margin-bottom: 0.25rem;
}
.entry-description + .entry-description {
  margin-top: 0.5rem;
}
.history-empty {
  flex: 1;
  color: var(--situate-muted);
  margin: 0;
  padding: 0.5rem 0 1rem;
}
@media (max-width: 600px) {
  .release {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.625rem;
    padding: 1rem 0;
  }
  .release-meta {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    padding-top: 0;
  }
}
</style>
