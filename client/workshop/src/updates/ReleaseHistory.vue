<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { SituateButton, SituateInput } from "../ui";
import copy from "../localization/en.updates.json" with { type: "json" };
import ReleaseNotes from "./ReleaseNotes.vue";
import { releaseCatalog, installedReleaseCatalog } from "./release-history";
import type { UpdateState } from "./model";
const props = defineProps<{ state: UpdateState }>();
const catalog = computed(() => installedReleaseCatalog(props.state.installed));
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
function article(content: (typeof releaseCatalog)[number]["content"]) {
  return content === "latest"
    ? copy.featureNotes
    : copy.releaseArchive[content];
}
function title(content: (typeof releaseCatalog)[number]["content"]) {
  return article(content).title;
}
const releases = computed(() =>
  catalog.value.filter((r) => {
    const notes = article(r.content);
    const text = [
      r.version,
      notes.title,
      notes.intro,
      ...notes.sections.flatMap((section) => [
        section.title,
        ...section.paragraphs,
        section.subheading,
        ...section.details,
      ]),
    ].join(" ");
    return text
      .toLocaleLowerCase()
      .includes(query.value.trim().toLocaleLowerCase());
  }),
);
function date(value: string) {
  return new Intl.DateTimeFormat("en", {
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
        <span>{{ copy.searchHistory }}</span>
        <SituateInput
          ref="search"
          v-model="query"
          type="search"
          :placeholder="copy.searchPlaceholder"
        />
      </label>
      <div
        ref="list"
        class="history-list"
        role="region"
        :aria-label="copy.history"
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
                    v-if="item.version === state.installed"
                    class="installed"
                    >{{ copy.installed }}</span
                  >
                  <time :datetime="item.date">{{ date(item.date) }}</time>
                </span>
                <span>{{ title(item.content) }}</span>
              </span>
              <span aria-hidden="true">›</span>
            </SituateButton>
          </li>
        </ul>
        <div v-else class="history-empty">
          <p role="status">{{ copy.noReleases }}</p>
          <SituateButton variant="secondary" @click="clearSearch">{{
            copy.clearSearch
          }}</SituateButton>
        </div>
      </div>
    </template>
    <template v-else>
      <nav class="history-navigation" :aria-label="copy.history">
        <SituateButton variant="ghost" size="small" @click="back"
          >‹ {{ copy.backToHistory }}</SituateButton
        >
        <div>
          <SituateButton
            variant="ghost"
            size="small"
            :disabled="selected === 0"
            @click="adjacent(-1)"
            >{{ copy.newerRelease }}</SituateButton
          >
          <SituateButton
            variant="ghost"
            size="small"
            :disabled="selected === catalog.length - 1"
            @click="adjacent(1)"
            >{{ copy.olderRelease }}</SituateButton
          >
        </div>
      </nav>
      <section
        ref="detail"
        class="history-detail"
        role="region"
        :aria-label="copy.version.replace('{version}', release.version)"
        tabindex="0"
        data-dialog-document
      >
        <header class="version-heading">
          <h3 tabindex="-1">
            {{ copy.version.replace("{version}", release.version) }}
          </h3>
          <time :datetime="release.date">{{ date(release.date) }}</time>
          <span v-if="release.version === state.installed" class="installed">{{
            copy.installed
          }}</span>
        </header>
        <ReleaseNotes :key="release.version" :release="release.content" />
      </section>
    </template>
  </div>
</template>

<style scoped>
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
