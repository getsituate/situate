<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { SituateButton, SituateIcon, SituateIconButton } from "@situate/ui";
import {
  t,
  type Formats,
  type LocalizationSnapshot,
  type MessageKey,
  type Preferences,
} from "@situate/localization";
import { SituateSelect } from "@situate/ui";
import AppearanceSettings from "./AppearanceSettings.vue";
import DictationSettings from "../dictation/DictationSettings.vue";
import { dictation } from "../dictation/runtime";
import { updates, updateReady } from "../updates/runtime";
import UpdateSettings from "../updates/UpdateSettings.vue";
import AboutSituate from "../updates/AboutSituate.vue";
import UpdateSymbol from "../updates/UpdateSymbol.vue";
import type { Accent, AppearanceSnapshot } from "./accents";
import type { WorkspaceAiSettings } from "../ai/settings";
import "./settings.css";
const AiSettings = defineAsyncComponent(() => import("./AiSettings.vue"));
const props = defineProps<{
  workspaceScope?: string;
  workspaceName?: string;
  appearance?: AppearanceSnapshot | null;
  accent?: Accent;
  appearanceLoading?: boolean;
  appearanceSaving?: boolean;
  appearanceError?: MessageKey | "";
  snapshot: LocalizationSnapshot | null;
  loading: boolean;
  saving: boolean;
  error: MessageKey | "";
  showNavigation: boolean;
  navigationId: string;
  navigationOpen: boolean;
}>();
const emit = defineEmits<{
  change: [value: Preferences];
  accent: [value: Accent];
  retryAppearance: [];
  "ai-settings-saved": [settings: WorkspaceAiSettings];
  retry: [];
  close: [];
  connect: [];
  plugins: [];
  navigation: [event: MouseEvent];
}>();
const detail = ref(false);
type SettingsPage =
  "formats" | "appearance" | "ai" | "dictation" | "updates" | "about";
const page = ref<SettingsPage>("formats");
const aiVisited = ref(false);
watch(
  () => props.workspaceScope,
  () => {
    aiVisited.value = page.value === "ai";
  },
);
const title = useTemplateRef<HTMLElement>("title");
const categoryControl =
  useTemplateRef<InstanceType<typeof SituateButton>>("categoryControl");
const category = computed(() => categoryControl.value?.element);
const appearanceCategoryControl = useTemplateRef<
  InstanceType<typeof SituateButton>
>("appearanceCategoryControl");
const appearanceCategory = computed(
  () => appearanceCategoryControl.value?.element,
);
const aiCategoryControl =
  useTemplateRef<InstanceType<typeof SituateButton>>("aiCategoryControl");
const aiCategory = computed(() => aiCategoryControl.value?.element);
const dictationCategoryControl = useTemplateRef<
  InstanceType<typeof SituateButton>
>("dictationCategoryControl");
const dictationCategory = computed(
  () => dictationCategoryControl.value?.element,
);
const updatesCategoryControl = useTemplateRef<
  InstanceType<typeof SituateButton>
>("updatesCategoryControl");
const updatesCategory = computed(() => updatesCategoryControl.value?.element);
const aboutCategoryControl = useTemplateRef<InstanceType<typeof SituateButton>>(
  "aboutCategoryControl",
);
const aboutCategory = computed(() => aboutCategoryControl.value?.element);
watch(
  () => updates.supported,
  (supported) => {
    if (!supported && page.value === "updates") void openPage("formats");
  },
);
async function openPage(value: SettingsPage): Promise<void> {
  if (value === "ai") aiVisited.value = true;
  page.value = value;
  detail.value = true;
  await nextTick();
  title.value?.focus();
}
async function back(): Promise<void> {
  detail.value = false;
  await nextTick();
  const selected = {
    formats: category,
    appearance: appearanceCategory,
    ai: aiCategory,
    dictation: dictationCategory,
    updates: updatesCategory,
    about: aboutCategory,
  };
  selected[page.value].value?.focus();
}
function navigateBack(): void {
  if (detail.value && window.matchMedia("(max-width: 760px)").matches)
    void back();
  else emit("close");
}
defineExpose({
  back: navigateBack,
  openDictation: () => openPage("dictation"),
  openUpdates: () => updates.supported && openPage("updates"),
});
onMounted(() => {
  (window.matchMedia("(max-width: 760px)").matches
    ? category.value
    : title.value
  )?.focus();
});
const dates: { value: Formats["date"]; key: MessageKey }[] = [
  { value: "dmy-dot", key: "settings.formats.date.dmyDot" },
  { value: "dmy-slash", key: "settings.formats.date.dmySlash" },
  { value: "mdy", key: "settings.formats.date.mdy" },
  { value: "ymd", key: "settings.formats.date.ymd" },
];
const numbers: { value: Formats["number"]; key: MessageKey }[] = [
  { value: "dot-comma", key: "settings.formats.number.dotComma" },
  { value: "comma-dot", key: "settings.formats.number.commaDot" },
  { value: "dot-space", key: "settings.formats.number.dotSpace" },
  { value: "comma-space", key: "settings.formats.number.commaSpace" },
  { value: "dot-apostrophe", key: "settings.formats.number.dotApostrophe" },
];
function change(field: "language" | keyof Formats, event: Event): void {
  if (
    !props.snapshot ||
    props.loading ||
    props.saving ||
    !props.snapshot.writable
  )
    return;
  const control = event.target as HTMLSelectElement;
  const value = control.value;
  const preferences: Preferences = {
    language: props.snapshot.language,
    formats: { ...props.snapshot.formats },
  };
  if (field === "language")
    preferences.language = value as Preferences["language"];
  else Object.assign(preferences.formats, { [field]: value });
  control.value =
    field === "language"
      ? props.snapshot.language
      : props.snapshot.formats[field];
  emit("change", preferences);
}
</script>

<template>
  <section
    class="settings-view"
    :class="{ 'settings-detail-open': detail }"
    :aria-label="t('settings.title')"
  >
    <header class="settings-topbar">
      <SituateIconButton
        v-if="showNavigation"
        class="open-navigation"
        icon="menu"
        :label="t('navigation.openNavigation')"
        :aria-controls="navigationId"
        :aria-expanded="navigationOpen"
        @click="emit('navigation', $event)"
      />
      <span>{{
        t(
          page === "updates" || page === "about"
            ? "updates.scope"
            : page === "dictation"
              ? "dictation.scope"
              : "settings.workspace",
        )
      }}</span>
    </header>
    <div class="settings-layout">
      <nav class="settings-categories" :aria-label="t('settings.categories')">
        <h1>{{ t("settings.title") }}</h1>
        <SituateButton
          variant="plain"
          ref="categoryControl"
          type="button"
          :aria-current="page === 'formats' ? 'page' : undefined"
          @click="openPage('formats')"
        >
          <span class="category-symbol" aria-hidden="true">{{
            t("settings.formats.symbol")
          }}</span
          ><span>{{ t("settings.formats.title") }}</span
          ><span class="category-arrow" aria-hidden="true">›</span>
        </SituateButton>
        <SituateButton
          variant="plain"
          ref="appearanceCategoryControl"
          type="button"
          :aria-current="page === 'appearance' ? 'page' : undefined"
          @click="openPage('appearance')"
        >
          <span class="category-symbol" aria-hidden="true">{{
            t("settings.appearance.symbol")
          }}</span>
          <span>{{ t("settings.appearance.title") }}</span>
          <span class="category-arrow" aria-hidden="true">›</span>
        </SituateButton>
        <SituateButton
          v-if="dictation.supported"
          variant="plain"
          ref="dictationCategoryControl"
          type="button"
          :aria-current="page === 'dictation' ? 'page' : undefined"
          @click="openPage('dictation')"
        >
          <SituateIcon name="mic" class="category-symbol" />
          <span>{{ t("dictation.title") }}</span>
          <span class="category-arrow" aria-hidden="true">›</span>
        </SituateButton>
        <SituateButton
          variant="plain"
          ref="aiCategoryControl"
          type="button"
          :aria-current="page === 'ai' ? 'page' : undefined"
          @click="openPage('ai')"
        >
          <span class="category-symbol" aria-hidden="true">{{
            t("settings.aiAccess.symbol")
          }}</span
          ><span>{{ t("settings.ai.title") }}</span>
        </SituateButton>
        <SituateButton
          v-if="updates.supported"
          variant="plain"
          ref="updatesCategoryControl"
          type="button"
          :aria-current="page === 'updates' ? 'page' : undefined"
          @click="openPage('updates')"
        >
          <UpdateSymbol class="category-symbol" />
          <span>{{ t("updates.title") }}</span>
          <span
            v-if="updateReady()"
            class="update-category-badge"
            role="img"
            :aria-label="t('updates.notice')"
          ></span>
          <span class="category-arrow" aria-hidden="true">›</span>
        </SituateButton>
        <SituateButton
          v-if="workspaceScope"
          variant="plain"
          type="button"
          data-action="manage-plugins"
          @click="emit('plugins')"
        >
          <span class="category-symbol" aria-hidden="true">{{
            t("pluginManagement.symbol")
          }}</span>
          <span>{{ t("pluginManagement.title") }}</span>
          <span class="category-arrow" aria-hidden="true">›</span>
        </SituateButton>
        <SituateButton
          variant="plain"
          ref="aboutCategoryControl"
          type="button"
          :aria-current="page === 'about' ? 'page' : undefined"
          @click="openPage('about')"
        >
          <SituateIcon name="info" class="category-symbol" />
          <span>{{ t("releaseHistory.about") }}</span>
          <span class="category-arrow" aria-hidden="true">›</span>
        </SituateButton>
      </nav>
      <div class="settings-content">
        <div class="settings-content-inner">
          <SituateButton
            variant="plain"
            class="settings-back"
            type="button"
            @click="back"
          >
            {{ t("settings.back") }}
          </SituateButton>
          <header class="settings-page-heading">
            <h2 ref="title" tabindex="-1">
              {{
                page === "about"
                  ? t("releaseHistory.about")
                  : page === "updates"
                    ? t("updates.title")
                    : page === "dictation"
                      ? t("dictation.title")
                      : page === "appearance"
                        ? t("settings.appearance.title")
                        : page === "ai"
                          ? t("settings.ai.title")
                          : t("settings.formats.title")
              }}
            </h2>
          </header>
          <AiSettings
            v-if="aiVisited"
            v-show="page === 'ai'"
            :key="workspaceScope"
            :workspace-scope="workspaceScope"
            @saved="emit('ai-settings-saved', $event)"
            @connect="emit('connect')"
          />
          <UpdateSettings v-if="page === 'updates' && updates.supported" />
          <AboutSituate v-if="page === 'about'" />
          <DictationSettings v-if="page === 'dictation'" />
          <AppearanceSettings
            v-if="page === 'appearance'"
            :accent="accent ?? 'violet'"
            :workspace-name="workspaceName ?? ''"
            :available="!!appearance"
            :writable="appearance?.writable ?? false"
            :loading="appearanceLoading ?? false"
            :saving="appearanceSaving ?? false"
            :error="appearanceError ?? ''"
            @select="emit('accent', $event)"
            @retry="emit('retryAppearance')"
          />
          <template v-else-if="page === 'formats'">
            <p v-if="loading && !snapshot" role="status">
              {{ t("localization.loading") }}
            </p>
            <div v-if="error" class="settings-error" role="alert">
              <p>{{ t(error) }}</p>
              <SituateButton
                variant="plain"
                type="button"
                :disabled="loading || saving"
                @click="emit('retry')"
              >
                {{ t("localization.retry") }}
              </SituateButton>
            </div>
            <p v-if="snapshot && !snapshot.writable">
              {{ t("localization.readOnly") }}
            </p>
            <template v-if="snapshot">
              <section
                class="settings-group"
                aria-labelledby="language-heading"
              >
                <h3 id="language-heading">
                  {{ t("settings.language.heading") }}
                </h3>
                <div class="setting-row">
                  <div>
                    <label for="settings-language">{{
                      t("settings.language.label")
                    }}</label>
                    <p id="language-help">{{ t("settings.language.help") }}</p>
                  </div>
                  <SituateSelect
                    id="settings-language"
                    :value="snapshot.language"
                    :disabled="saving || loading || !snapshot.writable"
                    aria-describedby="language-help"
                    @change="change('language', $event)"
                  >
                    <option value="en">
                      {{ t("settings.language.english") }}
                    </option>
                    <option value="de">
                      {{ t("settings.language.german") }}
                    </option>
                  </SituateSelect>
                </div>
              </section>
              <section class="settings-group" aria-labelledby="formats-heading">
                <h3 id="formats-heading">
                  {{ t("settings.formats.heading") }}
                </h3>
                <div class="setting-row">
                  <label for="settings-time">{{
                    t("settings.formats.time.label")
                  }}</label
                  ><SituateSelect
                    id="settings-time"
                    :value="snapshot.formats.time"
                    :disabled="saving || loading || !snapshot.writable"
                    @change="change('time', $event)"
                    ><option value="24">
                      {{ t("settings.formats.time.24") }}
                    </option>
                    <option value="12">
                      {{ t("settings.formats.time.12") }}
                    </option></SituateSelect
                  >
                </div>
                <div class="setting-row">
                  <label for="settings-date">{{
                    t("settings.formats.date.label")
                  }}</label
                  ><SituateSelect
                    id="settings-date"
                    :value="snapshot.formats.date"
                    :disabled="saving || loading || !snapshot.writable"
                    @change="change('date', $event)"
                    ><option
                      v-for="item in dates"
                      :key="item.value"
                      :value="item.value"
                    >
                      {{ t(item.key) }}
                    </option></SituateSelect
                  >
                </div>
                <div class="setting-row">
                  <label for="settings-number">{{
                    t("settings.formats.number.label")
                  }}</label
                  ><SituateSelect
                    id="settings-number"
                    :value="snapshot.formats.number"
                    :disabled="saving || loading || !snapshot.writable"
                    @change="change('number', $event)"
                    ><option
                      v-for="item in numbers"
                      :key="item.value"
                      :value="item.value"
                    >
                      {{ t(item.key) }}
                    </option></SituateSelect
                  >
                </div>
              </section>
            </template>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.update-category-badge {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--situate-accent-strong);
}
</style>
