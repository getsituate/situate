<script setup lang="ts">
import { SituateSelect, SituateButton } from "../ui";
import { computed } from "vue";
import { c } from "./content";
import { assignmentAffectedIds } from "./assignment-model";
import type { CodeBrowserState } from "./code-browser";
import {
  addInspectionStressChanges,
  addInspectionLongDiff,
  type InspectionStatus,
} from "./assignment-files";
import {
  applyPluginOutcome,
  activateAssignment,
  resolveAssignmentActivation,
  growAssignment,
  startAssignmentChecks,
  finishAssignmentChecks,
  finishConnectionAttempt,
  clonePluginState,
  finishUninstallPlugin,
  currentDevelopment,
  developmentWorking,
  type DevelopmentPhase,
  type PluginState,
} from "./model";
const props = defineProps<{ state: PluginState }>();
const emit = defineEmits<{
  "update:state": [state: PluginState];
  action: [action: "finish" | "adopt"];
}>();
const copy = c.assignment.controls;
function update(fn: (state: PluginState) => void) {
  const state = clonePluginState(props.state);
  fn(state);
  emit("update:state", state);
}
const development = computed(() =>
  props.state.screen === "development"
    ? currentDevelopment(props.state)
    : undefined,
);
const connection = computed(() =>
  props.state.screen === "detail"
    ? props.state.plugins.find(
        (p) => p.id === props.state.selected && p.kind === "connector",
      )
    : undefined,
);
const connectionVisible = computed(
  () =>
    connection.value &&
    props.state.connectionAttempt?.connectorId === connection.value.id,
);
const outcomes = computed(() => {
  const d = development.value;
  if (!d || !developmentWorking(d)) return [];
  return [
    ...(d.phase === "working" ? ["checking"] : []),
    ...(d.phase === "checking" ? ["waiting"] : []),
    ...(d.phase === "waiting" ? ["adopted"] : []),
    "failed",
    "interrupted",
  ] as (keyof typeof c.outcomes)[];
});
function outcome(phase: DevelopmentPhase) {
  if (phase === "adopted") emit("action", "adopt");
  else update((s) => applyPluginOutcome(s, phase));
}
const fileBrowser = computed(() =>
  props.state.screen === "files"
    ? props.state.fileBrowsers[props.state.selected]
    : undefined,
);
const inspection = computed(() =>
  development.value?.filesOpen && development.value.panel === "files"
    ? development.value.inspection
    : undefined,
);
function fileStatus(status: CodeBrowserState["status"]) {
  update((s) => {
    s.fileBrowsers[s.selected].status = status;
  });
}
function inspectionStatus(status: InspectionStatus) {
  update((s) => {
    const i = currentDevelopment(s)!.inspection;
    i.changes.status = status;
  });
}
function failConsumer() {
  update((s) => {
    const d = currentDevelopment(s)!;
    startAssignmentChecks(d);
    finishAssignmentChecks(
      d,
      d.packages.find((p) => p.kind !== "connector" && p.change !== "unchanged")
        ?.id ?? d.packages[0]?.id,
    );
  });
}
function activate(
  outcome: "success" | "failure" | "uncertain" | "notification-failure",
) {
  update((s) => {
    const affected = assignmentAffectedIds(s, currentDevelopment(s)!);
    for (const p of s.plugins) if (affected.has(p.id)) p.running = 0;
    activateAssignment(s, outcome);
  });
}
function history(available: boolean) {
  update((s) => {
    const i = currentDevelopment(s)!.inspection;
    const change = [...i.recordedChanges, ...i.observations].find(
      (item) => item.id === i.changes.selected,
    );
    const revision = change?.before ?? change?.after;
    if (revision) revision.status = available ? "available" : "unavailable";
  });
}
function stressNames() {
  update((s) => {
    const d = currentDevelopment(s)!;
    d.title = copy.longTitle;
    if (d.packages[0]) {
      d.packages[0].name = copy.longPackage;
      for (const change of d.inspection.recordedChanges)
        if (change.packageId === d.packages[0].id)
          change.packageName = copy.longPackage;
    }
  });
}
function stressChanges() {
  update((s) => addInspectionStressChanges(currentDevelopment(s)!.inspection));
}
</script>
<template>
  <section class="plugin-controls">
    <SituateButton
      v-if="!state.generalError && development"
      variant="secondary"
      size="small"
      @click="
        update((s) => {
          s.generalError = true;
        })
      "
      >{{ c.generalErrorControl }}</SituateButton
    >
    <fieldset
      v-if="state.dialog === 'uninstall' && state.uninstallStatus === 'pending'"
    >
      <legend>{{ c.uninstall.controls.title }}</legend>
      <SituateButton
        variant="secondary"
        @click="update((s) => finishUninstallPlugin(s, true))"
        >{{ c.uninstall.controls.complete }}</SituateButton
      >
      <SituateButton
        variant="secondary"
        @click="update((s) => finishUninstallPlugin(s, false))"
        >{{ c.uninstall.controls.fail }}</SituateButton
      >
    </fieldset>
    <SituateButton
      v-if="
        state.dialog === 'uninstall' &&
        state.plugins.find((p) => p.id === state.target)?.running
      "
      variant="secondary"
      @click="emit('action', 'finish')"
      >{{ c.uninstall.controls.finish }}</SituateButton
    >
    <fieldset
      v-if="
        !state.generalError &&
        state.dialog === 'disable' &&
        state.disableOperation
      "
    >
      <legend>{{ c.disableProgress.controls }}</legend>
      <template
        v-if="['waiting', 'stopping'].includes(state.disableOperation.phase)"
      >
        <SituateButton
          variant="secondary"
          size="small"
          @click="emit('action', 'finish')"
          >{{ c.disableProgress.complete }}</SituateButton
        >
        <SituateButton
          variant="secondary"
          size="small"
          @click="
            update((s) => {
              s.disableOperation!.phase = 'failed';
            })
          "
          >{{ c.disableProgress.fail }}</SituateButton
        >
        <SituateButton
          variant="secondary"
          size="small"
          @click="
            update((s) => {
              s.disableOperation!.phase = 'uncertain';
            })
          "
          >{{ c.disableProgress.unknown }}</SituateButton
        >
      </template>
      <template v-if="state.disableOperation.phase === 'checking'">
        <SituateButton
          variant="secondary"
          size="small"
          @click="emit('action', 'finish')"
          >{{ c.disableProgress.confirmDisabled }}</SituateButton
        >
        <SituateButton
          variant="secondary"
          size="small"
          @click="
            update((s) => {
              s.disableOperation!.phase = 'failed';
            })
          "
          >{{ c.disableProgress.confirmEnabled }}</SituateButton
        >
      </template>
    </fieldset>
    <template v-if="!state.generalError && !state.dialog">
      <fieldset v-if="state.screen === 'list' && state.plugins.length">
        <legend>{{ c.cardStyleControl }}</legend>
        <SituateButton
          v-for="(label, style) in c.cardStyles"
          :key="style"
          variant="secondary"
          size="small"
          :aria-pressed="state.cardStyle === style"
          @click="
            update((s) => {
              s.cardStyle = style;
            })
          "
          >{{ label }}</SituateButton
        >
      </fieldset>
      <fieldset v-if="fileBrowser">
        <legend>{{ c.fileStatusControl }}</legend>
        <SituateButton
          v-for="(label, status) in c.fileStatusOptions"
          :key="status"
          variant="secondary"
          size="small"
          :aria-pressed="fileBrowser.status === status"
          @click="fileStatus(status)"
          >{{ label }}</SituateButton
        >
      </fieldset>
      <fieldset v-if="inspection">
        <legend>{{ copy.inspection }}</legend>
        <SituateButton
          v-for="(label, status) in copy.inspectionStates"
          :key="status"
          variant="secondary"
          size="small"
          :aria-pressed="inspection.changes.status === status"
          @click="inspectionStatus(status)"
          >{{ label }}</SituateButton
        >
        <template v-if="inspection.changes.selected">
          <SituateButton
            variant="secondary"
            size="small"
            @click="history(false)"
            >{{ copy.historyUnavailable }}</SituateButton
          >
          <SituateButton
            variant="secondary"
            size="small"
            @click="history(true)"
            >{{ copy.historyAvailable }}</SituateButton
          >
        </template>
        <SituateButton
          variant="secondary"
          size="small"
          @click="stressChanges"
          >{{ copy.largeChanges }}</SituateButton
        >
        <SituateButton
          variant="secondary"
          size="small"
          @click="
            update((s) =>
              addInspectionLongDiff(currentDevelopment(s)!.inspection),
            )
          "
          >{{ copy.longDiff }}</SituateButton
        >
      </fieldset>
      <fieldset v-if="connection">
        <legend>{{ copy.connection }}</legend>
        <label
          >{{ copy.platform
          }}<SituateSelect
            :value="state.connectionPlatform"
            @change="
              update((s) => {
                s.connectionPlatform = ($event.target as HTMLSelectElement)
                  .value as PluginState['connectionPlatform'];
                s.connectionAttempt = null;
              })
            "
            ><option value="macos">{{ copy.macos }}</option>
            <option value="ios">{{ copy.ios }}</option></SituateSelect
          ></label
        >
        <p>{{ copy.platformHelp }}</p>
        <SituateButton
          v-for="(label, reason) in c.assignment.readiness"
          :key="reason"
          variant="secondary"
          size="small"
          :aria-pressed="
            (state.connectionAvailability[connection.id] ?? 'ready') === reason
          "
          @click="
            update((s) => {
              s.connectionAvailability[connection!.id] = reason;
              s.connectionAttempt = null;
            })
          "
          >{{ label }}</SituateButton
        >
      </fieldset>
      <template v-if="connectionVisible">
        <h3>{{ c.connectionOutcome }}</h3>
        <SituateButton
          variant="secondary"
          size="small"
          @click="update((s) => finishConnectionAttempt(s, true))"
          >{{ c.completeConnection }}</SituateButton
        >
        <SituateButton
          variant="secondary"
          size="small"
          @click="update((s) => finishConnectionAttempt(s, false))"
          >{{ c.failConnection }}</SituateButton
        >
      </template>
      <template v-if="development">
        <h3>{{ c.controls }}</h3>
        <p>{{ outcomes.length ? c.controlsHelp : c.controlIdle }}</p>
        <SituateButton
          v-for="outcomeId in outcomes"
          :key="outcomeId"
          variant="secondary"
          size="small"
          @click="outcome(outcomeId)"
          >{{ c.outcomes[outcomeId] }}</SituateButton
        >
        <template
          v-if="
            development.packages.length &&
            !['active', 'notification-failed', 'uncertain'].includes(
              development.activation,
            ) &&
            development.phase !== 'discarded'
          "
        >
          <SituateButton
            variant="secondary"
            size="small"
            @click="update(growAssignment)"
            >{{ copy.grow }}</SituateButton
          >
          <SituateButton
            variant="secondary"
            size="small"
            @click="failConsumer"
            >{{ copy.failConsumer }}</SituateButton
          >
        </template>
        <fieldset
          v-if="
            development.check.status === 'passed' &&
            ['ready', 'waiting', 'failed'].includes(development.activation)
          "
        >
          <legend>{{ copy.activation }}</legend>
          <SituateButton
            variant="secondary"
            size="small"
            @click="
              update((s) => {
                currentDevelopment(s)!.activation = 'waiting';
              })
            "
            >{{ copy.waiting }}</SituateButton
          >
          <SituateButton
            variant="secondary"
            size="small"
            @click="activate('failure')"
            >{{ copy.failed }}</SituateButton
          >
          <SituateButton
            variant="secondary"
            size="small"
            @click="activate('uncertain')"
            >{{ copy.uncertain }}</SituateButton
          >
          <SituateButton
            variant="secondary"
            size="small"
            @click="emit('action', 'adopt')"
            >{{ copy.active }}</SituateButton
          >
          <SituateButton
            variant="secondary"
            size="small"
            @click="activate('notification-failure')"
            >{{ copy["notification-failed"] }}</SituateButton
          >
        </fieldset>
        <fieldset v-if="development.activation === 'uncertain'">
          <legend>{{ copy.activation }}</legend>
          <SituateButton
            variant="secondary"
            size="small"
            @click="update((s) => resolveAssignmentActivation(s, true))"
            >{{ copy.inspectActive }}</SituateButton
          >
          <SituateButton
            variant="secondary"
            size="small"
            @click="update((s) => resolveAssignmentActivation(s, false))"
            >{{ copy.inspectNotActive }}</SituateButton
          >
        </fieldset>
        <SituateButton variant="secondary" size="small" @click="stressNames">{{
          copy.longNames
        }}</SituateButton>
      </template>
      <SituateButton
        v-if="
          state.screen === 'list' &&
          !state.disableOperation &&
          state.plugins.some((p) => p.running)
        "
        variant="secondary"
        size="small"
        @click="emit('action', 'finish')"
        >{{ c.finishActions }}</SituateButton
      >
    </template>
  </section>
</template>
<style scoped>
.plugin-controls h3 {
  font-size: 14px;
}
.plugin-controls p {
  font-size: 13px;
  color: var(--situate-muted);
}
button {
  display: block;
  width: 100%;
  margin: 8px 0;
  text-align: start;
}
fieldset {
  min-width: 0;
  margin-top: 16px;
}
</style>
