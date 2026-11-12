import {
  activeQuestion,
  askQuestion,
  answerQuestion,
  closeQuestion,
  type QuestionResponse,
} from "../chat/question";
import copy from "../localization/en.setup-conversation.json" with { type: "json" };
import finaleCopy from "../localization/en.setup-finale.json" with { type: "json" };
import { createChatState, type ChatState, type Event } from "../chat/model";
import {
  newFinale,
  finaleDuration,
  type FinaleState,
} from "../workspaces/setup-journey/finale/score";

export const conversationSetupStates = [
  {
    id: "setup-conversation-brief",
    label: "05 · Starting details",
  },
  {
    id: "setup-conversation-fresh",
    label: "05.1 · Start without existing content",
  },
  {
    id: "setup-conversation-keep",
    label: "05.2 · Keep an existing working method",
  },
  {
    id: "setup-conversation-proposal",
    label: "05.3 · Review the working method in chat",
  },
  {
    id: "setup-conversation-import",
    label: "05.4 · Import running · guided view",
  },
  { id: "setup-conversation-app", label: "05.5 · Import running · app view" },
  { id: "setup-conversation-blocked", label: "05.6 · Source unavailable" },
  { id: "setup-conversation-partial", label: "05.7 · Partial import" },
  {
    id: "setup-conversation-support",
    label: "05.8 · Import finished · support choices",
  },
  {
    id: "setup-conversation-finale",
    label: "05.9 · Existing finale · completed setup",
  },
] as const;

export type SetupPhase = "brief" | "method" | "import" | "support" | "done";
export type ResponseOutcome =
  "success" | "question" | "blocked" | "partial" | "failure";
export interface SetupConversationState {
  phase: SetupPhase;
  view: "guided" | "app";
  entered: boolean;
  sources: string;
  fresh: boolean;
  intent: "keep" | "change" | "help";
  preferences: string;
  proposal: string;
  confirmed: boolean;
  transcript: Event[];
  draft: string;
  pending: { kind: "method" | "import"; run: number } | null;
  attempt: number;
  manual: boolean;
  outcome: ResponseOutcome;
  error: "method" | "blocked" | "partial" | null;
  stopped: boolean;
  imported: string[];
  readFile: string | null;
  importDeferred: boolean;
  build: boolean;
  developmentStarted: boolean;
  pane: "setup" | "new" | "files" | "development";
  otherChat: ChatState;
  developmentChat: ChatState;
  motionPaused: boolean;
  finale: FinaleState;
}
export type SetupConversationAction =
  | {
      type: "details";
      patch: Partial<
        Pick<
          SetupConversationState,
          "sources" | "fresh" | "intent" | "preferences"
        >
      >;
    }
  | { type: "answer"; response: QuestionResponse }
  | { type: "start" }
  | { type: "draft"; value: string }
  | { type: "send" }
  | { type: "confirm" }
  | { type: "complete"; run: number }
  | { type: "stop" }
  | { type: "retry" }
  | { type: "defer" }
  | { type: "build"; value: boolean }
  | { type: "finish" }
  | { type: "read"; path: string }
  | { type: "close-reader" }
  | { type: "open-app" }
  | { type: "guided" }
  | { type: "pane"; value: SetupConversationState["pane"] }
  | { type: "other-chat"; state: ChatState }
  | { type: "other-send" }
  | { type: "development-chat"; state: ChatState }
  | { type: "development-send" }
  | { type: "manual"; value: boolean }
  | { type: "outcome"; value: ResponseOutcome }
  | { type: "motion"; value: boolean }
  | { type: "finale-pause" }
  | { type: "finale-time"; timeMs: number }
  | { type: "finale-replay" }
  | { type: "finale-finish" };

export const importedExamples = [
  {
    path: "Garden/Planning.md",
    text: "# Garden planning\n\nBring a printed garden map.\n\n- [ ] Pack a spare pencil\n",
  },
  {
    path: "Reading/Notes.md",
    text: "# Reading notes\n\nKeep the notes from the reading evening together.\n",
  },
  {
    path: "Tasks.md",
    text: "# Tasks\n\n- [ ] Book the garden visit\n- [x] File the itinerary\n",
  },
];
function message(
  state: SetupConversationState,
  speaker: "user" | "assistant",
  text: string,
  files?: { path: string }[],
) {
  state.transcript.push({
    kind: "message",
    id: `setup-message-${state.transcript.length + 1}`,
    speaker,
    text,
    ...(files?.length ? { files } : {}),
  });
}
function begin(state: SetupConversationState, kind: "method" | "import") {
  closeQuestion(state.transcript);
  state.pending = { kind, run: ++state.attempt };
  state.error = null;
  state.stopped = false;
}
function proposal(state: SetupConversationState) {
  const base =
    state.intent === "help"
      ? copy.noSourcesProposal
      : state.intent === "keep"
        ? state.fresh
          ? copy.keepFreshProposal
          : copy.keepProposal
        : state.fresh
          ? copy.changeFreshProposal
          : copy.changeProposal;
  state.proposal =
    base +
    (state.preferences.trim()
      ? `\n\n${copy.preferencePrefix} ${state.preferences}`
      : "");
}
function support(state: SetupConversationState) {
  state.phase = "support";
  state.pending = null;
}
function askMethod(state: SetupConversationState) {
  askQuestion(state.transcript, copy.methodQuestion, [
    { id: "confirm", label: copy.confirm },
    { id: "adjust", label: copy.adjust },
  ]);
}
function askImport(state: SetupConversationState) {
  askQuestion(state.transcript, copy.importQuestion, [
    { id: "retry", label: copy.retryImport },
    { id: "defer", label: copy.withoutRest },
  ]);
}
function askSupport(state: SetupConversationState) {
  const offer =
    state.imported.length > 0 && state.intent === "keep" && !state.build;
  askQuestion(
    state.transcript,
    offer ? copy.supportQuestion : copy.finishQuestion,
    [
      ...(offer ? [{ id: "build", label: copy.build }] : []),
      { id: "finish", label: copy.finish },
      ...(state.build ? [{ id: "omit", label: copy.noBuild }] : []),
    ],
  );
}
function publishFiles(state: SetupConversationState, paths: string[]) {
  const added = paths.filter((path) => !state.imported.includes(path));
  state.imported = [...new Set([...state.imported, ...paths])];
  if (added.length)
    message(
      state,
      "assistant",
      `${added.length} ${added.length === 1 ? copy.countOne : copy.count}`,
      added.map((path) => ({ path })),
    );
}
function startDevelopment(state: SetupConversationState) {
  if (!state.build || state.developmentStarted) return;
  state.developmentStarted = true;
  state.developmentChat.transcript = [
    {
      kind: "message",
      id: "development-start",
      speaker: "assistant",
      text: copy.developmentMessage,
    },
  ];
}
function sendSecondary(chat: ChatState, response: string) {
  if (!chat.draft.trim()) return;
  chat.transcript ??= [];
  chat.transcript.push(
    {
      kind: "message",
      id: `secondary-${chat.transcript.length}`,
      speaker: "user",
      text: chat.draft,
    },
    {
      kind: "message",
      id: `secondary-${chat.transcript.length + 1}`,
      speaker: "assistant",
      text: response,
    },
  );
  chat.draft = "";
  chat.empty = false;
}
function openApp(state: SetupConversationState) {
  if (!state.confirmed || state.finale.status === "playing") return;
  state.pane = "setup";
  if (state.entered) state.view = "app";
  else
    state.finale = {
      status: "playing",
      timeMs: null,
      paused: false,
      run: state.finale.run + 1,
    };
}
export function setupConversationScreen(state: SetupConversationState): string {
  const detail = state.readFile
    ? `${copy.controls.reader} · ${state.readFile}`
    : state.finale.status === "playing"
      ? finaleCopy.controls.screen
      : state.view === "guided"
        ? copy.controls[state.phase]
        : copy.controls[
            state.pane === "setup"
              ? "app"
              : state.pane === "new"
                ? "newChat"
                : state.pane
          ];
  return `${copy.scenario} · ${detail}`;
}

export function setupStep(state: SetupConversationState): number {
  return state.phase === "brief" || state.phase === "method"
    ? 2
    : state.phase === "import"
      ? 3
      : 4;
}
export function createSetupConversation(
  id = "setup-conversation-brief",
): SetupConversationState {
  const state: SetupConversationState = {
    phase: "brief",
    view: "guided",
    entered: false,
    sources: "",
    fresh: false,
    intent: "help",
    preferences: "",
    proposal: "",
    confirmed: false,
    transcript: [],
    draft: "",
    pending: null,
    attempt: 0,
    manual: false,
    outcome: "success",
    error: null,
    stopped: false,
    imported: [],
    readFile: null,
    importDeferred: false,
    build: false,
    developmentStarted: false,
    pane: "setup",
    otherChat: createChatState("chat-empty"),
    developmentChat: createChatState("chat-existing"),
    motionPaused: false,
    finale: newFinale(),
  };
  if (id.endsWith("fresh")) state.fresh = true;
  if (!id.endsWith("brief") && !id.endsWith("fresh")) {
    state.sources =
      "Project notes in Apple Notes and my task list in Reminders.";
    state.intent = "keep";
  }
  if (id.endsWith("brief") || id.endsWith("fresh") || id.endsWith("keep"))
    return state;
  reduceSetupConversation(state, { type: "start" });
  reduceSetupConversation(state, { type: "complete", run: state.pending!.run });
  if (id.endsWith("proposal")) return state;
  reduceSetupConversation(state, { type: "confirm" });
  publishFiles(state, [importedExamples[0]!.path]);
  state.manual = true;
  if (id.endsWith("app")) {
    state.view = "app";
    state.entered = true;
  }
  if (id.endsWith("blocked")) {
    state.outcome = "blocked";
    reduceSetupConversation(state, {
      type: "complete",
      run: state.pending!.run,
    });
  }
  if (id.endsWith("partial")) {
    state.outcome = "partial";
    reduceSetupConversation(state, {
      type: "complete",
      run: state.pending!.run,
    });
  }
  if (id.endsWith("support") || id.endsWith("finale")) {
    reduceSetupConversation(state, {
      type: "complete",
      run: state.pending!.run,
    });
    if (id.endsWith("finale")) {
      reduceSetupConversation(state, { type: "finish" });
      state.finale.timeMs = 1750;
    }
  }
  return state;
}
export function reduceSetupConversation(
  state: SetupConversationState,
  action: SetupConversationAction,
): void {
  switch (action.type) {
    case "details":
      if (state.phase === "brief") Object.assign(state, action.patch);
      break;
    case "start":
      if (state.phase !== "brief" || (!state.fresh && !state.sources.trim()))
        return;
      message(
        state,
        "user",
        [
          copy.request,
          state.fresh
            ? copy.freshRequest
            : `${copy.sourceRequest}\n${state.sources}`,
          `${copy.intentRequest} ${copy[state.intent]}.`,
          ...(state.preferences.trim() ? [state.preferences] : []),
        ].join("\n\n"),
      );
      if (!state.fresh) message(state, "assistant", copy.inspect);
      state.phase = "method";
      state.proposal = "";
      begin(state, "method");
      break;
    case "answer": {
      if (state.pending || state.phase === "brief" || state.phase === "done")
        return;
      if (action.response.optionId === undefined) {
        if (
          activeQuestion(state.transcript)?.id !== action.response.questionId ||
          !action.response.text.trim()
        )
          return;
        state.draft = action.response.text;
        reduceSetupConversation(state, { type: "send" });
        return;
      }
      const answer = answerQuestion(state.transcript, action.response);
      if (!answer) return;
      if (state.phase === "method" && answer.optionId === "confirm") {
        reduceSetupConversation(state, { type: "confirm" });
        return;
      }
      message(state, "user", answer.text);
      if (state.phase === "method") {
        if (answer.optionId === "adjust")
          askQuestion(state.transcript, copy.changeQuestion);
        else {
          state.preferences = [state.preferences, answer.text]
            .filter(Boolean)
            .join("\n");
          begin(state, "method");
        }
      } else if (state.phase === "import") {
        if (answer.optionId === "retry" || answer.optionId === "defer")
          reduceSetupConversation(state, { type: answer.optionId });
      } else if (answer.optionId === "build") {
        state.build = true;
        message(state, "assistant", copy.buildSelected);
        askSupport(state);
      } else if (answer.optionId === "finish" || answer.optionId === "omit") {
        if (answer.optionId === "omit") state.build = false;
        reduceSetupConversation(state, { type: "finish" });
      }
      return;
    }
    case "draft":
      state.draft = action.value;
      break;
    case "send": {
      const text = state.draft.trim();
      if (!text || state.phase === "brief") return;
      const question = activeQuestion(state.transcript);
      if (question)
        answerQuestion(state.transcript, {
          questionId: question.id,
          text: state.draft,
        });
      message(state, "user", state.draft);
      state.draft = "";
      if (!state.confirmed) {
        state.preferences = [state.preferences, text]
          .filter(Boolean)
          .join("\n");
        begin(state, "method");
      } else if (!state.pending && state.phase === "import") {
        message(state, "assistant", copy.importReply);
        askImport(state);
      } else if (state.phase === "support") {
        state.build = false;
        message(state, "assistant", copy.supportReply);
        askSupport(state);
      } else if (!state.pending) message(state, "assistant", copy.noted);
      break;
    }
    case "complete": {
      if (!state.pending || action.run !== state.pending.run) return;
      const kind = state.pending.kind;
      const outcome = state.outcome;
      state.outcome = "success";
      state.pending = null;
      if (outcome === "failure") {
        state.error = kind === "method" ? "method" : "partial";
        message(
          state,
          "assistant",
          kind === "method" ? copy.preparationFailed : copy.error,
        );
        if (kind === "import") askImport(state);
      } else if (kind === "method") {
        if (state.fresh && state.intent === "keep" && !state.preferences.trim())
          askQuestion(state.transcript, copy.existingMethodQuestion);
        else if (outcome === "question")
          askQuestion(
            state.transcript,
            state.fresh ? copy.freshQuestion : copy.question,
            state.fresh
              ? [
                  { id: "together", label: copy.togetherAnswer },
                  { id: "separate", label: copy.separateAnswer },
                ]
              : [
                  { id: "folders", label: copy.folderAnswer },
                  { id: "tasks", label: copy.taskAnswer },
                  { id: "routines", label: copy.routineAnswer },
                ],
          );
        else {
          if (!state.fresh && !state.proposal)
            message(state, "assistant", copy.sourceObservation);
          proposal(state);
          message(
            state,
            "assistant",
            `${copy.proposalMessage}\n\n${state.proposal}`,
          );
          askMethod(state);
        }
      } else if (outcome === "blocked" || outcome === "partial") {
        state.error = outcome;
        if (outcome === "partial" && !state.imported.length)
          publishFiles(state, [importedExamples[0]!.path]);
        message(
          state,
          "assistant",
          outcome === "blocked" ? copy.sourceBlocked : copy.partial,
        );
        askImport(state);
      } else {
        publishFiles(
          state,
          importedExamples.map((file) => file.path),
        );
        support(state);
        message(state, "assistant", copy.importReady);
        askSupport(state);
      }
      break;
    }
    case "confirm": {
      if (
        state.phase !== "method" ||
        !state.proposal ||
        state.pending ||
        state.error ||
        state.stopped ||
        state.confirmed
      )
        return;
      const review = activeQuestion(state.transcript);
      if (review && !review.options.some((option) => option.id === "confirm"))
        return;
      if (review)
        answerQuestion(state.transcript, {
          questionId: review.id,
          optionId: "confirm",
        });
      state.confirmed = true;
      message(state, "user", copy.confirm);
      if (state.fresh) {
        support(state);
        message(state, "assistant", copy.emptyReady);
        askSupport(state);
      } else {
        state.phase = "import";
        begin(state, "import");
        message(state, "assistant", copy.agreed);
      }
      break;
    }
    case "stop":
      if (state.pending) {
        state.pending = null;
        state.stopped = true;
        if (state.phase === "import") askImport(state);
      }
      break;
    case "retry":
      if (state.pending || state.phase === "brief") return;
      state.outcome = "success";
      begin(state, state.confirmed ? "import" : "method");
      break;
    case "defer":
      if (state.phase !== "import") return;
      state.pending = null;
      state.error = null;
      state.stopped = false;
      state.importDeferred = true;
      support(state);
      message(state, "assistant", copy.importDeferred);
      askSupport(state);
      break;
    case "build":
      if (state.phase === "support") state.build = action.value;
      break;
    case "finish":
      if (state.phase !== "support" || state.pending) return;
      closeQuestion(state.transcript);
      state.phase = "done";
      message(state, "assistant", copy.finished);
      if (state.view === "guided") openApp(state);
      else startDevelopment(state);
      break;
    case "read":
      if (state.imported.includes(action.path)) state.readFile = action.path;
      break;
    case "close-reader":
      state.readFile = null;
      break;
    case "open-app":
      openApp(state);
      break;
    case "guided":
      if (state.finale.status !== "playing") {
        state.view = "guided";
        state.pane = "setup";
      }
      break;
    case "pane":
      if (state.view === "app") state.pane = action.value;
      break;
    case "other-chat":
      state.otherChat = action.state;
      break;
    case "other-send":
      sendSecondary(state.otherChat, copy.newChatResponse);
      break;
    case "development-chat":
      state.developmentChat = action.state;
      break;
    case "development-send":
      sendSecondary(state.developmentChat, copy.developmentResponse);
      break;
    case "manual":
      state.manual = action.value;
      break;
    case "outcome":
      state.outcome = action.value;
      break;
    case "motion":
      state.motionPaused = action.value;
      break;
    case "finale-pause":
      state.finale.paused = !state.finale.paused;
      break;
    case "finale-time":
      state.finale.timeMs = Math.max(
        0,
        Math.min(finaleDuration, action.timeMs),
      );
      break;
    case "finale-replay":
      state.finale = {
        ...state.finale,
        status: "playing",
        timeMs: null,
        paused: false,
        run: state.finale.run + 1,
      };
      break;
    case "finale-finish":
      if (state.finale.status !== "playing") return;
      state.finale.status = "done";
      state.view = "app";
      state.entered = true;
      if (state.phase === "done") startDevelopment(state);
      break;
  }
}
