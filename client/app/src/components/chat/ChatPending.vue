<script setup lang="ts">
import { SituateButton, SituateDisclosure } from "@situate/ui";
import { ref, useId, watch } from "vue";
import { t } from "@situate/localization";

interface PendingMessage {
  id: string;
  kind: "steering" | "followUp";
  text: string;
  attachments: { id: string; name: string }[];
}
const props = defineProps<{ messages: PendingMessage[] }>();
defineEmits<{ recall: [] }>();
const expanded = ref(false);
const detailsId = useId();
watch(
  () => props.messages.length,
  (count) => {
    if (!count) expanded.value = false;
  },
);
</script>

<template>
  <section
    v-if="messages.length"
    class="pending"
    :aria-label="t('chat.pending')"
  >
    <header>
      <SituateButton
        variant="plain"
        type="button"
        class="pending-toggle"
        :aria-expanded="expanded"
        :aria-controls="detailsId"
        @click="expanded = !expanded"
      >
        <span class="pending-chevron" :class="{ expanded }" aria-hidden="true"
          >›</span
        >
        {{ t("chat.pendingCount", { count: messages.length }) }}
      </SituateButton>
      <SituateButton
        variant="plain"
        type="button"
        class="edit-pending"
        aria-keyshortcuts="Alt+ArrowUp"
        @click="$emit('recall')"
      >
        {{ t("chat.editPending") }}
      </SituateButton>
    </header>
    <div v-show="expanded" :id="detailsId" class="pending-list">
      <template v-for="kind in ['steering', 'followUp'] as const" :key="kind">
        <section
          v-if="messages.some((message) => message.kind === kind)"
          class="pending-group"
        >
          <h3>
            {{ kind === "steering" ? t("chat.steering") : t("chat.followUp") }}
          </h3>
          <div
            class="pending-items"
            tabindex="0"
            :aria-label="
              kind === 'steering'
                ? t('chat.pendingSteering')
                : t('chat.pendingFollowUp')
            "
          >
            <SituateDisclosure
              v-for="message in messages.filter((item) => item.kind === kind)"
              :key="message.id"
              class="pending-message"
            >
              <template #label>
                <span
                  class="pending-preview"
                  :data-localization-content="message.text ? 'user' : undefined"
                  >{{ message.text || t("chat.attachment") }}</span
                >
                <span
                  v-if="message.attachments.length"
                  class="attachment-count"
                  >{{
                    t("chat.attachmentCount", {
                      count: message.attachments.length,
                    })
                  }}</span
                >
              </template>
              <div class="pending-body">
                <p data-localization-content="user">{{ message.text }}</p>
                <span
                  v-for="attachment in message.attachments"
                  :key="attachment.id"
                  class="attachment"
                  data-localization-content="user"
                  >{{ attachment.name }}</span
                >
              </div>
            </SituateDisclosure>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>

<style scoped>
.pending {
  margin-bottom: 10px;
  border: 1px solid var(--situate-line);
  border-radius: 14px;
  background: var(--situate-paper);
  overflow: hidden;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 8px;
}
button {
  min-height: 44px;
  border: 0;
  padding: 8px;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: var(--situate-text-caption);
  color: var(--situate-muted);
}
.pending-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  text-align: start;
}
.pending-chevron {
  display: inline-block;
  font-size: 19px;
}
.pending-chevron.expanded {
  transform: rotate(90deg);
}
.edit-pending {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.pending-list {
  padding: 0 14px 12px;
}
.pending-group + .pending-group {
  margin-top: 14px;
}
h3 {
  margin: 6px 0;
  color: var(--situate-muted);
  font-size: 12px;
  font-weight: 600;
}
.pending-items {
  max-height: 180px;
  overflow: auto;
}
.pending-message {
  border-radius: 8px;
  background: var(--situate-surface);
  margin: 5px 0;
}
.pending-message > :deep(summary) {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 9px 10px;
  font-size: 13px;
}
.pending-preview {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  min-width: 0;
  flex: 1;
}
.attachment-count {
  flex: none;
  color: var(--situate-muted);
  font-size: 11px;
}
.pending-body {
  padding: 0 10px 12px;
  font-size: 13px;
}
.pending-body p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.attachment {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
  padding: 4px 8px;
  border: 1px solid var(--situate-line);
  border-radius: 6px;
}
button:focus:where(html:not([data-input-modality="pointer"]) *),
:deep(summary):focus:where(html:not([data-input-modality="pointer"]) *),
.pending-items:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
</style>
