<script setup lang="ts">
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import { SituateSelect, SituateButton, SituateCheckbox } from "../ui";
import {
  cloneSettings,
  selectProvider,
  providerStates,
  currentProviderState,
  setProviderState,
  completeProviderRetry,
  connectionName,
  type ProviderState,
  updateConnection,
  initialFormats,
  type SettingsState,
} from "./model";
import AiControls from "../ai/AiControls.vue";
import {
  connectionCatalog,
  completeModelRefresh,
  type CatalogOutcome,
} from "./catalog";
const catalogOutcomes: { id: CatalogOutcome; label: string }[] = [
  { id: "ready", label: "Models loaded" },
  { id: "empty", label: "No suitable models" },
  { id: "excluded", label: "Saved model excluded" },
  { id: "error", label: "Refresh failed" },
  { id: "unknown", label: "Discovery unavailable" },
];
import { workshopSettings } from "../workshop/content";
import { accents, type Accent } from "./accents";
import appearanceCopy from "../localization/en.appearance.json";
const props = defineProps<{ state: SettingsState; workspaceName: string }>();
const emit = defineEmits<{ "update:state": [state: SettingsState] }>();
function update(change: (s: SettingsState) => void) {
  const next = cloneSettings(props.state);
  change(next);
  emit("update:state", next);
}
</script>
<template>
  <AiControls
    v-if="state.page === 'ai' && state.setup"
    :state="state.setup"
    :connection-workspace="workspaceName"
    @update:state="update((s) => updateConnection(s, $event))"
  />
  <p v-else-if="state.page === 'ai' && state.dialog" class="help">
    This decision affects only {{ connectionName(state, state.target) }} in this
    workspace on this device. Cancel or Escape preserves the connection. Reset
    restores the starting state.
  </p>
  <div v-else>
    <p v-if="state.page !== 'appearance'" class="help">
      Workspace settings proposal. Provider connections, models and key bindings
      use synthetic data. No credentials, network requests or global hotkeys are
      involved.
    </p>
    <template v-if="state.page === 'appearance'">
      <p class="help">
        Six brand colors with immediate, workspace-local feedback. Light accents
        use dark labels and darker related tones for text and control edges.
        Bend, illustrations and semantic status colors stay unchanged. Storage
        and synchronization are not simulated.
      </p>
      <label for="accent-fixture">Workspace accent</label>
      <SituateSelect
        id="accent-fixture"
        :value="state.accent"
        @change="
          update((s) => {
            s.accent = ($event.target as HTMLSelectElement).value as Accent;
          })
        "
      >
        <option v-for="accent in accents" :key="accent" :value="accent">
          {{ appearanceCopy.colors[accent] }}
        </option>
      </SituateSelect>
    </template>
    <template v-if="state.page === 'formats'">
      <p class="help">
        The English interface stays visible in this study; language selection
        stores a preference without translating the screen. Formats update
        independently. System values are sampled once at creation, with a
        per-field language fallback.
      </p>
      <SituateButton
        variant="secondary"
        size="small"
        type="button"
        @click="
          update((s) => {
            s.formats = initialFormats(s.language, {});
          })
        "
      >
        Apply missing-system-values fixture
      </SituateButton>
      <SituateButton
        variant="secondary"
        size="small"
        type="button"
        @click="
          update((s) => {
            s.formats = initialFormats(s.language, {
              time: '24',
              date: 'dmy-dot',
              number: 'comma-dot',
            });
          })
        "
      >
        Apply system-formats fixture
      </SituateButton>
    </template>
    <template v-if="state.page === 'ai'">
      <template
        v-if="
          !state.useManaged && connectionCatalog(state).status === 'loading'
        "
      >
        <p class="help">
          Model discovery for {{ connectionName(state, state.provider) }}.
          Completing it does not send a chat request or change saved model
          choices.
        </p>
        <SituateButton
          variant="secondary"
          size="small"
          v-for="outcome in catalogOutcomes"
          :key="outcome.id"
          type="button"
          :data-catalog-outcome="outcome.id"
          @click="
            update((s) =>
              completeModelRefresh(
                s,
                s.provider,
                connectionCatalog(s).request,
                outcome.id,
              ),
            )
          "
        >
          {{ outcome.label }}
        </SituateButton>
      </template>
      <template v-if="state.connected.includes('openai')">
        <label for="settings-model-example">Model choice example</label>
        <SituateSelect
          id="settings-model-example"
          :value="state.provider === 'openai' ? state.chatModel : ''"
          @change="
            update((s) => {
              selectProvider(s, 'openai');
              s.chatModel = ($event.target as HTMLSelectElement).value;
            })
          "
        >
          <option value="" disabled>Choose an example…</option>
          <option value="recommended">Recommended model</option>
          <option value="GPT Chat">Without adjustable thinking</option>
          <option value="Example Reasoning">Three thinking levels</option>
        </SituateSelect>
        <p class="help">
          Thinking capabilities and recommended levels use synthetic models, not
          provider qualification data.
        </p>
      </template>
      <label for="provider-state">Provider state</label>
      <SituateSelect
        id="provider-state"
        :value="currentProviderState(state)"
        @change="
          update((s) =>
            setProviderState(
              s,
              ($event.target as HTMLSelectElement).value as ProviderState,
            ),
          )
        "
      >
        <option v-for="item in providerStates" :key="item.id" :value="item.id">
          {{ item.label }}
        </option>
      </SituateSelect>
      <p class="help">
        Replaces this device’s example connections. Review provider restrictions
        through the action beside the affected connection. Platform and viewport
        controls do not switch devices or replace their configuration.
      </p>
      <template v-for="(connection, id) in state.connectionStates" :key="id">
        <SituateButton
          variant="secondary"
          size="small"
          v-if="connection.storeRetry"
          type="button"
          data-outcome="store-ready"
          @click="update((s) => completeProviderRetry(s, id))"
        >
          Saved sign-in available · {{ connectionName(state, id) }}
        </SituateButton>
      </template>
      <label for="managed-available">Situate account has AI access</label>
      <SituateCheckbox
        id="managed-available"
        type="checkbox"
        :checked="state.managedAvailable"
        @change="
          update((s) => {
            s.managedAvailable = ($event.target as HTMLInputElement).checked;
          })
        "
      />
      <p class="help">
        Changes account availability without selecting an AI service or
        replacing this device’s provider. No sign-in or billing is performed.
      </p>
      <p class="help">{{ workshopSettings.aiHelp }}</p>
    </template>
    <p v-if="state.page === 'shortcuts'" class="help">
      Binding capture, duplicate detection, clearing and restoring a default are
      interactive. OS-reserved keys, plugin actions and device-specific binding
      storage remain open.
    </p>
    <SituateDisclosure>
      <template #label>Extension points and design basis</template>
      <p class="help">
        The category navigation can accommodate Synchronization, Extensions, and
        Notifications when their settings are defined. Empty future pages are
        not exposed in the preview. Workspace and device-specific settings must
        remain distinguishable.
      </p>
      <p class="help">
        REQ-0047/0048 inform language behavior. REQ-0052 defines the independent
        time, date and number selections. Recommended models and optional chat
        selection remain proposals extending REQ-0015; activity controls extend
        REQ-0039 provisionally.
      </p>
      <p class="help">
        Progressive disclosure and flat groups follow
        <a
          href="https://www.ui-skills.com/skills/pbakaus/distill"
          target="_blank"
          rel="noreferrer"
          >UI Skills: Distill</a
        >,
        <a
          href="https://www.ui-skills.com/skills/jakubkrehel/better-ui"
          target="_blank"
          rel="noreferrer"
          >Better UI</a
        >,
        <a
          href="https://www.ui-skills.com/skills/ibelick/fixing-accessibility"
          target="_blank"
          rel="noreferrer"
          >Fixing Accessibility</a
        >
        and the Situate brand handbook. Shared select fields use desktop
        popovers and mobile sheets with keyboard navigation.
      </p>
    </SituateDisclosure>
  </div>
</template>
