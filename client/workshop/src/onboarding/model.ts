import { c } from "./content";
import sourceCopy from "../localization/en.import-preparation.json" with { type: "json" };
import {
  newSourceConversation,
  sourceRequest,
  reduceSourceConversation,
  type SourceConversation,
  type SourceAction,
} from "./source-conversation";
import instructionsCopy from "../localization/en.workspace-instructions.json" with { type: "json" };
import methodCopy from "../localization/en.working-method.json" with { type: "json" };
import { f, toolCards } from "./flow-content";
import { makeSampleFiles } from "./samples";
import { importCollectionFixture } from "./import-collection-fixtures";
import resultCopy from "../localization/en.import-result.json" with { type: "json" };
import {
  importedResult,
  importHandoffDuration,
  additionalImportFile,
  type ImportIntent,
} from "./import-result";
import type { EditorFile } from "../editor/model";
import {
  newFinale,
  type FinaleState,
  finaleDuration,
} from "../workspaces/setup-journey/finale/score";
import {
  newSupport,
  supportSuggestions,
  supportInputs,
  type SupportState,
  type SupportChoice,
} from "./support-plan";
export type Step = keyof typeof c.stages;
export type ImportState = keyof typeof f.importStates;
export type ToolId = keyof typeof toolCards;
export interface MethodDraft {
  capture: "inbox" | "direct";
  review: "weekly" | "daily" | "none" | "undecided";
  limit: boolean;
  journal: boolean;
  information: "projects" | "para" | "existing";
  timeBlocking?: boolean;
  pomodoro?: boolean;
  eisenhower?: boolean;
  zettelkasten?: boolean;
}
export interface OnboardingState {
  support: SupportState;
  recovery: "reopened" | "crash" | "device" | null;
  existingInstructions: string | null;
  requestedTools: ToolId[];
  finale: FinaleState;
  step: Step;
  presentation: "companion" | "plain";
  motionPaused: boolean;
  activityTimeMs: number | null;
  motionSeen: string[];
  resumeStep: Step;
  exampleActive: boolean;
  originalNote: string;
  originalTasks: boolean[];
  connected: boolean;
  connectionOutcome: "success" | "blocked";
  accessChoice: "none" | "choose" | "own" | "managed";
  method: keyof typeof c.methods;
  context: string;
  methodInfo: string | null;
  workspacePath: string;
  instructionsOpen: boolean;
  savedInstructions: string | null;
  instructionSave: "idle" | "saving" | "error";
  instructionSaveOutcome: "success" | "failure" | "wait";
  instructionExample: "standard" | "short";
  feedback: string;
  appliedFeedback: string;
  methodRequest: "proposal" | "revision" | null;
  methodOutcome: "success" | "failure" | "wait";
  methodError: boolean;
  openPoints: string[];
  revisionExample: "lighter" | "focus" | "reflect";
  approaches: string[];
  methodDraft: MethodDraft;
  methodReply: "lighter" | "focus" | "reflect" | null;
  methodConfirmed: boolean;
  source: string;
  sourceConversation: SourceConversation;
  sourceReturn: Step;
  sourceIntent: ImportIntent;
  importHandoff: FinaleState;
  importConflict: boolean;
  importBase: EditorFile[] | null;
  organization: string;
  mapping: "project" | "inbox";
  samples: EditorFile[];
  sampleKey: string;
  importFile: string | null;
  importApproved: boolean;
  imported: EditorFile[];
  importState: ImportState;
  toolDiscussion: boolean;
  toolPriority: "small" | "visual";
  toolChoices: Record<ToolId, "now" | "later">;
  planApproved: boolean;
  capacityAcknowledged: boolean;
  startedTools: ToolId[];
  developmentLinks: Partial<Record<ToolId, string>>;
  confirmed: boolean;
  manual: boolean;
  suggestionDismissed: boolean;
  editAvailable: boolean;
  hintDone: boolean;
  hintOpen: boolean;
  note: string;
  noteSaved: boolean;
  tasks: boolean[];
}
export function methodLines(s: OnboardingState): string[] {
  if (s.instructionExample === "short")
    return [instructionsCopy.document.shortPractice];
  const d = s.methodDraft;
  return [
    d.capture === "inbox" ? f.captureInbox : f.captureDirect,
    d.review === "weekly"
      ? f.reviewWeekly
      : d.review === "daily"
        ? f.reviewDaily
        : d.review === "undecided"
          ? methodCopy.reviewUndecided
          : f.reviewNone,
    d.limit ? f.limitThree : f.limitNone,
    ...(d.journal ? [f.journal] : []),
    d.information === "para"
      ? f.para
      : d.information === "existing"
        ? f.existing
        : f.projects,
    ...(d.timeBlocking ? [methodCopy.timeBlockingProposal] : []),
    ...(d.pomodoro ? [methodCopy.pomodoroProposal] : []),
    ...(d.eisenhower ? [methodCopy.eisenhowerProposal] : []),
    ...(d.zettelkasten ? [methodCopy.zettelkastenProposal] : []),
  ];
}
export function methodCombinationNotes(s: OnboardingState): string[] {
  if (s.instructionExample === "short") return [];
  const d = s.methodDraft;
  return [
    ...(Number(s.approaches.includes("gtd")) +
      Number(d.limit) +
      Number(d.journal) >
    1
      ? [methodCopy.combinedTasks]
      : []),
    ...(d.limit && d.timeBlocking ? [methodCopy.combinedSchedule] : []),
    ...(d.timeBlocking && d.pomodoro ? [methodCopy.combinedTime] : []),
    ...(d.information === "para" && d.zettelkasten
      ? [methodCopy.combinedKnowledge]
      : []),
  ];
}
export function instructionPath(s: OnboardingState): string {
  const separator = s.workspacePath.includes("\\") ? "\\" : "/";
  return (
    s.workspacePath.replace(/[\\/]+$/, "") +
    separator +
    instructionsCopy.filename
  );
}
export function instructionMarkdown(s: OnboardingState): string {
  const d = instructionsCopy.document;
  if (s.instructionExample === "short")
    return "# " + d.title + "\n\n" + d.shortPractice + "\n";
  const quote = (value: string) =>
    value
      .trim()
      .split("\n")
      .map((line) => "> " + line)
      .join("\n");
  const combinations = methodCombinationNotes(s);
  return (
    [
      "# " + d.title,
      d.purpose,
      "## " + d.rules,
      methodLines(s)
        .map((line) => "- " + line)
        .join("\n"),
      ...(combinations.length
        ? [
            "## " + d.combinations,
            combinations.map((line) => "- " + line).join("\n"),
          ]
        : []),
      ...(s.context.trim()
        ? ["## " + d.context, d.contextHelp, quote(s.context)]
        : []),
      ...(s.appliedFeedback
        ? ["## " + d.adjustment, quote(s.appliedFeedback)]
        : []),
      "## " + d.boundaries,
      d.scope,
    ].join("\n\n") + "\n"
  );
}
export const guided = (s: OnboardingState) =>
  !s.confirmed && !["home", "conversation", "note"].includes(s.step);
export const stageIndex = (s: OnboardingState) =>
  ({
    access: -1,
    method: 0,
    proposal: 0,
    sources: 1,
    "source-chat": 1,
    samples: 2,
    "import-chat": 2,
    plan: 3,
    home: -1,
    note: -1,
    conversation: -1,
  })[s.step];
export const hasImport = (s: OnboardingState) => s.importState !== "none";
export const importWorking = (s: OnboardingState) =>
  ["running", "partial"].includes(s.importState);
export const canConfirm = (s: OnboardingState) =>
  s.step === "plan" &&
  s.methodConfirmed &&
  (s.connected ||
    !s.support.proposals.some((p) => s.support.choices[p.id] === "develop"));
export const selectedTools = (s: OnboardingState) =>
  (Object.keys(toolCards) as ToolId[]).filter(
    (id) =>
      id !== "documents" &&
      s.toolChoices[id] === "now" &&
      !s.startedTools.includes(id),
  );
export const toolOrder = (s: OnboardingState): ToolId[] =>
  s.toolPriority === "visual"
    ? ["board", "review", "documents"]
    : ["review", "board", "documents"];

export function createOnboardingState(scenario = ""): OnboardingState {
  const s: OnboardingState = {
    support: newSupport(),
    recovery: null,
    existingInstructions: null,
    requestedTools: [],
    finale: newFinale(),
    step: "access",
    presentation: scenario === "onboarding-form" ? "plain" : "companion",
    motionPaused: false,
    activityTimeMs: null,
    motionSeen: [],
    resumeStep: "method",
    exampleActive: false,
    originalNote: "",
    originalTasks: [],
    connected: true,
    connectionOutcome: "success",
    accessChoice: "none",
    method: "guided",
    context: "",
    methodInfo: null,
    workspacePath: "/Example/Workspaces/Notebook 1",
    instructionsOpen: false,
    savedInstructions: null,
    instructionSave: "idle",
    instructionSaveOutcome: "success",
    instructionExample: "standard",
    feedback: "",
    appliedFeedback: "",
    methodRequest: null,
    methodOutcome: "success",
    methodError: false,
    openPoints: [],
    revisionExample: "lighter",
    approaches: [],
    methodDraft: {
      capture: "inbox",
      review: "none",
      limit: false,
      journal: false,
      information: "projects",
    },
    methodReply: null,
    methodConfirmed: false,
    source: "",
    sourceConversation: newSourceConversation(),
    sourceReturn: "sources",
    sourceIntent: "initial",
    importHandoff: newFinale(),
    importConflict: false,
    importBase: null,
    organization: "",
    mapping: "project",
    samples: [],
    sampleKey: "",
    importFile: null,
    importApproved: false,
    imported: [],
    importState: "none",
    toolDiscussion: false,
    toolPriority: "small",
    toolChoices: { board: "later", review: "later", documents: "later" },
    planApproved: false,
    capacityAcknowledged: false,
    startedTools: [],
    developmentLinks: {},
    confirmed: false,
    manual: false,
    suggestionDismissed: false,
    editAvailable: false,
    hintDone: false,
    hintOpen: false,
    note: "",
    noteSaved: false,
    tasks: [false, false],
  };
  if (
    ["onboarding-reopened", "onboarding-crash", "onboarding-device"].includes(
      scenario,
    )
  ) {
    const retained = createOnboardingState("onboarding-sources-waiting");
    retained.sourceConversation = reduceSourceConversation(
      retained.sourceConversation,
      { type: "stop" },
    );
    retained.sourceConversation.attempt++;
    retained.sourceConversation.draft = sourceCopy.recoveryDraft;
    retained.recovery =
      scenario === "onboarding-device"
        ? "device"
        : scenario === "onboarding-crash"
          ? "crash"
          : "reopened";
    if (retained.recovery === "device") {
      retained.connected = false;
      retained.resumeStep = retained.step;
      retained.step = "access";
    }
    return retained;
  }
  if (!scenario || scenario === "onboarding-form") return s;
  s.step = "method";
  if (scenario === "onboarding-method") return s;
  if (scenario === "onboarding-method-waiting") {
    s.context = methodCopy.example.description;
    s.methodRequest = "proposal";
    s.methodOutcome = "wait";
    return s;
  }
  if (scenario === "onboarding-method-info") {
    s.methodInfo = "gtd";
    return s;
  }
  if (scenario === "onboarding-method-brief") {
    s.context = methodCopy.example.description;
    return s;
  }
  s.approaches = ["gtd", "kanban", "journal"];
  s.methodDraft = {
    capture: "inbox",
    review: "weekly",
    limit: true,
    journal: true,
    information: "projects",
  };
  s.step = "proposal";
  if (scenario.startsWith("onboarding-proposal")) {
    s.context = methodCopy.example.description;
    s.openPoints = [methodCopy.example.openPoint];
    s.methodDraft.review = "undecided";
    if (scenario === "onboarding-proposal-short") {
      s.context = "";
      s.instructionExample = "short";
      s.openPoints = [];
      s.approaches = [];
      s.methodDraft = {
        capture: "direct",
        review: "none",
        limit: false,
        journal: false,
        information: "existing",
      };
    }
    if (
      ["onboarding-proposal-existing", "onboarding-proposal-conflict"].includes(
        scenario,
      )
    )
      s.existingInstructions = instructionsCopy.existingExample;
    if (scenario === "onboarding-proposal-conflict")
      s.instructionSave = "error";
    if (scenario === "onboarding-proposal-file") s.instructionsOpen = true;
    if (scenario === "onboarding-proposal-saving") {
      s.instructionSave = "saving";
      s.instructionSaveOutcome = "wait";
    }
    if (scenario === "onboarding-proposal-save-error")
      s.instructionSave = "error";
    if (
      ["onboarding-proposal-waiting", "onboarding-proposal-failed"].includes(
        scenario,
      )
    ) {
      s.feedback = methodCopy.example.feedback;
      s.methodRequest = scenario.endsWith("waiting") ? "revision" : null;
      s.methodError = scenario.endsWith("failed");
      s.methodOutcome = scenario.endsWith("waiting") ? "wait" : "success";
    }
    return s;
  }
  s.methodReply = "focus";
  s.methodConfirmed = true;
  s.organization = methodLines(s).join("\n");
  s.savedInstructions = instructionMarkdown(s);
  s.step = "sources";
  if (scenario === "onboarding-sources") return s;
  if (scenario.startsWith("onboarding-sources-")) {
    s.source =
      scenario === "onboarding-sources-apple-notes"
        ? "in Apple Notes"
        : sourceCopy.example;
    if (scenario === "onboarding-sources-apple-notes")
      s.sourceConversation.reply = "appleNotes";
    s.sourceConversation.outcome = scenario.endsWith("waiting")
      ? "wait"
      : scenario.endsWith("failed")
        ? "failure"
        : "success";
    if (scenario === "onboarding-sources-ready")
      s.sourceConversation.reply = "review";
    if (scenario === "onboarding-sources-partial")
      s.sourceConversation.reply = "partial";
    const started = reduceOnboarding(s, { type: "start-source-chat" });
    if (scenario === "onboarding-sources-ready")
      started.importHandoff.timeMs = 1600;
    return started;
  }
  if (
    ![
      "onboarding-clean",
      "onboarding-empty",
      "onboarding-manual",
      "onboarding-hint",
    ].includes(scenario)
  ) {
    s.source = f.exampleSource;
    s.samples = makeSampleFiles(s);
    s.sampleKey = s.samples[0]!.key;
  }
  s.step = "samples";
  if (scenario.startsWith("onboarding-samples")) {
    if (
      ["onboarding-samples-large", "onboarding-samples-flat"].includes(scenario)
    )
      s.samples = importCollectionFixture(s.samples, scenario.endsWith("flat"));
    s.imported = scenario.endsWith("added")
      ? [...s.samples, additionalImportFile()]
      : s.samples;
    s.importApproved = true;
    s.importState = "ready";
    if (scenario === "onboarding-samples-file")
      s.importFile = s.imported[0]!.key;
    s.sourceConversation.draft = s.source;
    s.sourceConversation.reply = "review";
    s.sourceConversation = reduceSourceConversation(s.sourceConversation, {
      type: "send",
    });
    return s;
  }
  s.step = "plan";
  if (scenario === "onboarding-clean")
    return reduceOnboarding(s, { type: "support-request" });
  s.toolDiscussion = true;
  if (scenario.startsWith("onboarding-plan")) {
    s.imported = structuredClone(s.samples);
    s.importApproved = true;
    s.importState = "ready";
    s.support.outcome = scenario.endsWith("waiting")
      ? "wait"
      : scenario.endsWith("error")
        ? "failure"
        : "success";
    s.support.example = scenario.endsWith("empty")
      ? "none"
      : scenario.endsWith("fewer")
        ? "fewer"
        : "standard";
    return reduceOnboarding(s, { type: "support-request" });
  }
  s.importApproved = s.samples.length > 0;
  s.importState = s.importApproved ? "running" : "none";
  if (scenario.startsWith("onboarding-import")) {
    s.step = "import-chat";
    if (scenario.endsWith("failed")) {
      s.importState = "failed";
      s.imported = s.samples.slice(0, 1);
    }
    return s;
  }
  if (scenario === "onboarding-provider") {
    s.step = "access";
    s.resumeStep = "plan";
    s.connected = false;
    s.connectionOutcome = "blocked";
    s.importState = "blocked";
    s.planApproved = true;
    return s;
  }
  s.step = "home";
  s.confirmed = true;
  if (scenario === "onboarding-completed") {
    s.connected = false;
    s.imported = structuredClone(s.samples);
    s.importState = "ready";
  }
  if (scenario === "onboarding-development-failed") {
    s.imported = structuredClone(s.samples);
    s.importState = "ready";
    s.support.inputs = supportInputs(s);
    s.support.proposals = supportSuggestions(s);
    s.support.phase = "ready";
    s.support.choices = { board: "develop", review: "develop" };
    s.requestedTools = ["board", "review"];
    s.startedTools = ["board", "review"];
  }
  if (scenario === "onboarding-finale") {
    s.imported = structuredClone(s.samples);
    s.importState = "ready";
    s.finale = { ...newFinale(), status: "playing", timeMs: 1700 };
  }
  if (scenario === "onboarding-arrival") {
    s.importState = "partial";
    s.imported = s.samples.slice(0, 1);
    s.startedTools = ["board"];
    s.toolChoices.board = "now";
    s.planApproved = true;
  }
  if (scenario === "onboarding-hint") {
    s.editAvailable = true;
    s.note = c.after;
  }
  if (scenario === "onboarding-manual") {
    s.manual = true;
    s.connected = false;
    s.methodConfirmed = false;
    s.confirmed = false;
    s.organization = "";
    s.savedInstructions = null;
  }
  return s;
}
export type OnboardingAction =
  | {
      type:
        | "support-request"
        | "support-reload"
        | "dismiss-recovery"
        | "use-existing-instructions";
    }
  | { type: "support-complete" | "support-fail"; attempt: number }
  | { type: "support-choice"; id: ToolId; choice: SupportChoice }
  | {
      type: "support-settings";
      saveOutcome?: SupportState["saveOutcome"];
      outcome?: SupportState["outcome"];
      example?: SupportState["example"];
    }
  | { type: "open-source-chat"; intent?: ImportIntent }
  | { type: "finish-import-handoff"; run: number }
  | { type: "import-handoff-time"; timeMs: number | null }
  | { type: "continue-import-review" }
  | { type: "view-import-file"; key: string | null }
  | { type: "source-chat"; action: SourceAction }
  | {
      type: "start-source-chat" | "close-source-chat" | "review-source";
    }
  | {
      type: "instructions-example";
      example: OnboardingState["instructionExample"];
    }
  | { type: "instructions-view"; open: boolean }
  | {
      type:
        "complete-instructions" | "fail-instructions" | "cancel-instructions";
    }
  | { type: "method-info"; id: string | null }
  | { type: "finale-time"; timeMs: number }
  | { type: "patch"; patch: Partial<OnboardingState> }
  | {
      type: "answer-method";
      answer: NonNullable<OnboardingState["methodReply"]>;
    }
  | {
      type:
        | "generate-proposal"
        | "revise-proposal"
        | "complete-method"
        | "fail-method"
        | "cancel-method"
        | "confirm-method"
        | "revise-method"
        | "map-source"
        | "prepare-samples"
        | "import"
        | "progress-import"
        | "complete-import"
        | "fail-import"
        | "resume-import"
        | "interrupt"
        | "approve-plan"
        | "start-development"
        | "defer"
        | "confirm"
        | "finale-replay"
        | "finale-pause"
        | "finale-finish"
        | "manual"
        | "retry"
        | "suggestion"
        | "remove-example"
        | "visible"
        | "dismiss-hint";
    };
function completeSourceImport(s: OnboardingState, partial = false) {
  if (partial) {
    const file = makeSampleFiles(s)[0]!;
    file.content = sourceCopy.partialFile;
    file.draft = file.content;
    if (!s.imported.length) s.imported = [file];
  } else
    s.imported = importedResult(
      s.sourceIntent,
      s.importBase ?? s.imported,
      makeSampleFiles(s),
    );
  s.samples = structuredClone(s.imported);
  s.sampleKey = s.imported[0]?.key ?? "";
  s.importApproved = true;
  s.importState = partial ? "partial" : "ready";
  s.importConflict = false;
  const response = s.sourceConversation.messages.at(-1);
  if (
    !partial &&
    response?.speaker === "assistant" &&
    s.sourceIntent !== "initial"
  )
    response.text =
      s.sourceIntent === "changes"
        ? resultCopy.revisionReply
        : resultCopy.additionalReply;
  s.importHandoff = {
    ...newFinale(),
    run: s.importHandoff.run + 1,
    status: partial || s.sourceConversation.draft.trim() ? "idle" : "playing",
  };
}

export function reduceOnboarding(
  previous: OnboardingState,
  action: OnboardingAction,
): OnboardingState {
  const s: OnboardingState = JSON.parse(JSON.stringify(previous));
  switch (action.type) {
    case "dismiss-recovery":
      s.recovery = null;
      break;
    case "use-existing-instructions":
      if (
        s.step !== "proposal" ||
        !s.connected ||
        s.existingInstructions === null
      )
        break;
      s.savedInstructions = s.existingInstructions;
      s.organization = s.existingInstructions;
      s.methodConfirmed = true;
      s.instructionSave = "idle";
      s.step = "sources";
      break;
    case "support-settings":
      if (s.confirmed) break;
      if (action.saveOutcome) s.support.saveOutcome = action.saveOutcome;
      if (action.outcome) s.support.outcome = action.outcome;
      if (action.example) s.support.example = action.example;
      return s;
    case "support-reload":
      if (s.confirmed || s.step !== "plan") break;
      s.support.phase = "idle";
      s.support.attempt++;
      s.support.proposals = [];
      s.support.choices = {};
      s.support.confirmError = null;
      return reduceOnboarding(s, { type: "support-request" });
    case "support-request":
      if (
        s.confirmed ||
        s.step !== "plan" ||
        !["idle", "error"].includes(s.support.phase)
      )
        break;
      s.support.attempt++;
      s.support.requestExample = s.support.example;
      s.support.inputs = supportInputs(s);
      s.support.phase = "working";
      if (!s.connected || s.support.outcome === "failure")
        return reduceOnboarding(s, {
          type: "support-fail",
          attempt: s.support.attempt,
        });
      if (s.support.outcome === "success")
        return reduceOnboarding(s, {
          type: "support-complete",
          attempt: s.support.attempt,
        });
      break;
    case "support-complete":
    case "support-fail":
      if (
        s.confirmed ||
        s.step !== "plan" ||
        s.support.phase !== "working" ||
        action.attempt !== s.support.attempt
      )
        break;
      s.support.phase =
        action.type === "support-complete" && s.connected ? "ready" : "error";
      s.support.proposals =
        s.support.phase === "ready" ? supportSuggestions(s) : [];
      break;
    case "support-choice":
      if (
        !s.confirmed &&
        s.support.phase === "ready" &&
        s.support.proposals.some((p) => p.id === action.id)
      ) {
        s.support.choices[action.id] = action.choice;
        s.support.confirmError = null;
      }
      break;
    case "start-source-chat":
      if (
        s.step !== "sources" ||
        !s.connected ||
        !s.methodConfirmed ||
        !s.source.trim()
      )
        break;
      if (!s.sourceConversation.messages.length) {
        s.sourceConversation.draft = sourceRequest(s.source);
        s.sourceConversation = reduceSourceConversation(s.sourceConversation, {
          type: "send",
        });
      }
      s.sourceReturn = "sources";
      s.step = "source-chat";
      if (s.sourceConversation.ready) completeSourceImport(s);
      else if (
        s.sourceConversation.reply === "partial" &&
        s.sourceConversation.phase === "complete"
      )
        completeSourceImport(s, true);
      break;
    case "open-source-chat":
      if (!s.sourceConversation.messages.length) break;
      if (s.step !== "source-chat")
        s.sourceReturn = s.confirmed ? "home" : s.step;
      if (s.sourceConversation.phase !== "working")
        s.sourceIntent = action.intent ?? s.sourceIntent;
      s.importHandoff.status = "idle";
      s.step = "source-chat";
      break;
    case "close-source-chat":
      s.importHandoff.status = "idle";
      s.step = s.confirmed ? "home" : s.sourceReturn;
      break;
    case "source-chat":
      if (
        ["send", "retry"].includes(action.action.type) &&
        (!s.connected || !["source-chat", "import-chat"].includes(s.step))
      )
        break;
      {
        const before = s.sourceConversation.messages.length;
        const wasReady = s.sourceConversation.ready;
        const attempt = s.sourceConversation.attempt;
        const reply =
          s.sourceConversation.request ?? s.sourceConversation.reply;
        s.sourceConversation = reduceSourceConversation(
          s.sourceConversation,
          action.action,
        );
        if (s.sourceConversation.attempt !== attempt)
          s.importBase = structuredClone(s.imported);
        if (
          !s.importApproved &&
          s.sourceConversation.messages.length > before &&
          action.action.type === "send"
        ) {
          s.samples = [];
          s.sampleKey = "";
        }
        if (["send", "retry", "stop"].includes(action.action.type))
          s.importHandoff.status = "idle";
        if (
          s.sourceConversation.messages.length > before &&
          reply === "partial" &&
          s.sourceConversation.phase === "complete"
        ) {
          completeSourceImport(s, true);
        }
        if (
          (!wasReady && s.sourceConversation.ready) ||
          (action.action.type === "send" &&
            s.sourceConversation.messages.length > before &&
            s.sourceConversation.ready)
        )
          completeSourceImport(s);
      }
      break;
    case "review-source":
      if (
        !["source-chat", "import-chat"].includes(s.step) ||
        !s.methodConfirmed ||
        !s.connected ||
        !s.sourceConversation.ready ||
        s.sourceConversation.phase !== "complete" ||
        s.importState !== "ready" ||
        !s.imported.length
      )
        break;
      s.importHandoff.status = "done";
      s.sampleKey = s.imported[0]!.key;
      s.step = "samples";
      break;
    case "finish-import-handoff":
      if (
        s.importHandoff.status === "playing" &&
        s.importHandoff.run === action.run &&
        !s.sourceConversation.draft.trim()
      )
        return reduceOnboarding(s, { type: "review-source" });
      break;
    case "import-handoff-time":
      if (
        s.importHandoff.status === "playing" &&
        (action.timeMs === null || Number.isFinite(action.timeMs))
      )
        s.importHandoff.timeMs =
          action.timeMs === null
            ? null
            : Math.max(0, Math.min(importHandoffDuration, action.timeMs));
      break;
    case "view-import-file":
      if (
        s.step === "samples" &&
        (action.key === null ||
          s.imported.some((file) => file.key === action.key && !file.deleted))
      )
        s.importFile = action.key;
      break;
    case "continue-import-review":
      if (
        s.step === "samples" &&
        s.importState === "ready" &&
        s.imported.length
      )
        s.step = s.confirmed ? "home" : "plan";
      break;
    case "instructions-example": {
      if (
        s.step !== "proposal" ||
        s.methodConfirmed ||
        !["standard", "short"].includes(action.example)
      )
        break;
      const example = createOnboardingState(
        action.example === "short"
          ? "onboarding-proposal-short"
          : "onboarding-proposal",
      );
      Object.assign(s, {
        instructionExample: example.instructionExample,
        methodDraft: example.methodDraft,
        openPoints: example.openPoints,
        approaches: example.approaches,
        context: example.context,
        feedback: "",
        appliedFeedback: "",
        methodReply: null,
        methodRequest: null,
        methodError: false,
        instructionSave: "idle",
        instructionsOpen: false,
      });
      break;
    }
    case "instructions-view":
      if (
        !action.open ||
        (s.step === "proposal" &&
          !s.methodRequest &&
          s.instructionSave !== "saving")
      )
        s.instructionsOpen = action.open;
      break;
    case "fail-instructions":
      if (s.instructionSave === "saving") s.instructionSave = "error";
      break;
    case "cancel-instructions":
      s.instructionSave = "idle";
      break;
    case "method-info":
      if (action.id === null) s.methodInfo = null;
      else if (
        s.step === "method" &&
        !s.methodRequest &&
        methodCopy.methods.some((method) => method.id === action.id)
      )
        s.methodInfo = action.id;
      break;
    case "finale-time":
      if (s.finale.status === "playing" && Number.isFinite(action.timeMs))
        s.finale.timeMs = Math.max(0, Math.min(finaleDuration, action.timeMs));
      break;
    case "finale-replay":
      if (s.finale.status === "playing")
        s.finale = {
          ...s.finale,
          timeMs: null,
          paused: false,
          run: s.finale.run + 1,
        };
      break;
    case "finale-pause":
      if (s.finale.status === "playing") s.finale.paused = !s.finale.paused;
      break;
    case "finale-finish":
      if (s.finale.status === "playing") {
        s.finale = { ...s.finale, status: "done", timeMs: null, paused: false };
        s.motionSeen = [...new Set([...s.motionSeen, "arrive"])];
      }
      break;
    case "patch": {
      const patch = { ...action.patch };
      for (const key of [
        "support",
        "recovery",
        "existingInstructions",
        "requestedTools",
        "methodConfirmed",
        "importApproved",
        "imported",
        "importState",
        "startedTools",
        "developmentLinks",
        "confirmed",
        "finale",
        "methodRequest",
        "methodError",
        "appliedFeedback",
        "openPoints",
        "methodInfo",
        "workspacePath",
        "instructionsOpen",
        "savedInstructions",
        "instructionSave",
        "instructionExample",
        "sourceConversation",
        "sourceReturn",
        "sourceIntent",
        "importHandoff",
        "importConflict",
        "importBase",
        "importFile",
      ] as const)
        delete patch[key];
      if (s.methodConfirmed)
        for (const key of [
          "method",
          "approaches",
          "methodDraft",
          "context",
          "feedback",
          "organization",
        ] as const)
          delete patch[key];
      if (s.sourceConversation.messages.length) delete patch.source;
      if (s.importApproved)
        for (const key of ["mapping", "samples", "source"] as const)
          delete patch[key];
      if (patch.mapping && patch.mapping !== s.mapping) {
        s.samples = [];
        s.sampleKey = "";
      }
      if (patch.toolChoices || patch.toolPriority) {
        s.planApproved = false;
        s.capacityAcknowledged = false;
      }
      if (
        [
          "context",
          "feedback",
          "approaches",
          "methodDraft",
          "method",
          "step",
        ].some((key) => {
          const field = key as keyof OnboardingState;
          return (
            field in patch &&
            JSON.stringify(patch[field]) !== JSON.stringify(s[field])
          );
        })
      ) {
        s.methodRequest = null;
        s.methodError = false;
        s.instructionSave = "idle";
      }
      if (patch.step && patch.step !== s.step) {
        s.methodInfo = null;
        s.instructionsOpen = false;
      }
      Object.assign(s, patch);
      break;
    }
    case "cancel-method":
      s.methodRequest = null;
      s.methodError = false;
      break;
    case "fail-method":
      if (s.methodRequest) {
        s.methodRequest = null;
        s.methodError = true;
      }
      break;
    case "generate-proposal":
    case "revise-proposal":
      if (
        !s.connected ||
        s.methodConfirmed ||
        s.methodRequest ||
        s.instructionSave === "saving"
      )
        break;
      s.instructionSave = "idle";
      s.instructionsOpen = false;
      if (action.type === "generate-proposal" && s.step !== "method") break;
      if (
        action.type === "revise-proposal" &&
        (s.step !== "proposal" ||
          !s.feedback.trim() ||
          s.feedback.trim() === s.appliedFeedback)
      )
        break;
      s.methodError = false;
      s.methodInfo = null;
      s.activityTimeMs = null;
      s.methodRequest =
        action.type === "generate-proposal" ? "proposal" : "revision";
      if (s.methodOutcome === "failure")
        return reduceOnboarding(s, { type: "fail-method" });
      if (s.methodOutcome === "wait") break;
      return reduceOnboarding(s, { type: "complete-method" });
    case "complete-method": {
      if (!s.connected || s.methodConfirmed || !s.methodRequest) break;
      s.instructionExample = "standard";
      const request = s.methodRequest;
      s.methodRequest = null;
      s.methodError = false;
      if (request === "revision") {
        const revised = reduceOnboarding(s, {
          type: "answer-method",
          answer: s.revisionExample,
        });
        if (s.revisionExample === "lighter" || s.revisionExample === "reflect")
          revised.openPoints = s.openPoints.filter(
            (point) => point !== methodCopy.example.openPoint,
          );
        revised.appliedFeedback = s.feedback.trim();
        return revised;
      }
      s.methodDraft = {
        capture:
          s.approaches.includes("gtd") || s.method === "guided"
            ? "inbox"
            : "direct",
        review: s.approaches.includes("gtd")
          ? "weekly"
          : s.approaches.includes("journal")
            ? "daily"
            : "none",
        limit: s.approaches.includes("kanban"),
        journal: s.approaches.includes("journal"),
        information:
          s.method === "keep"
            ? "existing"
            : s.approaches.includes("para")
              ? "para"
              : "projects",
        timeBlocking: s.approaches.includes("time-blocking"),
        pomodoro: s.approaches.includes("pomodoro"),
        eisenhower: s.approaches.includes("eisenhower"),
        zettelkasten: s.approaches.includes("zettelkasten"),
      };
      s.methodReply = null;
      s.openPoints = [];
      s.appliedFeedback = "";
      s.step = "proposal";
      break;
    }
    case "answer-method":
      if (!s.connected || s.methodConfirmed || s.instructionSave === "saving")
        break;
      s.methodReply = action.answer;
      if (action.answer === "lighter") {
        s.methodDraft.review = "none";
        s.methodDraft.limit = false;
        s.methodDraft.journal = false;
      }
      if (action.answer === "focus") s.methodDraft.limit = true;
      if (action.answer === "reflect") {
        s.methodDraft.journal = true;
        s.methodDraft.review = "daily";
      }
      break;
    case "confirm-method":
    case "complete-instructions":
      if (
        !s.connected ||
        s.step !== "proposal" ||
        s.methodConfirmed ||
        s.methodRequest ||
        s.methodError ||
        (action.type === "complete-instructions"
          ? s.instructionSave !== "saving"
          : s.instructionSave === "saving") ||
        (s.feedback.trim() && s.feedback.trim() !== s.appliedFeedback)
      )
        break;
      if (action.type === "confirm-method") {
        s.instructionsOpen = false;
        s.instructionSave = "saving";
        if (s.instructionSaveOutcome === "failure")
          return reduceOnboarding(s, { type: "fail-instructions" });
        if (s.instructionSaveOutcome === "wait") break;
      }
      if (s.existingInstructions !== null) {
        s.instructionSave = "error";
        break;
      }
      s.savedInstructions = instructionMarkdown(s);
      s.instructionSave = "idle";
      s.methodConfirmed = true;
      s.organization = [
        ...methodLines(s),
        ...methodCombinationNotes(s),
        ...(s.context.trim()
          ? [`${f.confirmedPreference}: ${s.context.trim()}`]
          : []),
        ...(s.appliedFeedback
          ? [`${methodCopy.adjustment}: ${s.appliedFeedback}`]
          : []),
      ].join("\n");
      s.step = "sources";
      s.mapping = s.methodDraft.capture === "inbox" ? "inbox" : "project";
      break;
    case "revise-method":
      if (s.importApproved) break;
      s.sourceConversation.ready = false;
      s.instructionsOpen = false;
      s.instructionSave = "idle";
      s.methodRequest = null;
      s.methodError = false;
      s.methodConfirmed = false;
      s.methodReply = null;
      s.samples = [];
      s.step = "method";
      break;
    case "map-source":
      if (
        s.connected &&
        s.methodConfirmed &&
        s.source.trim() &&
        (!s.sourceConversation.messages.length || s.sourceConversation.ready) &&
        !s.importApproved
      )
        s.step = "samples";
      break;
    case "prepare-samples":
      if (
        !s.connected ||
        !s.methodConfirmed ||
        !s.source.trim() ||
        (s.sourceConversation.messages.length > 0 &&
          !s.sourceConversation.ready) ||
        s.importApproved
      )
        break;
      s.samples = makeSampleFiles(s);
      s.sampleKey = s.samples[0]!.key;
      break;
    case "import":
      if (
        !s.connected ||
        !s.methodConfirmed ||
        !s.samples.length ||
        (s.sourceConversation.messages.length > 0 &&
          !s.sourceConversation.ready) ||
        s.importApproved
      )
        break;
      s.importApproved = true;
      s.importState = "running";
      s.step = "plan";
      break;
    case "progress-import":
    case "complete-import":
      if (!s.connected || !importWorking(s)) break;
      s.imported =
        action.type === "complete-import"
          ? s.samples
          : [
              ...new Map(
                [...s.imported, ...s.samples.slice(0, 1)].map((file) => [
                  file.key,
                  file,
                ]),
              ).values(),
            ];
      s.importState = action.type === "complete-import" ? "ready" : "partial";
      break;
    case "fail-import":
      if (importWorking(s)) s.importState = "failed";
      break;
    case "resume-import":
      if (
        s.connected &&
        s.importApproved &&
        ["failed", "blocked", "paused", "deferred"].includes(s.importState)
      )
        s.importState = s.imported.length ? "partial" : "running";
      break;
    case "interrupt":
      s.importHandoff.status = "idle";
      s.sourceConversation = reduceSourceConversation(s.sourceConversation, {
        type: "stop",
      });
      s.instructionsOpen = false;
      s.instructionSave = "idle";
      s.methodInfo = null;
      s.methodRequest = null;
      s.methodError = false;
      s.connected = false;
      s.connectionOutcome = "blocked";
      if (guided(s) && !["access", "plan"].includes(s.step)) {
        s.resumeStep = s.step;
        s.step = "access";
      }
      break;
    case "retry":
      s.connected = s.connectionOutcome === "success";
      s.accessChoice = "none";
      break;
    case "defer":
      s.importHandoff.status = "idle";
      s.sourceConversation = reduceSourceConversation(s.sourceConversation, {
        type: "stop",
      });
      if (s.importState !== "ready") s.importState = "deferred";
      if (guided(s)) s.step = "plan";
      break;
    case "approve-plan":
    case "start-development":
      break;
    case "manual":
      break;
    case "confirm":
      if (s.confirmed || s.step !== "plan") break;
      if (!canConfirm(s)) {
        if (s.methodConfirmed) s.support.confirmError = "offline";
        break;
      }
      s.support.confirmError = null;
      s.support.attempt++;
      if (s.support.phase === "working") s.support.phase = "idle";
      s.requestedTools = [
        ...new Set([
          ...s.requestedTools,
          ...s.support.proposals
            .filter((p) => s.support.choices[p.id] === "develop")
            .map((p) => p.id),
        ]),
      ];
      if (!s.confirmed && s.presentation === "companion")
        s.finale = { ...newFinale(), status: "playing" };
      s.confirmed = true;
      s.manual = false;
      s.step = "home";
      break;
    case "suggestion":
      if (!s.connected) break;
      if (!s.exampleActive) {
        s.originalNote = s.note;
        s.originalTasks = [...s.tasks];
      }
      s.exampleActive = true;
      s.tasks = [false, false];
      s.step = "conversation";
      s.editAvailable = true;
      s.note = c.after;
      break;
    case "remove-example":
      if (!s.exampleActive) break;
      s.exampleActive = false;
      s.editAvailable = false;
      s.note = s.originalNote;
      s.tasks = [...s.originalTasks];
      s.originalNote = "";
      s.originalTasks = [];
      s.step = "home";
      break;
    case "visible":
      if (s.step === "conversation" && s.editAvailable && !s.hintDone)
        s.hintOpen = true;
      break;
    case "dismiss-hint":
      s.hintDone = true;
      s.hintOpen = false;
      break;
  }
  if (s.step !== "plan" && s.support.phase === "working") {
    s.support.phase = "error";
    s.support.attempt++;
  }
  if (
    !s.confirmed &&
    s.step === "plan" &&
    s.support.phase === "idle" &&
    action.type !== "support-request"
  )
    return reduceOnboarding(s, { type: "support-request" });
  if (!s.connected && s.support.phase === "working") {
    s.support.phase = "error";
    s.support.attempt++;
  }
  if (s.step !== "samples") s.importFile = null;
  if (!s.connected) {
    if (importWorking(s)) s.importState = "blocked";
    s.sourceConversation = reduceSourceConversation(s.sourceConversation, {
      type: "stop",
    });
  }
  return s;
}
