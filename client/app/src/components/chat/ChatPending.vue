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
            role="region"
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
  margin-bottom: var(--situate-space-2-5);
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-panel-compact);
  background: var(--situate-paper);
  overflow: hidden;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--situate-space-2);
  padding: var(--situate-space-0-5) var(--situate-space-2);
}
button {
  min-height: 44px;
  border: 0;
  padding: var(--situate-space-2);
  border-radius: var(--situate-radius-small);
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
  padding: 0 var(--situate-space-3-5) var(--situate-space-3);
}
.pending-group + .pending-group {
  margin-top: var(--situate-space-3-5);
}
h3 {
  margin: var(--situate-space-1-5) 0;
  color: var(--situate-muted);
  font-size: var(--situate-text-label);
  font-weight: 600;
}
.pending-items {
  max-height: 180px;
  overflow: auto;
}
.pending-message {
  border-radius: var(--situate-radius-small);
  background: var(--situate-surface);
  margin: 5px 0;
}
.pending-message > :deep(summary) {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--situate-space-2-5);
  min-height: 44px;
  padding: 9px var(--situate-space-2-5);
  font-size: var(--situate-text-caption);
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
  font-size: var(--situate-text-fine);
}
.pending-body {
  padding: 0 var(--situate-space-2-5) var(--situate-space-3);
  font-size: var(--situate-text-caption);
}
.pending-body p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.attachment {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
  padding: var(--situate-space-1) var(--situate-space-2);
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-tight);
  background: var(--situate-content-wash, var(--situate-paper));
}
button:focus:where(html:not([data-input-modality="pointer"]) *),
:deep(summary):focus:where(html:not([data-input-modality="pointer"]) *),
.pending-items:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
</style>
