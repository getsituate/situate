<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from "vue";
import { SituateButton, SituateIcon, SituateIconButton } from "../ui";
import SituateSelect from "../ui/SituateSelect.vue";
import EditorDialog from "../editor/EditorDialog.vue";
import { c } from "./content";
import { consumerAccessReason } from "./connection-readiness";
import PluginArtwork from "./PluginArtwork.vue";
import SituateErrorScreen from "../ui/SituateErrorScreen.vue";
import PluginCodeBrowser from "./PluginCodeBrowser.vue";
import PluginDevelopment from "./PluginDevelopment.vue";
import PluginConnections from "./PluginConnections.vue";
import PluginSources from "./PluginSources.vue";
import PluginSourceDetails from "./PluginSourceDetails.vue";
import {
  clone,
  startDocumentAction,
  type DocumentsState,
} from "../documents/model";
import PluginCard from "./PluginCard.vue";
import PluginUninstallDialog from "./PluginUninstallDialog.vue";
import PluginAccountSettings from "./PluginAccountSettings.vue";
import bend from "../brand/bend/svg/wave-welcome.svg";
import curiousBend from "../brand/bend/svg/point-curious.svg";
import { filesFor, codeFolderPaths } from "./fixtures";
import {
  affectedPlugins,
  connectorDependencies,
  selectConnectionAccount,
  startConnectionAttempt,
  canEnablePlugin,
  clonePluginState,
  currentDevelopment,
  startPluginDisable,
  cancelPluginDisable,
  stopPluginDisable,
  discardDevelopment,
  enablePlugin,
  openPluginScreen,
  openPluginFiles,
  startPluginDevelopment,
  startUninstallPlugin,
  type PluginState,
} from "./model";
import "./plugins.css";
const props = defineProps<{
  state: PluginState;
  documents: DocumentsState;
  mobile?: boolean;
  workspaceName: string;
  navigationId?: string;
  navigationOpen?: boolean;
  showNavigation?: boolean;
}>();
const emit = defineEmits<{
  "update:state": [state: PluginState];
  openNavigation: [event: MouseEvent];
  settings: [];
  documents: [];
  "update:documents": [state: DocumentsState];
  abort: [id: string];
}>();
const state = shallowRef(props.state);
watch(
  () => props.state,
  (s) => (state.value = s),
  { flush: "sync" },
);
function update(fn: (s: PluginState) => void) {
  const s = clonePluginState(state.value);
  fn(s);
  state.value = s;
  emit("update:state", s);
}
const heading = ref<HTMLElement>();
const development = ref<InstanceType<typeof PluginDevelopment>>();
const root = ref<HTMLElement>();
function focusList() {
  if (state.value.screen === "list" && state.value.listSection === "sources") {
    const title = root.value?.querySelector<HTMLElement>(
      "[data-source-list-heading]",
    );
    title?.scrollIntoView({ block: "start" });
    title?.focus({ preventScroll: true });
  } else heading.value?.focus();
}
onMounted(() => void nextTick(focusList));
function refreshSource(id: string) {
  const s = clone(props.documents);
  startDocumentAction(s, "refresh", id);
  emit("update:documents", s);
}
async function createSource() {
  update((s) => {
    s.listSection = "sources";
    startPluginDevelopment(s, c.sourceRequest, "source");
  });
  await nextTick();
  development.value?.focusTitle();
}
async function navigate(screen: PluginState["screen"]) {
  const returnId =
    state.value.screen === "files" && screen === "list"
      ? state.value.selected
      : null;
  update((s) => openPluginScreen(s, screen));
  await nextTick();
  const invoker = returnId
    ? root.value?.querySelector<HTMLElement>(
        `[data-plugin-id="${returnId}"] [data-action="view-files"]`,
      )
    : null;
  if (invoker) invoker.focus();
  else focusList();
}
async function inspect(id: string) {
  update((s) => openPluginFiles(s, id));
  await nextTick();
  heading.value?.focus();
}
const tools = computed(() =>
  state.value.plugins.filter((p) => p.kind === "tool"),
);
async function setupAccess(id: string) {
  update((s) => {
    s.returnToDevelopment = s.developmentId;
    s.selected = id;
    s.connectionError = "";
    openPluginScreen(s, "detail");
  });
  await nextTick();
  heading.value?.focus();
}
async function returnToAssignment() {
  update((s) => {
    s.developmentId = s.returnToDevelopment;
    s.returnToDevelopment = "";
    s.connectionAttempt = null;
    openPluginScreen(s, "development");
  });
  await nextTick();
  development.value?.focusTitle();
}
async function detail(id: string) {
  update((s) => {
    s.returnToDevelopment = "";
    s.selected = id;
    s.listSection =
      s.plugins.find((p) => p.id === id)?.kind === "source"
        ? "sources"
        : s.listSection;
    s.connectionError = "";
  });
  await navigate("detail");
}
async function develop(id = "") {
  update((s) => {
    s.selected = id;
    startPluginDevelopment(s);
  });
  await nextTick();
  development.value?.focusTitle();
}
function dialog(kind: PluginState["dialog"], target: string, e: MouseEvent) {
  (e.currentTarget as HTMLElement).focus();
  update((s) => {
    s.dialog = kind;
    s.target =
      kind === "disable" ? (s.disableOperation?.target ?? target) : target;
  });
}
function uninstall(id: string) {
  root.value
    ?.querySelector<HTMLElement>(
      `[data-plugin-id="${id}"] [data-action="more"]`,
    )
    ?.focus({ preventScroll: true });
  update((s) => {
    s.dialog = "uninstall";
    s.target = id;
    s.uninstallStatus = "idle";
  });
}
watch(
  () => state.value.plugins.length,
  async (count, previous) => {
    if (count < previous) {
      await nextTick();
      focusList();
    }
  },
);
const plugin = computed(() =>
  state.value.plugins.find((p) => p.id === state.value.selected),
);
const source = computed(() =>
  props.documents.sources.find((s) => s.id === plugin.value?.id),
);
const target = computed(() =>
  state.value.plugins.find((p) => p.id === state.value.target),
);
const d = computed(() => currentDevelopment(state.value));
const affected = computed(() =>
  affectedPlugins(state.value, state.value.target).filter((p) => p.enabled),
);
const disableStatus = ref<HTMLElement>();
const operation = computed(() => state.value.disableOperation);
const runningPlugins = computed(() =>
  state.value.plugins.filter(
    (p) =>
      p.running > 0 &&
      operation.value?.previous.some((previous) => previous.id === p.id),
  ),
);
const pendingMessage = computed(() => {
  const phase = operation.value?.phase;
  return phase === "waiting"
    ? c.disableProgress.waiting(
        runningPlugins.value.reduce((count, p) => count + p.running, 0),
      )
    : phase
      ? c.disableProgress[phase]
      : "";
});
async function confirmDisable(abort = false) {
  update((s) => startPluginDisable(s, abort));
  await nextTick();
  disableStatus.value?.focus();
}
async function setDisablePhase(phase: "waiting" | "checking" | "stopping") {
  update((s) => {
    if (phase === "stopping") stopPluginDisable(s);
    else if (s.disableOperation) s.disableOperation.phase = phase;
  });
  await nextTick();
  disableStatus.value?.focus();
}
function closeDialog() {
  update((s) => {
    if (
      s.dialog === "disable" &&
      s.disableOperation &&
      ["waiting", "failed"].includes(s.disableOperation.phase)
    )
      cancelPluginDisable(s);
    else s.dialog = null;
  });
}
const running = computed(() =>
  [target.value, ...affected.value].some((p) => p && p.running > 0),
);
async function discard() {
  update(discardDevelopment);
  await nextTick();
  heading.value?.focus();
}
const retained = computed(() =>
  state.value.developments.filter((d) => d.storageMB > 0),
);
function value(e: Event) {
  return (e.target as HTMLInputElement).value;
}
</script>
<template>
  <SituateErrorScreen v-if="state.generalError" :message="c.generalError" />
  <section
    v-else
    ref="root"
    class="plugin-view"
    :class="{
      'plugin-mobile': mobile,
      'plugin-collection-view': state.screen === 'list',
      'plugin-files-view': state.screen === 'files',
      'plugin-development-view': state.screen === 'development',
    }"
  >
    <PluginDevelopment
      v-if="state.screen === 'development' && d"
      :key="d.id"
      ref="development"
      :state="state"
      :navigation-id="navigationId"
      :navigation-open="navigationOpen"
      :show-navigation="showNavigation"
      @update:state="
        (next) => {
          state = next;
          emit('update:state', next);
        }
      "
      @open-navigation="emit('openNavigation', $event)"
      @close="navigate('list')"
      @access="setupAccess"
    />
    <main v-else class="plugin-main">
      <div v-if="state.screen === 'list'" class="plugin-return-navigation">
        <SituateIconButton
          v-if="showNavigation"
          icon="menu"
          :label="c.openNavigation"
          :aria-controls="navigationId"
          :aria-expanded="navigationOpen"
          @click="emit('openNavigation', $event)"
        />
        <SituateButton
          variant="ghost"
          size="small"
          class="plugin-text"
          @click="
            state.returnToDocuments ? emit('documents') : emit('settings')
          "
        >
          ‹ {{ state.returnToDocuments ? c.backDocuments : c.settings }}
        </SituateButton>
      </div>
      <div class="plugin-heading">
        <SituateButton
          variant="ghost"
          size="small"
          v-if="state.screen !== 'list'"
          class="plugin-text"
          @click="
            state.returnToDevelopment ? returnToAssignment() : navigate('list')
          "
        >
          ‹
          {{ state.returnToDevelopment ? c.assignment.backAssignment : c.back }}
        </SituateButton>
        <div class="plugin-title-row">
          <div>
            <div class="plugin-title-context">
              <SituateIconButton
                v-if="showNavigation && state.screen !== 'list'"
                icon="menu"
                :label="c.openNavigation"
                :aria-controls="navigationId"
                :aria-expanded="navigationOpen"
                @click="emit('openNavigation', $event)"
              />
              <div class="plugin-title-copy">
                <h1 ref="heading" tabindex="-1">
                  {{
                    state.screen === "detail" || state.screen === "files"
                      ? plugin?.name
                      : state.screen === "retained"
                        ? c.retained
                        : c.plugins
                  }}
                </h1>
                <span
                  v-if="
                    showNavigation &&
                    state.screen !== 'files' &&
                    state.screen !== 'list'
                  "
                  class="plugin-workspace"
                  >{{ workspaceName }}</span
                >
              </div>
            </div>
            <p
              v-if="state.screen === 'list' && state.plugins.length"
              class="plugin-intro"
            >
              {{ c.intro }}
            </p>
          </div>
          <aside
            v-if="state.screen === 'list' && state.plugins.length"
            class="plugin-create-panel"
          >
            <img :src="bend" alt="" width="88" height="96" />
            <div>
              <h2>{{ c.createTitle }}</h2>
              <p>{{ c.createHelp }}</p>
              <SituateButton @click="develop()"
                >{{ c.newPlugin }}
                <span aria-hidden="true">↗</span></SituateButton
              >
            </div>
          </aside>
        </div>
      </div>
      <p v-if="state.notice" class="plugin-notice" role="status">
        {{ state.notice }}
      </p>
      <template v-if="state.screen === 'list'">
        <section
          v-if="!state.plugins.length"
          class="plugin-first-tool"
          :aria-label="c.empty"
        >
          <div class="plugin-first-tool-art" aria-hidden="true">
            <img :src="curiousBend" alt="" width="320" height="320" />
          </div>
          <div class="plugin-first-tool-copy">
            <h2>{{ c.empty }}</h2>
            <p>{{ c.emptyBody }}</p>
            <div class="plugin-first-tool-actions">
              <SituateButton @click="develop()"
                >{{ c.newPlugin }}
                <span aria-hidden="true">↗</span></SituateButton
              >
            </div>
          </div>
        </section>
        <h2 v-if="state.plugins.length" class="plugin-collection-label">
          {{ c.collection }} <span>{{ tools.length }}</span>
        </h2>
        <section
          v-if="tools.length"
          class="plugin-list plugin-card-grid"
          :aria-label="c.installed"
        >
          <PluginCard
            v-for="p in tools"
            :key="p.id"
            :plugin="p"
            :illustrated="state.cardStyle === 'illustrated'"
            :can-enable="canEnablePlugin(state, p)"
            :settings-label="
              p.settings || connectorDependencies(state, p).length
                ? c.configure
                : ''
            "
            :unavailable-help="
              p.settings || connectorDependencies(state, p).length
                ? c.settingsUnavailable
                : ''
            "
            @uninstall="uninstall(p.id)"
            @develop="develop(p.id)"
            @settings="detail(p.id)"
            @inspect="inspect(p.id)"
            @toggle="
              p.enabled
                ? dialog('disable', p.id, $event)
                : update((s) => enablePlugin(s, p.id))
            "
          >
            <template #artwork><PluginArtwork :kind="p.id" /></template>
            <div v-if="p.dependencies.length" class="plugin-dependency-links">
              <span>{{ c.usesLabel }}</span>
              <SituateButton
                variant="ghost"
                size="small"
                v-for="id in p.dependencies"
                :key="id"
                class="plugin-text"
                @click="detail(id)"
              >
                {{ state.plugins.find((item) => item.id === id)?.name ?? id }}
              </SituateButton>
            </div>
            <template #notice>
              <p
                v-if="p.enabled && consumerAccessReason(state, p)"
                class="plugin-muted"
              >
                {{ consumerAccessReason(state, p) }}
              </p>
              <p
                v-if="!p.enabled && !canEnablePlugin(state, p)"
                class="plugin-muted"
              >
                {{ c.dependencyHelp }}
              </p>
            </template>
          </PluginCard>
        </section>
        <PluginConnections
          @uninstall="uninstall"
          v-if="state.plugins.length"
          :state="state"
          @detail="detail"
          @develop="develop($event)"
          @inspect="inspect"
          @disable="(id, event) => dialog('disable', id, event)"
          @enable="update((s) => enablePlugin(s, $event))"
        />
        <PluginSources
          @uninstall="uninstall"
          :state="state"
          :documents="documents"
          @create="createSource"
          @detail="detail"
          @develop="develop"
          @inspect="inspect"
          @disable="(id, event) => dialog('disable', id, event)"
          @enable="update((s) => enablePlugin(s, $event))"
          @refresh="refreshSource"
        />
        <SituateButton
          variant="plain"
          v-if="state.plugins.length || state.developments.length"
          class="plugin-retained-link"
          @click="navigate('retained')"
        >
          <span class="plugin-retained-caption"
            ><SituateIcon name="chat" /><span
              ><strong>{{ c.retained }}</strong
              ><small>{{ c.retainedSummary }}</small></span
            ></span
          ><span
            >{{ c.storage(retained.reduce((sum, d) => sum + d.storageMB, 0)) }}
            <span aria-hidden="true">›</span></span
          >
        </SituateButton>
      </template>
      <PluginCodeBrowser
        v-else-if="state.screen === 'files' && plugin"
        :state="state.fileBrowsers[plugin.id]"
        :files="filesFor(plugin.name, plugin.kind)"
        :folders="codeFolderPaths"
        @update:state="
          (browser) =>
            update((s) => {
              s.fileBrowsers[plugin!.id] = browser;
            })
        "
      />
      <template v-else-if="state.screen === 'detail' && plugin">
        <section class="plugin-card">
          <p
            v-if="plugin.enabled && consumerAccessReason(state, plugin)"
            class="plugin-muted"
          >
            {{ consumerAccessReason(state, plugin) }}
          </p>
          <template v-if="plugin.enabled">
            <template v-if="plugin.id === 'weekly'"
              ><h2>{{ c.summary }}</h2>
              <div class="plugin-setting">
                <label for="plugin-day">{{ c.planningDay }}</label
                ><SituateSelect
                  id="plugin-day"
                  :value="plugin.day"
                  @change="
                    update((s) => {
                      s.plugins.find((p) => p.id === s.selected)!.day =
                        value($event);
                      s.notice = c.saved;
                    })
                  "
                  ><option value="monday">{{ c.monday }}</option>
                  <option value="friday">{{ c.friday }}</option></SituateSelect
                >
              </div></template
            >
            <PluginSourceDetails
              v-if="plugin.kind === 'source' && source"
              :plugin="plugin"
              :source="source"
              :state="state"
              :documents-state="documents"
              @refresh="refreshSource"
              @detail="detail"
              @documents="emit('documents')"
              @develop="develop"
            />
            <PluginAccountSettings
              v-else
              :state="state"
              :plugin="plugin"
              @detail="detail"
              @connect="
                (id, accountId) =>
                  update((s) => startConnectionAttempt(s, id, accountId))
              "
              @cancel="
                update((s) => {
                  s.connectionAttempt = null;
                })
              "
              @select="
                (id, accountId, selected) =>
                  update((s) =>
                    selectConnectionAccount(s, id, accountId, selected),
                  )
              "
            />
            <p
              v-if="
                plugin.kind === 'tool' &&
                !plugin.settings &&
                !connectorDependencies(state, plugin).length
              "
            >
              {{ c.noSettings }}
            </p>
          </template>
          <template v-else>
            <p>{{ c.settingsUnavailable }}</p>
            <p v-if="!canEnablePlugin(state, plugin)">{{ c.dependencyHelp }}</p>
            <SituateButton
              variant="secondary"
              size="small"
              :disabled="!canEnablePlugin(state, plugin)"
              @click="update((s) => enablePlugin(s, plugin!.id))"
            >
              {{ c.enable }}
            </SituateButton>
          </template>
        </section>
      </template>
      <template v-else-if="state.screen === 'retained'">
        <p class="plugin-muted">{{ c.retainedHelp }}</p>
        <div v-if="!retained.length" class="plugin-empty">
          <h2>{{ c.retainedEmpty }}</h2>
          <p>{{ c.retainedEmptyBody }}</p>
        </div>
        <article
          v-for="item in retained"
          :key="item.id"
          class="plugin-retained-row"
        >
          <div>
            <h2>{{ item.title }}</h2>
            <p>{{ c.phases[item.phase] }} · {{ c.storage(item.storageMB) }}</p>
          </div>
          <div class="plugin-actions">
            <SituateButton
              variant="secondary"
              size="small"
              @click="
                update((s) => (s.developmentId = item.id));
                navigate('development');
              "
            >
              {{ c.open }}</SituateButton
            ><SituateButton
              variant="ghost"
              size="small"
              class="plugin-text"
              :disabled="item.activation === 'uncertain'"
              :title="
                item.activation === 'uncertain'
                  ? c.assignment.activationDetails.uncertain
                  : undefined
              "
              @click="dialog('discard', item.id, $event)"
            >
              {{ c.discard }}
            </SituateButton>
          </div>
        </article>
      </template>
    </main>
    <PluginUninstallDialog
      v-if="state.dialog === 'uninstall'"
      :state="state"
      @close="update((s) => (s.dialog = null))"
      @confirm="update(startUninstallPlugin)"
      @disable="update((s) => (s.dialog = 'disable'))"
    />
    <EditorDialog
      v-if="state.dialog && state.dialog !== 'uninstall'"
      :title="
        state.dialog === 'disable'
          ? c.disableTitle(target?.name ?? '')
          : c.discardTitle
      "
      @close="closeDialog"
    >
      <div class="plugin-dialog">
        <template v-if="state.dialog === 'disable' && operation">
          <p ref="disableStatus" role="status" aria-atomic="true" tabindex="-1">
            {{ pendingMessage }}
          </p>
          <ul
            v-if="
              runningPlugins.length &&
              ['waiting', 'stopping'].includes(operation.phase)
            "
          >
            <li v-for="p in runningPlugins" :key="p.id">
              {{ p.name }} ({{ p.running }})
            </li>
          </ul>
          <p v-if="operation.phase === 'waiting'">
            {{ c.disableProgress.cancelHelp }}
          </p>
          <p v-if="['waiting', 'stopping'].includes(operation.phase)">
            {{ c.externalEffects }}
          </p>
          <div class="plugin-dialog-actions">
            <SituateButton
              variant="secondary"
              size="small"
              autofocus
              @click="closeDialog"
            >
              {{
                ["waiting", "failed"].includes(operation.phase)
                  ? c.disableProgress.cancel
                  : c.disableProgress.close
              }}
            </SituateButton>
            <SituateButton
              v-if="operation.phase === 'waiting'"
              variant="ghost"
              size="small"
              @click="setDisablePhase('stopping')"
              >{{ c.abort }}</SituateButton
            >
            <SituateButton
              v-if="operation.phase === 'failed'"
              @click="setDisablePhase('waiting')"
              >{{ c.disableProgress.retry }}</SituateButton
            >
            <SituateButton
              v-if="operation.phase === 'uncertain'"
              @click="setDisablePhase('checking')"
              >{{ c.disableProgress.check }}</SituateButton
            >
          </div>
        </template>
        <template v-else-if="state.dialog === 'disable'"
          ><p>{{ c.disableBody }}</p>
          <h3 v-if="affected.length">{{ c.affected }}</h3>
          <ul v-if="affected.length">
            <li v-for="p in affected" :key="p.id">{{ p.name }}</li>
          </ul>
          <p v-else>{{ c.noAffected }}</p>
          <p>{{ c.explicitEnable }}</p>
          <p v-if="running">{{ c.running }}</p>
          <p v-if="running">{{ c.externalEffects }}</p>
          <div class="plugin-dialog-actions">
            <SituateButton
              variant="secondary"
              size="small"
              autofocus
              @click="update((s) => (s.dialog = null))"
            >
              {{ c.cancel }}</SituateButton
            ><SituateButton @click="confirmDisable()">{{
              c.disableConfirm
            }}</SituateButton
            ><SituateButton
              variant="ghost"
              size="small"
              v-if="running"
              class="plugin-text"
              @click="confirmDisable(true)"
            >
              {{ c.abort }}
            </SituateButton>
          </div></template
        >
        <template v-else-if="state.dialog === 'discard'"
          ><p>{{ c.discardBody }}</p>
          <div class="plugin-dialog-actions">
            <SituateButton
              variant="secondary"
              size="small"
              autofocus
              @click="update((s) => (s.dialog = null))"
            >
              {{ c.cancel }}</SituateButton
            ><SituateButton variant="danger" @click="discard">{{
              c.confirmDiscard
            }}</SituateButton>
          </div></template
        >
      </div>
    </EditorDialog>
  </section>
</template>
