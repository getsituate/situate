<script setup lang="ts">
import { SituateSelect, SituateButton } from "../ui";
import type { QueueAction, QueuePhase, QueueState } from "./model";
defineProps<{ state: QueueState }>();
const emit = defineEmits<{ action: [action: QueueAction] }>();
</script>
<template>
  <p>
    Queue proposal for one conversation. Synthetic messages and attachment
    references only; no AI or file access. Other conversations remain outside
    this study.
  </p>
  <label for="queue-phase">Task state</label>
  <SituateSelect
    id="queue-phase"
    :value="state.phase"
    @change="
      emit('action', {
        type: 'phase',
        phase: ($event.target as HTMLSelectElement).value as QueuePhase,
      })
    "
  >
    <option value="working">Working</option>
    <option value="compacting">Compacting</option>
    <option value="stopped">Stopped</option>
    <option value="complete">Complete</option>
  </SituateSelect>
  <SituateButton
    variant="secondary"
    size="small"
    type="button"
    :disabled="
      state.phase !== 'working' ||
      !state.pending.some((item) => item.kind === 'steering')
    "
    @click="emit('action', { type: 'consume' })"
  >
    Consume next steering
  </SituateButton>
  <SituateButton
    variant="secondary"
    size="small"
    type="button"
    :disabled="state.phase !== 'working'"
    @click="emit('action', { type: 'finish' })"
  >
    Finish current task
  </SituateButton>
  <p>
    Finishing first handles any pending steering. Once none remains, the next
    follow-up starts a new turn. Compacting accepts messages but does not
    consume them. Stop returns all still-pending messages to the composer:
    steering, then follow-up, then the existing draft, separated by blank lines.
    Attachment references are preserved, both queues are cleared, and nothing is
    resubmitted. “Edit all pending” performs the same restoration without
    stopping work.
  </p>
  <p>
    Alt+Up or “Edit all pending” returns pending messages to the composer
    without stopping work or sending anything. Plain Up moves the cursor as
    usual. Consumed messages cannot be restored.
  </p>
  <p>
    Compare the grouped pending list with a chronological list during review:
    can readers predict when each message will be received? This study groups by
    delivery timing and keeps one “Edit all pending” action. Model and thinking
    selection are outside this study. Phone geometry does not validate
    touch-only follow-up entry; no extra send-mode control is proposed.
  </p>
</template>
