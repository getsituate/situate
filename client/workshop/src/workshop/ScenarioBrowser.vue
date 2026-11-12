<script setup lang="ts">
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import { SituateInput, SituateButton, SituateSelect } from "../ui";
import { computed, ref } from "vue";
import { canonicalScenario, type Scenario } from "./simulation";
import {
  matchingScenarios,
  scenarioCatalog,
  scenarioForState,
} from "./scenario-catalog";
import { scenarioBrowser as c } from "./content";

const props = defineProps<{ selected: Scenario }>();
const emit = defineEmits<{ select: [scenario: Scenario] }>();
const query = ref("");
const group = ref("");
const groups = [...new Set(scenarioCatalog.map((item) => item.group))];
const current = computed(() => scenarioForState(props.selected));
const matches = computed(() => matchingScenarios(query.value));
function selectState(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const item = current.value.states.find((state) => state.id === id);
  if (item) emit("select", item.id);
}
const visible = computed(() =>
  matches.value.filter((item) => !group.value || item.group === group.value),
);
function clear() {
  query.value = "";
  group.value = "";
}

function select(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const item = visible.value.find((item) => item.id === id);
  if (item) emit("select", item.id);
}
</script>

<template>
  <div class="scenario-browser">
    <p class="selected-scenario">
      <span>{{ c.selected }}</span
      ><strong>{{ current.label }}</strong
      ><small>{{ current.group }}</small>
    </p>
    <SituateDisclosure class="scenario-filters">
      <template #label>{{ query || group ? c.filtered : c.find }}</template>
      <label for="scenario-search">{{ c.search }}</label>
      <SituateInput
        id="scenario-search"
        v-model="query"
        type="search"
        :placeholder="c.searchHint"
      />
      <div class="scenario-groups" role="group" :aria-label="c.groups">
        <SituateButton
          variant="secondary"
          size="small"
          type="button"
          :aria-pressed="group === ''"
          @click="group = ''"
        >
          {{ c.all }} <span>{{ matches.length }}</span>
        </SituateButton>
        <SituateButton
          variant="secondary"
          size="small"
          v-for="name in groups"
          :key="name"
          type="button"
          :aria-pressed="group === name"
          @click="group = name"
        >
          {{ name }}
          <span>{{
            matches.filter((item) => item.group === name).length
          }}</span>
        </SituateButton>
      </div>
      <SituateButton
        variant="secondary"
        size="small"
        v-if="query || group"
        type="button"
        class="clear-filters"
        @click="clear"
      >
        {{ c.clear }}
      </SituateButton>
    </SituateDisclosure>
    <div class="scenario-results">
      <label for="scenario">{{ c.scenario }}</label>
      <span role="status">{{ c.results(visible.length) }}</span>
    </div>
    <SituateSelect
      v-if="visible.length"
      id="scenario"
      :value="visible.some((item) => item.id === current.id) ? current.id : ''"
      @change="select"
    >
      <optgroup
        v-for="name in groups.filter((name) =>
          visible.some((item) => item.group === name),
        )"
        :key="name"
        :label="name"
      >
        <option
          v-for="item in visible.filter((item) => item.group === name)"
          :key="item.id"
          :value="item.id"
        >
          {{ item.label }}
        </option>
      </optgroup>
    </SituateSelect>
    <p v-else class="scenario-empty">{{ c.empty }}</p>
    <template v-if="current.states.length > 1">
      <label for="scenario-state">{{ c.state }}</label>
      <SituateSelect
        id="scenario-state"
        :value="canonicalScenario(selected)"
        aria-describedby="scenario-state-help"
        @change="selectState"
      >
        <option
          v-for="state in current.states"
          :key="state.id"
          :value="state.id"
        >
          {{ state.label }}
        </option>
      </SituateSelect>
      <p id="scenario-state-help" class="state-help">{{ c.stateHelp }}</p>
    </template>
  </div>
</template>

<style scoped>
.scenario-browser {
  display: grid;
  gap: 10px;
  min-width: 0;
}
.scenario-filters {
  display: grid;
  gap: 10px;
}
.scenario-filters :deep(summary) {
  cursor: pointer;
  min-height: 44px;
  align-content: center;
  font-size: 14px;
}
.scenario-filters label {
  display: block;
  margin-bottom: 8px;
}
.scenario-groups {
  margin-block: 10px;
}
.state-help {
  margin: 0;
  color: var(--situate-muted);
  font-size: 12px;
  line-height: 1.5;
}
.selected-scenario {
  display: grid;
  gap: 3px;
  margin: 0 0 4px;
  padding-left: 12px;
  border-left: 3px solid var(--situate-violet-deep);
}
.selected-scenario span,
.selected-scenario small,
.scenario-results span {
  font-size: 12px;
  color: var(--situate-muted);
}
.scenario-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.scenario-groups button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin: 0;
  text-align: left;
  font-size: 12px;
}
.scenario-groups button[aria-pressed="true"] {
  background: var(--situate-lilac);
  border-color: var(--situate-violet-deep);
  color: var(--situate-ink);
}
.scenario-groups span {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.scenario-results {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 4px;
}

.scenario-empty {
  margin: 0;
  padding: 16px 0;
}
.clear-filters {
  justify-self: start;
}
</style>
