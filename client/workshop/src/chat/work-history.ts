import type { Call, ChatState, Event, Message, Phase } from "./model";
import { workDurationText } from "./work-time";
import en from "../localization/en.work-history.json" with { type: "json" };
import de from "../localization/de.work-history.json" with { type: "json" };

export const historyCopy = { en, de };
export const historyExamples = [
  "mixed",
  "fragments",
  "long",
  "no-reasoning",
  "unclassified",
  "changes",
  "question",
  "approval",
  "text-only",
  "plugin",
] as const;
export type HistoryExample = (typeof historyExamples)[number];
export interface WorkHistoryState {
  example: HistoryExample;
  milliseconds: number;
}
export function historyExample(scenario: string): HistoryExample {
  return (
    historyExamples.find(
      (example) => scenario === `chat-work-history-${example}`,
    ) ?? "mixed"
  );
}
export function isWorkDetail(event: Event | undefined): boolean {
  if (!event) return false;
  return (
    (event.kind === "reasoning" && !!event.text.trim()) ||
    (event.kind === "call" &&
      (!event.visible ||
        event.state === "error" ||
        event.state === "cancelled")) ||
    (event.kind === "message" &&
      event.speaker === "assistant" &&
      event.purpose === "progress" &&
      !!event.text.trim())
  );
}
export function isCollapsibleDetail(event: Event, phase: Phase): boolean {
  return (
    isWorkDetail(event) && !(phase === "working" && event.kind === "message")
  );
}
export interface HistorySegment {
  id: string;
  collapsible: boolean;
  events: Event[];
}
export function historySections(source: Event[], phase: Phase) {
  const events = source.filter((event) =>
    event.kind === "reasoning"
      ? !!event.text.trim()
      : event.kind === "message"
        ? !!(event.text.trim() || event.files?.length)
        : true,
  );
  const first = events.findIndex(isWorkDetail);
  const last = events.reduce(
    (index, event, current) => (isWorkDetail(event) ? current : index),
    -1,
  );
  if (first < 0) {
    const initialUser =
      events[0]?.kind === "message" && events[0].speaker === "user" ? 1 : 0;
    return {
      before: events.slice(0, initialUser),
      segments: [] as HistorySegment[],
      after: events.slice(initialUser),
    };
  }
  const segments: HistorySegment[] = [];
  for (const event of events.slice(first, last + 1)) {
    const collapsible = isCollapsibleDetail(event, phase);
    const previous = segments.at(-1);
    if (
      event.kind === "call" &&
      !event.visible &&
      previous?.collapsible === collapsible &&
      previous.events.every(
        (previousEvent) =>
          previousEvent.kind === "call" &&
          !previousEvent.visible &&
          previousEvent.category === event.category,
      )
    )
      previous.events.push(event);
    else segments.push({ id: event.id, collapsible, events: [event] });
  }
  return {
    before: events.slice(0, first),
    segments,
    after: events.slice(last + 1),
  };
}
export type HistoryEntry =
  | Exclude<Event, Call>
  | {
      kind: "tools";
      id: string;
      category: NonNullable<Call["category"]>;
      calls: Call[];
    };
export function historyEntries(events: Event[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const event of events) {
    if (event.kind === "call") {
      const category = event.category ?? "other";
      const previous = entries.at(-1);
      if (previous?.kind === "tools" && previous.category === category)
        previous.calls.push(event);
      else
        entries.push({ kind: "tools", id: event.id, category, calls: [event] });
    } else entries.push(event);
  }
  return entries;
}
export function historyLabel(
  history: WorkHistoryState,
  phase: Phase,
  locale: "en" | "de",
) {
  return phase === "working"
    ? historyCopy[locale].working
    : workDurationText(
        { milliseconds: history.milliseconds, outcome: phase },
        locale,
      ) || historyCopy[locale].history;
}
function captionText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/[\r\n\t]+/g, " ")
    : undefined;
}
export function historyCallLabel(
  call: Call,
  locale: "en" | "de" = "en",
): string {
  const path = captionText(call.args?.path);
  if (
    ["read", "read_revision", "write", "edit", "ls"].includes(call.tool) &&
    path
  )
    return path;
  if (call.tool === "find" || call.tool === "grep") {
    const query = captionText(call.args?.query);
    if (query) return path ? `${query} · ${path}` : query;
    if (path) return path;
  }
  return call.tool || historyCopy[locale].toolAttemptOne;
}
export function historyToolLabel(
  calls: Call[],
  category: NonNullable<Call["category"]>,
  locale: "en" | "de",
) {
  const c = historyCopy[locale];
  if (category === "read" && calls.every((call) => call.state === "complete")) {
    const paths = calls.map((call) => captionText(call.args?.path));
    if (paths.every((path) => path !== undefined)) {
      const count = new Set(paths).size;
      return (count === 1 ? c.readOne : c.readMany).replace(
        "{count}",
        String(count),
      );
    }
    return (calls.length === 1 ? c.readAttemptOne : c.readAttemptMany).replace(
      "{count}",
      String(calls.length),
    );
  }
  if (calls.some((call) => call.state !== "complete")) {
    return (
      category === "read"
        ? calls.length === 1
          ? c.readAttemptOne
          : c.readAttemptMany
        : category === "search"
          ? calls.length === 1
            ? c.searchAttemptOne
            : c.searchAttemptMany
          : calls.length === 1
            ? c.toolAttemptOne
            : c.toolAttemptMany
    ).replace("{count}", String(calls.length));
  }
  return (
    category === "read"
      ? calls.length === 1
        ? c.readOne
        : c.readMany
      : category === "search"
        ? calls.length === 1
          ? c.searchOne
          : c.searchMany
        : calls.length === 1
          ? c.toolsOne
          : c.toolsMany
  ).replace("{count}", String(calls.length));
}
const progress = (id: string, text: string): Message => ({
  kind: "message",
  id,
  speaker: "assistant",
  purpose: "progress",
  text,
});
const thought = (id: string, text: string, status: Phase): Event => ({
  kind: "reasoning",
  id,
  text,
  status,
});
const read = (id: string, path: string, result: string): Call => ({
  kind: "call",
  id,
  tool: "read",
  category: "read",
  label: "read",
  args: { path },
  input: JSON.stringify({ path }, null, 2),
  result,
  state: "complete",
  visible: false,
});
export function historyFixture(
  example: HistoryExample,
  phase: Phase,
  locale: "en" | "de" = "en",
): Event[] {
  const transcript: Event[] = [
    {
      kind: "message",
      id: "history-request",
      speaker: "user",
      text: "Make a short plan for our reading evening. Keep time for conversation and start at 7 pm.",
    },
  ];
  if (example === "text-only") {
    if (phase === "complete")
      transcript.push({
        kind: "message",
        id: "history-answer",
        speaker: "assistant",
        answer: true,
        text: "Start at **7 pm**, share a favourite passage, then leave the rest of the evening for conversation.",
      });
    return transcript;
  }
  if (example !== "no-reasoning")
    transcript.push(
      thought(
        "history-thought-first",
        example === "fragments"
          ? "Keep the plan light."
          : example === "long"
            ? "### Preserve the open conversation\nThe start time changes, not the character of the evening. I should keep **room for conversation**.\n\n- Check the previous plan.\n- Keep the selected chapters: *1–4*.\n- Start at **7 pm**.\n\n> Leave time for conversation.\n\nThe note `Reading evening.md` can hold a short schedule. Sending invitations is a separate action."
            : "The previous plan may contain a different start time. I should check it before proposing a schedule.",
        phase,
      ),
    );
  transcript.push(
    progress(
      "history-progress-first",
      "I’ll check the previous plan and the selected book, then put together a short schedule.",
    ),
  );
  transcript.push({
    kind: "call",
    id: "history-search",
    tool: example === "plugin" ? "books.search" : "grep",
    category: "search",
    ...(example === "plugin" ? { pluginName: "Book shelf" } : {}),
    label: example === "plugin" ? "books.search" : "grep",
    args:
      example === "plugin"
        ? { collection: "Book shortlist", selection: "next meeting" }
        : { query: "reading evening" },
    input: JSON.stringify(
      example === "plugin"
        ? { collection: "Book shortlist", selection: "next meeting" }
        : { query: "reading evening" },
      null,
      2,
    ),
    result:
      example === "plugin"
        ? "The Lantern Orchard — chapters 1–4"
        : "Reading evenings.md: Start at 18:30.\nReading notes.md: The Lantern Orchard — chapters 1–4.",
    visible: false,
    state: "complete",
  });
  if (example !== "no-reasoning")
    transcript.push(
      thought(
        "history-thought-next",
        example === "fragments"
          ? "Chapters 1–4. Check the time."
          : "The selected chapters are **1–4**. I’ll compare the previous start time with the requested **7 pm**.",
        phase,
      ),
    );
  transcript.push(
    read(
      "history-read-plan",
      "Reading evenings.md",
      "Start at 18:30. Share passages, then leave time for conversation.",
    ),
    read(
      "history-read-notes",
      "Reading notes.md",
      "Keep the introduction brief. Leave the rest of the evening open.",
    ),
  );
  if (example === "unclassified")
    transcript.push({
      kind: "message",
      id: "history-unclassified",
      speaker: "assistant",
      text: "The previous note says 6:30 pm. That differs from the 7 pm start you requested.",
    });
  if (example === "changes")
    transcript.push({
      kind: "call",
      id: "history-visible-change",
      tool: "edit",
      label: "Updated",
      visible: true,
      file: "Reading evening.md",
      input: "path: Reading evening.md\nstart: 19:00",
      result: "Start time updated.",
      before: "18:30 — Arrive and settle in.",
      after: "19:00 — Arrive and settle in.",
      state: "complete",
    });
  if (example !== "no-reasoning")
    transcript.push(
      thought(
        "history-thought-last",
        example === "fragments"
          ? "Half an hour later. Keep the rest open."
          : example === "long"
            ? "### Check the timing\nA five-minute introduction and twenty minutes of shared passages leave the rest of the evening open.\n\n1. Arrive at 7 pm.\n2. Share favourite passages.\n3. Leave time for conversation.\n\n```text\n19:00  Arrive and settle in\n19:05  Share favourite passages\n19:25  Open conversation\n```\n\nNo invitation needs to be sent to prepare this plan."
            : "A **five-minute introduction** and **twenty minutes of passages** leave the rest of the evening open.",
        phase,
      ),
    );
  transcript.push(
    progress(
      "history-progress-last",
      "The old start time was 6:30 pm. I’m moving the proposed schedule to 7 pm and keeping the rest of the evening open.",
    ),
  );
  if (phase === "error") {
    const call = transcript.find(
      (event) => event.id === "history-read-plan",
    ) as Call;
    call.state = "error";
    call.result = "The previous plan could not be read.";
    transcript.splice(transcript.indexOf(call) + 1);
  }
  if (phase === "complete") {
    if (example === "question" || example === "approval") {
      const c = historyCopy[locale];
      transcript.push({
        kind: "question",
        id: example === "approval" ? "history-approval" : "history-question",
        status: "pending",
        text: example === "approval" ? c.approvalText : c.questionText,
        options:
          example === "approval"
            ? [
                { id: "send", label: c.send },
                { id: "draft", label: c.keepDraft },
              ]
            : [
                { id: "new", label: c.newNote },
                { id: "previous", label: c.previousNote },
              ],
      });
    } else
      transcript.push({
        kind: "message",
        id: "history-answer",
        speaker: "assistant",
        answer: true,
        text: "Here’s a light plan for your reading evening:\n\n- **7:00 pm** — Arrive and settle in.\n- **7:05 pm** — Share favourite passages from chapters 1–4.\n- **7:25 pm onwards** — Open conversation.\n\nThe start is half an hour later than last time. No invitations have been sent.",
      });
  }
  return transcript;
}
export function historyTransition(state: ChatState, phase: Phase): Event[] {
  if (
    state.phase === "working" &&
    state.transcript &&
    (phase === "error" || phase === "cancelled")
  ) {
    const retained = state.transcript.map((event) =>
      event.kind === "reasoning" ? { ...event, status: phase } : event,
    );
    if (phase === "error")
      retained.push({
        ...read(
          "history-check-failed",
          "Reading evening.md",
          "The final plan could not be read.",
        ),
        state: "error",
      });
    return retained;
  }
  const events = historyFixture(
    state.workHistory!.example,
    phase,
    state.composerLocale,
  );
  for (const event of events) {
    const previous = state.transcript?.find(
      (previous) => previous.id === event.id && previous.kind === "reasoning",
    );
    if (event.kind === "reasoning" && previous?.kind === "reasoning")
      event.text = previous.text;
  }
  return events;
}
export function setHistoryExample(
  state: ChatState,
  example: HistoryExample,
): ChatState {
  return {
    ...state,
    workHistory: { example, milliseconds: 103000 },
    workClockStartedAt: undefined,
    draft: "",
    transcript: historyFixture(example, state.phase, state.composerLocale),
  };
}
export function advanceHistory(state: ChatState): ChatState {
  if (!state.workHistory || state.phase !== "working") return state;
  return {
    ...state,
    workHistory: {
      ...state.workHistory,
      milliseconds: state.workHistory.milliseconds + 15000,
    },
  };
}
export function continueHistory(state: ChatState): ChatState {
  if (!state.workHistory || state.phase !== "working") return state;
  const lastThought = state.transcript
    ?.slice()
    .reverse()
    .find((event) => event.kind === "reasoning");
  return {
    ...advanceHistory(state),
    transcript:
      state.transcript?.map((event) =>
        event === lastThought && event.kind === "reasoning"
          ? {
              ...event,
              text:
                event.text +
                "\n\n**Timing check:** the open conversation can begin at 7:25 pm.",
            }
          : event,
      ) ?? null,
  };
}
