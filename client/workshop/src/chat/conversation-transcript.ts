import type { Event, Phase } from "./model";
import type { WorkHistoryState } from "./work-history";

export interface ConversationBlock {
  id: string;
  events: Event[];
  phase: Phase;
  history: WorkHistoryState;
}
export function conversationBlocks(
  events: Event[],
  phase: Phase,
  milliseconds?: number,
): ConversationBlock[] {
  const blocks: ConversationBlock[] = [];
  let pending: Event[] = [];
  for (const event of events) {
    if (event.kind === "message" && event.workDuration) {
      const { workDuration, ...message } = event;
      pending.push(message);
      blocks.push({
        id: pending[0].id,
        events: pending,
        phase: workDuration.outcome,
        history: { example: "mixed", milliseconds: workDuration.milliseconds },
      });
      pending = [];
    } else pending.push(event);
  }
  if (pending.length)
    blocks.push({
      id: pending[0].id,
      events: pending,
      phase,
      history: { example: "mixed", milliseconds: milliseconds ?? NaN },
    });
  return blocks;
}
