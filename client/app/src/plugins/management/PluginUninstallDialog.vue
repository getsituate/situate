<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import { SituateButton, SituateDialog } from "@situate/ui";
import { t } from "@situate/localization";

const props = defineProps<{
  name: string;
  enabled: boolean;
  affected: readonly { id: string; name: string }[];
  running: number;
  status: "confirm" | "pending" | "error" | "unknown";
}>();
const emit = defineEmits<{ close: []; confirm: []; disable: [] }>();
const titleId = useId();
const bodyId = useId();
const dialog = ref<InstanceType<typeof SituateDialog>>();
const pending = computed(() => props.status === "pending");
const allowed = computed(() => !props.affected.length && !props.running);
onMounted(() => dialog.value?.showModal());
function close() {
  if (!pending.value) emit("close");
}
</script>

<template>
  <SituateDialog
    ref="dialog"
    class="plugin-uninstall-dialog"
    :aria-labelledby="titleId"
    :aria-describedby="bodyId"
    :aria-busy="pending"
    @cancel.prevent="close"
  >
    <template #header>
      <h2 :id="titleId">
        {{ t("pluginManagement.uninstall.title", { name }) }}
      </h2>
    </template>
    <div :id="bodyId">
      <div v-if="pending" role="status">
        <strong>{{ t("pluginManagement.uninstall.pending") }}</strong>
        <p>{{ t("pluginManagement.uninstall.pendingHelp") }}</p>
      </div>
      <p v-else-if="status === 'unknown'" role="alert">
        {{ t("pluginManagement.uninstall.unknown") }}
      </p>
      <template v-else>
        <template v-if="allowed">
          <p>{{ t("pluginManagement.uninstall.body") }}</p>
          <p>{{ t("pluginManagement.uninstall.keep") }}</p>
        </template>
        <section v-if="affected.length" class="plugin-uninstall-blocker">
          <h3>{{ t("pluginManagement.uninstall.dependencies") }}</h3>
          <ul>
            <li
              v-for="item in affected"
              :key="item.id"
              data-localization-content="user"
            >
              {{ item.name }}
            </li>
          </ul>
          <p>{{ t("pluginManagement.uninstall.dependencyHelp") }}</p>
        </section>
        <p v-if="running">{{ t("pluginManagement.uninstall.runningHelp") }}</p>
      </template>
    </div>
    <p v-if="status === 'error'" role="alert">
      {{ t("pluginManagement.uninstall.error") }}
    </p>
    <template #actions>
      <SituateButton
        variant="secondary"
        autofocus
        :disabled="pending"
        @click="close"
      >
        {{
          t(
            allowed && status !== "unknown"
              ? "pluginManagement.uninstall.cancel"
              : "pluginManagement.uninstall.close",
          )
        }}
      </SituateButton>
      <SituateButton
        v-if="enabled && (status === 'confirm' || status === 'error')"
        variant="ghost"
        @click="emit('disable')"
      >
        {{ t("pluginManagement.uninstall.disable") }}
      </SituateButton>
      <SituateButton
        v-if="allowed && status !== 'unknown'"
        variant="danger"
        :disabled="pending"
        @click="emit('confirm')"
      >
        {{
          t(
            status === "error"
              ? "pluginManagement.uninstall.retry"
              : "pluginManagement.uninstall.confirm",
          )
        }}
      </SituateButton>
    </template>
  </SituateDialog>
</template>

<style scoped>
.plugin-uninstall-blocker {
  margin-block: 20px;
}
</style>
