<script setup lang="ts">
import { useId, useTemplateRef } from "vue";
import { SituateIconButton } from "../ui";
import ChatPaneHeader from "./ChatPaneHeader.vue";
import bend from "../brand/bend/svg/wave-welcome.svg";
import ChatComposer from "./ChatComposer.vue";

defineProps<{ navigationId: string; navigationOpen: boolean }>();
defineEmits<{ openNavigation: [event: MouseEvent] }>();

const titleId = useId();
const header = useTemplateRef<InstanceType<typeof ChatPaneHeader>>("header");
defineExpose({ focusTitle: () => header.value?.focusTitle() });
</script>

<template>
  <main class="chat-pane" :aria-labelledby="titleId">
    <ChatPaneHeader ref="header" title="New chat" :title-id="titleId">
      <template #navigation>
        <SituateIconButton
          class="open-navigation"
          icon="menu"
          label="Open navigation"
          aria-haspopup="dialog"
          :aria-controls="navigationId"
          :aria-expanded="navigationOpen"
          @click="$emit('openNavigation', $event)"
        />
      </template>
      <SituateIconButton icon="split" label="Split pane" disabled />
      <SituateIconButton icon="close" label="Close pane" disabled />
    </ChatPaneHeader>
    <div class="empty-chat">
      <div class="welcome">
        <div class="greeting">
          <img
            class="welcome-bend"
            :src="bend"
            width="128"
            height="128"
            alt=""
          />
          <h2>Good to see you.</h2>
        </div>
        <ChatComposer />
      </div>
    </div>
  </main>
</template>

<style scoped>
.chat-pane {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--situate-surface);
}
.open-navigation {
  display: none;
}
.empty-chat {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 38px;
}
.welcome {
  width: 100%;
  max-width: 640px;
  flex: 0 0 auto;
  margin: auto;
  padding-bottom: 56px;
}
.greeting {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}
.welcome-bend {
  display: block;
  width: 128px;
  height: 128px;
}
h2 {
  margin: 0;
  font-family: var(--situate-font-display);
  font-size: 37px;
  font-weight: 600;
  line-height: var(--situate-leading-heading);
  letter-spacing: -0.05em;
  overflow-wrap: anywhere;
}
@media not all and (min-width: 1184px) {
  .open-navigation {
    display: inline-grid;
  }
  :deep(.chat-icon) {
    display: none;
  }
  .pane-header {
    background: var(--situate-paper);
  }
  .welcome {
    padding-bottom: 0;
  }
}
@container (max-width: 520px) {
  .empty-chat {
    padding: 24px;
  }
  h2 {
    font-size: 32px;
  }
}
@container (max-width: 359px) {
  .empty-chat {
    padding: 20px;
  }
}
@media (max-height: 480px) {
  .empty-chat {
    padding-block: 12px;
  }
  .welcome-bend {
    display: none;
  }
  .welcome {
    padding-bottom: 0;
  }
  h2 {
    font-size: 26px;
  }
}
</style>
