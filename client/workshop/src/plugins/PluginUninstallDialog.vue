<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { SituateButton, SituateDialog } from "../ui";
import { c } from "./content";
import { affectedPlugins, canUninstallPlugin, type PluginState } from "./model";

const props = defineProps<{ state: PluginState }>();
const emit = defineEmits<{ close: []; confirm: []; disable: [] }>();
const copy = c.uninstall;
const titleId = useId();
const bodyId = useId();
const dialog = ref<InstanceType<typeof SituateDialog>>();
const plugin = computed(() =>
  props.state.plugins.find((p) => p.id === props.state.target),
);
const affected = computed(() =>
  affectedPlugins(props.state, props.state.target),
);
const pending = computed(() => props.state.uninstallStatus === "pending");
const allowed = computed(() =>
  canUninstallPlugin(props.state, props.state.target),
);
let invoker: HTMLElement | null = null;
onMounted(() => {
  invoker = document.activeElement as HTMLElement | null;
  dialog.value?.showModal();
});
onBeforeUnmount(() => {
  dialog.value?.close();
  if (invoker?.isConnected) invoker.focus({ preventScroll: true });
});
function close() {
  if (!pending.value) emit("close");
}
</script>

<template>
  <SituateDialog
    ref="dialog"
    appearance="default"
    class="plugin-uninstall-dialog"
    :aria-labelledby="titleId"
    :aria-describedby="bodyId"
    @cancel.prevent="close"
  >
    <template #header>
      <h2 :id="titleId">
        {{ copy.title.replace("{name}", plugin?.name ?? "") }}
      </h2>
    </template>
    <div :id="bodyId">
      <div v-if="pending" role="status">
        <strong>{{ copy.pending }}</strong>
        <p>{{ copy.pendingHelp }}</p>
      </div>
      <template v-else-if="allowed">
        <p>{{ copy.body }}</p>
        <p>{{ copy.keep }}</p>
      </template>
      <section v-else-if="affected.length" class="plugin-uninstall-blocker">
        <h3>{{ copy.dependencies }}</h3>
        <ul>
          <li v-for="item in affected" :key="item.id">{{ item.name }}</li>
        </ul>
        <p>{{ copy.dependencyHelp }}</p>
      </section>
      <p v-else-if="plugin?.running">{{ copy.runningHelp }}</p>
    </div>
    <p
      v-if="state.uninstallStatus === 'error'"
      role="alert"
      class="plugin-uninstall-error"
    >
      {{ copy.error }}
    </p>
    <template #actions>
      <SituateButton
        variant="secondary"
        autofocus
        :disabled="pending"
        @click="close"
      >
        {{ allowed ? copy.cancel : copy.close }}
      </SituateButton>
      <SituateButton
        v-if="plugin?.enabled && !pending"
        variant="ghost"
        @click="emit('disable')"
      >
        {{ copy.disable }}
      </SituateButton>
      <SituateButton
        v-if="allowed"
        variant="danger"
        :disabled="pending"
        @click="emit('confirm')"
      >
        {{ state.uninstallStatus === "error" ? copy.retry : copy.confirm }}
      </SituateButton>
    </template>
  </SituateDialog>
</template>

<style scoped>
.plugin-uninstall-dialog p {
  margin-block: 12px;
}
.plugin-uninstall-blocker {
  margin-block: 20px;
}
.plugin-uninstall-error {
  color: var(--situate-ink);
}
</style>
