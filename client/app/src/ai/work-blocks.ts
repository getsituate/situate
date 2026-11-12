import type { RuntimeEvent } from "./queue-runtime";

export interface ActiveWorkBlock {
  id: string;
  startMessageCount: number;
  startedAt: number;
}

export interface WorkBlock {
  id: string;
  messageCount: number;
  startMessageCount?: number;
  durationMs?: number;
  outcome: "complete" | "cancelled" | "error" | "interrupted";
}

export function workBlocks(
  events: RuntimeEvent[],
  retainedMessageCount?: number,
): WorkBlock[] {
  const ended = new Map<string, WorkBlock>();
  const starts = new Map<RuntimeEvent, number>();
  const key = (event: RuntimeEvent, id: string) =>
    JSON.stringify([event.runId, id]);
  for (const event of events) {
    if (!event.data || typeof event.data !== "object") continue;
    const data = event.data as Record<string, unknown>;
    if (
      event.type === "work_block_start" &&
      typeof data.workId === "string" &&
      data.workId &&
      Number.isSafeInteger(data.startMessageCount) &&
      (data.startMessageCount as number) >= 0
    )
      starts.set(event, data.startMessageCount as number);
    if (event.type !== "work_block_end") continue;
    if (
      !Number.isSafeInteger(data.messageCount) ||
      (data.messageCount as number) < 0 ||
      typeof data.durationMs !== "number" ||
      !Number.isFinite(data.durationMs) ||
      data.durationMs < 0 ||
      !["complete", "cancelled", "error"].includes(data.outcome as string)
    )
      continue;
    const id =
      typeof data.workId === "string" && data.workId ? data.workId : event.id;
    ended.set(key(event, id), {
      id,
      messageCount: data.messageCount as number,
      ...(Number.isSafeInteger(data.startMessageCount) &&
      (data.startMessageCount as number) >= 0 &&
      (data.startMessageCount as number) <= (data.messageCount as number)
        ? { startMessageCount: data.startMessageCount as number }
        : {}),
      durationMs: data.durationMs,
      outcome: data.outcome as WorkBlock["outcome"],
    });
  }
  const interruptedEnds = new Map<RuntimeEvent, number>();
  let boundary = retainedMessageCount;
  if (Number.isSafeInteger(boundary)) {
    for (const [event, start] of [...starts].reverse()) {
      if (start > boundary!) continue;
      interruptedEnds.set(event, boundary!);
      boundary = start;
    }
  }
  const emitted = new Set<string>();
  return events.flatMap((event): WorkBlock[] => {
    if (!event.data || typeof event.data !== "object") return [];
    const data = event.data as Record<string, unknown>;
    if (event.type !== "work_block_start" && event.type !== "work_block_end")
      return [];
    const id =
      typeof data.workId === "string" && data.workId ? data.workId : event.id;
    const identity = key(event, id);
    if (emitted.has(identity)) return [];
    if (event.type === "work_block_start" && !starts.has(event)) return [];
    const completed = ended.get(identity);
    if (completed) {
      emitted.add(identity);
      return [completed];
    }
    const messageCount = interruptedEnds.get(event);
    if (messageCount === undefined) return [];
    emitted.add(identity);
    return [
      {
        id,
        startMessageCount: data.startMessageCount as number,
        messageCount,
        outcome: "interrupted",
      },
    ];
  });
}
