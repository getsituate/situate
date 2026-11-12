<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { SituateButton, SituateInput } from "@situate/ui";
import { t, preferences, type MessageKey } from "@situate/localization";
import { installedReleases, installedVersion } from "./release-history";
const typeKeys = {
  new: "releaseHistory.type.new",
  changed: "releaseHistory.type.changed",
  fixed: "releaseHistory.type.fixed",
  important: "releaseHistory.type.important",
} as const;
const platformKeys = {
  macos: "releaseHistory.platform.macos",
  ios: "releaseHistory.platform.ios",
} as const;
function typeLabel(type: keyof typeof typeKeys): string {
  const key: MessageKey = typeKeys[type];
  return t(key);
}
function platformLabel(platform: keyof typeof platformKeys): string {
  const key: MessageKey = platformKeys[platform];
  return t(key);
}
const catalog = computed(() =>
  installedReleases().releases.map((release) => ({
    ...release,
    notes: release.locales[preferences.value.language] ?? release.locales.en,
  })),
);
const query = ref("");
const search = ref<InstanceType<typeof SituateInput>>();
function clearSearch() {
  query.value = "";
  void nextTick(() => search.value?.focus());
}
const selected = ref<number | null>(null);
const list = ref<HTMLElement>();
const detail = ref<HTMLElement>();
let listScroll = 0;
let openedFrom = "";
const release = computed(() =>
  selected.value === null ? null : catalog.value[selected.value],
);
const releases = computed(() =>
  catalog.value.filter((r) => {
    const text = [
      r.version,
      r.notes.title,
      ...r.notes.entries.flatMap((entry) => [entry.title, ...entry.paragraphs]),
    ].join(" ");
    return text
      .toLocaleLowerCase()
      .includes(query.value.trim().toLocaleLowerCase());
  }),
);
function date(value: string) {
  return new Intl.DateTimeFormat(preferences.value.language, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));
}
async function open(version: string) {
  openedFrom = version;
  listScroll = list.value?.scrollTop ?? listScroll;
  selected.value = catalog.value.findIndex((r) => r.version === version);
  await focusDetail();
}
async function focusDetail() {
  await nextTick();
  if (detail.value) detail.value.scrollTop = 0;
  detail.value?.querySelector<HTMLElement>("h3")?.focus();
}
async function adjacent(offset: number) {
  selected.value = selected.value! + offset;
  await focusDetail();
}
async function back() {
  const version = openedFrom;
  selected.value = null;
  await nextTick();
  if (list.value) list.value.scrollTop = listScroll;
  list.value
    ?.querySelector<HTMLElement>(`[data-version="${version}"]`)
    ?.focus({ preventScroll: true });
}
</script>

<template>
  <div class="release-history">
    <template v-if="!release">
      <label class="history-search">
        <span>{{ t("releaseHistory.searchHistory") }}</span>
        <SituateInput
          ref="search"
          v-model="query"
          type="search"
          :placeholder="t('releaseHistory.searchPlaceholder')"
        />
      </label>
      <div
        ref="list"
        class="history-list"
        role="region"
        :aria-label="t('releaseHistory.history')"
        tabindex="0"
      >
        <ul v-if="releases.length">
          <li v-for="item in releases" :key="item.version">
            <SituateButton
              variant="ghost"
              :data-version="item.version"
              @click="open(item.version)"
            >
              <span class="release-row">
                <span class="release-meta">
                  <strong>{{ item.version }}</strong>
                  <span
                    v-if="item.version === installedVersion"
                    class="installed"
                    >{{ t("releaseHistory.installed") }}</span
                  >
                  <time v-if="item.date" :datetime="item.date">{{
                    date(item.date)
                  }}</time>
                </span>
                <span>{{ item.notes.title }}</span>
              </span>
              <span aria-hidden="true">›</span>
            </SituateButton>
          </li>
        </ul>
        <div v-else class="history-empty">
          <p role="status">
            {{
              t(
                catalog.length
                  ? "releaseHistory.noReleases"
                  : "releaseHistory.empty",
              )
            }}
          </p>
          <SituateButton
            v-if="query"
            variant="secondary"
            @click="clearSearch"
            >{{ t("releaseHistory.clearSearch") }}</SituateButton
          >
        </div>
      </div>
    </template>
    <template v-else>
      <nav class="history-navigation" :aria-label="t('releaseHistory.history')">
        <SituateButton variant="ghost" size="small" @click="back"
          ><span aria-hidden="true">‹</span>
          {{ t("releaseHistory.backToHistory") }}</SituateButton
        >
        <div>
          <SituateButton
            variant="ghost"
            size="small"
            :disabled="selected === 0"
            @click="adjacent(-1)"
            >{{ t("releaseHistory.newerRelease") }}</SituateButton
          >
          <SituateButton
            variant="ghost"
            size="small"
            :disabled="selected === catalog.length - 1"
            @click="adjacent(1)"
            >{{ t("releaseHistory.olderRelease") }}</SituateButton
          >
        </div>
      </nav>
      <section
        ref="detail"
        class="history-detail"
        role="region"
        :aria-label="t('updates.version', { version: release.version })"
        tabindex="0"
        data-dialog-document
      >
        <header class="version-heading">
          <h3 tabindex="-1">
            {{ t("updates.version", { version: release.version }) }}
          </h3>
          <time v-if="release.date" :datetime="release.date">{{
            date(release.date)
          }}</time>
          <span v-if="release.version === installedVersion" class="installed">{{
            t("releaseHistory.installed")
          }}</span>
        </header>
        <article class="release-notes">
          <h4>{{ release.notes.title }}</h4>
          <section v-for="entry in release.notes.entries" :key="entry.id">
            <p class="entry-meta">
              {{ typeLabel(entry.type) }} ·
              {{ entry.platforms.map(platformLabel).join(" · ") }}
            </p>
            <h5>{{ entry.title }}</h5>
            <p v-for="(paragraph, index) in entry.paragraphs" :key="index">
              {{ paragraph }}
            </p>
          </section>
        </article>
      </section>
    </template>
  </div>
</template>

<style scoped>
.release-notes {
  max-width: 680px;
  margin: 0 auto;
  overflow-wrap: anywhere;
}
.release-notes h4 {
  font-size: 23px;
  line-height: 1.35;
  margin: 0 0 28px;
}
.release-notes h5 {
  font-size: 18px;
  margin: 0 0 12px;
}
.release-notes section + section {
  margin-top: 32px;
}
.release-notes p {
  font-size: 15px;
  line-height: 1.75;
}
.release-notes .entry-meta {
  font-size: 12px;
  color: var(--situate-muted);
  margin-bottom: 8px;
}
.release-history {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.history-search {
  display: grid;
  gap: 8px;
  margin: 0 2px 16px;
  font-size: 14px;
}
.history-list,
.history-detail {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 3px;
}
.history-list ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.history-list li + li {
  border-top: 1px solid var(--situate-line);
}
.history-list :deep(button) {
  width: 100%;
  display: flex;
  justify-content: space-between;
  text-align: left;
  padding: 20px 12px;
  border-radius: 12px;
  gap: 12px;
  white-space: normal;
}
.history-list :deep(button:hover) {
  background: var(--situate-accent-soft);
  color: var(--situate-ink);
}
.history-navigation :deep(button:disabled) {
  background: transparent;
  color: var(--situate-muted);
}
.release-row {
  display: grid;
  gap: 8px;
}
.release-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  font-variant-numeric: tabular-nums;
}
.release-meta time,
.version-heading time {
  font-size: 13px;
  color: var(--situate-muted);
  font-weight: 400;
}
.installed {
  font-size: 12px;
  color: var(--situate-accent-strong);
  background: var(--situate-accent-soft);
  border-radius: 6px;
  padding: 2px 8px;
}
.history-navigation {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--situate-line);
  margin-bottom: 20px;
}
.history-navigation > div {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.version-heading {
  max-width: 680px;
  margin: 0 auto 24px;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 14px;
}
.version-heading h3 {
  width: 100%;
  font-size: 20px;
  line-height: 1.3;
  margin: 0;
}
.history-empty {
  padding: 20px 12px;
}
.history-list:focus-visible,
.history-detail:focus-visible,
h3:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: -3px;
}
@media (max-width: 600px) {
  .history-navigation {
    gap: 0;
    margin-bottom: 12px;
  }
  .history-navigation > div {
    width: 100%;
    justify-content: space-between;
  }
  .history-list :deep(button) {
    padding: 16px 8px;
  }
}
</style>
