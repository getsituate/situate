import instructionsCopy from "../localization/en.workspace-instructions.json" with { type: "json" };
import methodCopy from "../localization/en.working-method.json" with { type: "json" };
export const f = {
  methodIntro:
    "Start with the way you want to work. Choose practices to explore, keep your approach, or describe your own.",
  interests: "Which methods interest you?",
  interestHelp:
    "These are interests, not commitments to adopt a whole system. You can combine parts.",
  methodDetails: "Practice, effort and limits",
  preference: "Anything to retain or avoid? (optional)",
  preferencePlaceholder:
    "Keep my weekly project notes. Avoid maintaining the same task twice.",
  generate: "Suggest a working method",
  proposalIntro:
    "Here is a starting point, not a final decision. What would make it fit better?",
  proposal: "Your proposed working method",
  agent: "Situate",
  you: "You",
  lighter: "Make it lighter",
  focus: "Limit work in progress",
  reflect: "Add daily reflection",
  lighterReply:
    "I removed the scheduled review and active-work limit. Keep one capture list and choose a next action when you need it. This borrows practices; it is not the complete GTD or Personal Kanban method.",
  focusReply:
    "I added a limit of three active tasks. New tasks wait until you make room. The board would show the same tasks, not a second task list; building that view is a separate choice later.",
  reflectReply:
    "I added a short daily reflection. Open tasks stay in their original list and are referenced, not copied into each day's log. This is a digital adaptation of Bullet Journal practices, not the full notebook method.",
  confirmMethod: methodCopy.confirm,
  reviseMethod: "Revisit my method",
  methodAgreed: instructionsCopy.saved,
  agreedDetail: instructionsCopy.savedDetail,
  captureInbox:
    "Capture new commitments in one inbox; clarify the next action before organizing them.",
  captureDirect:
    "Keep tasks in their project lists; add a next action where you need one.",
  reviewWeekly:
    "Review projects, next actions and waiting items weekly; keep those lists current.",
  reviewDaily:
    "Reflect briefly each day and deliberately keep, defer or drop open commitments.",
  reviewNone:
    "No scheduled review. Decide when to revisit your lists; reminders are not implied.",
  limitThree:
    "Keep at most three tasks active. A future board can visualize the same tasks without duplicating them.",
  limitNone:
    "No fixed active-work limit; choose what to take on from the current task list.",
  journal:
    "Keep a daily note for observations and reflection, with references to existing tasks rather than copied checkboxes.",
  para: "File supporting information under Projects, Areas, Resources and Archive; move it when its purpose changes.",
  projects: "Keep each project's notes together with a single task list.",
  existing:
    "Retain your existing project names and task lists; agree any mapping changes before import.",
  proposalHint:
    "Adjust the proposal if needed. Your preference stays alongside it.",
  confirmedPreference: "Your preference",
  sourcesIntro:
    "Where do the notes and tasks you want to bring live? We will map them to your agreed method before copying anything.",
  exampleSource: "Notes export and task list",
  sourceOptional: "Source description",
  inspectSource: "Discuss the mapping",
  clean: "Start with an empty workspace",
  defer: "Leave this source for later",
  sourceDetail:
    "The source stays unchanged. Preparing a mapping and importing use AI capacity. You will inspect sample files before the full import starts.",
  mappingIntro:
    "The reading-corner note and its loose tasks belong together. Should those tasks stay in the capture inbox or go straight into the project's task list?",
  projectTasks: "Put related tasks in the project",
  inboxTasks: "Keep loose tasks in the inbox",
  projectReply:
    "The project keeps its note and one task file together. The note points to that task file; it does not repeat the checkboxes.",
  inboxReply:
    "The project note stays in place. Loose tasks go to one inbox task file with their project context, ready for clarification. They are not also copied into the project.",
  mappingQuestion: "Where should these loose tasks go?",
  preview: "Inspect sample files",
  previewTitle: "Sample files",
  approvedPreview: "Approved examples",
  previewDetail:
    "These examples show the contents and paths the import will use. They are not your completed import.",
  reviseMapping: "Revise the mapping",
  confirmImport: "Confirm structure and start import",
  importConsent:
    "This confirms the displayed structure and starts the full import using AI capacity. Other workspace files and source files stay unchanged. You can continue while it runs.",
  noSamples: "Prepare sample files to inspect the proposed mapping.",
  read: "Read sample",
  reader: "File contents",
  filePath: "Path",
  importTitle: "Import notes and tasks",
  importConversation: "Open import conversation",
  approvedStructure: "Structure approved for this import",
  importContinue: "Continue to support tools",
  retryImport: "Resume the approved import",
  importScope:
    "The import keeps the approved structure. Available files stay available if work is interrupted; resuming adds the remaining files without duplicating them.",
  execution:
    "Work may stop when the workspace closes, the app quits or the operating system suspends it. Return here to check its status.",
  capacity:
    "Import and development share your provider's finite capacity. Start less work or postpone it if access is limited. No completion time is known.",
  toolOffer:
    "Would you like tools to support this method? We can plan them without starting any development.",
  planTools: "Plan support tools",
  skipTools: "Skip and enter workspace",
  toolQuestion: "What should come first?",
  smallPlan: "Keep the first step small",
  visualPlan: "Prioritize a visual work board",
  smallReply:
    "Start with a review view for your existing tasks. Keep the board and document connections for later unless you choose otherwise.",
  visualReply:
    "Put the task board first. It will use your existing task records; keep the review view and document connections in the plan for later.",
  pluginPlan: "Support plan",
  now: "Develop now",
  later: "Keep for later",
  approvePlan: "Save this plan",
  planSaved: "Plan saved. Saving does not start additional development.",
  selectedWork: "Work selected to start",
  noSelectedWork:
    "Everything is saved for later. You can enter your workspace now.",
  startedWorkSummary:
    "Development has started for your selected tools. Remaining items are saved for later. You can enter your workspace now.",
  capacityAck: "Use AI capacity for the selected work",
  startSelected: "Start selected development",
  startDetail:
    "Only the items selected below will start. They share capacity with any import. You can follow each development conversation and change its direction.",
  started: "Development started",
  enter: "Enter workspace",
  plans: "Review saved support plan",
  retained: "Saved for later",
  available: "Available imported files",
  pendingEmpty:
    "No imported files are available yet. The import is still in progress, not an empty source. You can write a local note now.",
  partial:
    "Some imported content is available. More is still pending; this is not the complete collection.",
  failedEmpty:
    "No imported files are available yet. The import needs attention; your source has not been changed.",
  deferredEmpty:
    "This source has been left for later. No imported content is available yet.",
  backHome: "Back to workspace",
  continueSetup: "Continue setup",
  importStates: {
    none: "No import started",
    running: "Import in progress · no files available yet",
    partial: "Import in progress · some files available",
    failed: "Import interrupted · needs attention",
    blocked: "Import paused · AI access needs attention",
    paused: "Import paused · resume when ready",
    ready: "Import complete",
    deferred: "Source left for later",
  },
  availableCount: (n: number) =>
    `${n} imported ${n === 1 ? "file" : "files"} available`,
  recovery:
    "Your method, approved structure and support plan are still here. Repair or change access before resuming AI work.",
} as const;

export const methodCards = [
  {
    id: "gtd",
    title: "GTD",
    subtitle: "Get commitments out of your head and clarify the next action.",
    detail:
      "Capture, clarify, organize, review and engage. Keep projects and waiting items current through regular reviews. Capturing alone is not the full method, and GTD does not choose your priorities for you.",
  },
  {
    id: "kanban",
    title: "Personal Kanban",
    subtitle: "See your work and limit how much is active at once.",
    detail:
      "Make work visible and limit work in progress. Keep cards current and notice blocked work. A board alone does not provide deadline reminders or track every waiting commitment.",
  },
  {
    id: "journal",
    title: "Bullet Journal",
    subtitle: "Bring daily capture, planning and reflection together.",
    detail:
      "Use short task, event and note entries, with an index and future, monthly and daily logs. Review and deliberately migrate or drop unfinished items. The original is notebook-based; a digital adaptation should avoid duplicate task maintenance without removing the reflection.",
  },
  {
    id: "para",
    title: "PARA",
    subtitle: "Find information by the purpose it serves now.",
    detail:
      "Group material into Projects, Areas, Resources and Archive. Move or archive it as its purpose changes. This organizes information; it is not a complete task, reminder or prioritization system.",
  },
] as const;
export const toolCards = {
  board: {
    title: "Personal task board",
    detail:
      "Visualize existing tasks as Options, Active and Done. Respect your chosen active-work limit without maintaining another task list.",
    request:
      "Build a personal task board over the existing workspace task records. Do not copy tasks or change the approved import structure. Do not connect external services.",
  },
  review: {
    title: "Review view",
    detail:
      "Bring existing project tasks and waiting items into one view. Keep the review cadence you agreed, rather than introducing a new method.",
    request:
      "Build a review view over existing project tasks and waiting items. Preserve the agreed working method and approved import structure. Do not connect external services.",
  },
  documents: {
    title: "Document connections",
    detail:
      "Explore document sources after the initial notes and task preparation. Any connection needs its own access and action review.",
    request: "",
  },
} as const;
