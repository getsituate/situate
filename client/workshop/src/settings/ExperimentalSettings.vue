<script setup lang="ts">
import { nextTick, ref, useId } from "vue";
import { SituateButton, SituateDialog } from "../ui";
import SituateSwitch from "../ui/SituateSwitch.vue";
import { gmailCopy as copy } from "../plugins/gmail-experiment";

const props = defineProps<{ enabled: boolean }>();
const emit = defineEmits<{ change: [enabled: boolean] }>();
const showNotice = ref(false);
const control = ref<InstanceType<typeof SituateSwitch>>();
const id = useId();

function change(enabled: boolean) {
  if (!enabled) emit("change", false);
  else {
    if (control.value?.element) control.value.element.checked = props.enabled;
    showNotice.value = true;
  }
}

async function close(confirmed = false) {
  showNotice.value = false;
  if (confirmed) emit("change", true);
  await nextTick();
  control.value?.focus();
}
</script>

<template>
  <section class="settings-group">
    <div class="setting-row">
      <div>
        <label :for="`${id}-gmail`">Gmail</label>
        <p :id="`${id}-help`">
          Make Gmail available under Plugins → Connections on this Mac.
        </p>
      </div>
      <SituateSwitch
        :id="`${id}-gmail`"
        ref="control"
        :aria-describedby="`${id}-help`"
        :model-value="enabled"
        @update:model-value="change"
      />
    </div>
  </section>
  <SituateDialog
    :open="showNotice"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="`${id}-notice`"
    @cancel.prevent="close()"
  >
    <template #header
      ><h2 :id="`${id}-title`">{{ copy.enable }}?</h2></template
    >
    <p :id="`${id}-notice`">
      Only Google accounts on the test list can connect. During testing, you’ll
      need to reconnect every seven days.
    </p>
    <template #actions>
      <SituateButton variant="secondary" autofocus @click="close()"
        >Cancel</SituateButton
      >
      <SituateButton @click="close(true)">{{ copy.enable }}</SituateButton>
    </template>
  </SituateDialog>
</template>
