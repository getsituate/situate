import sourceCopy from "../localization/en.import-preparation.json" with { type: "json" };
import supportCopy from "../localization/en.support-plan.json" with { type: "json" };
import methodCopy from "../localization/en.working-method.json" with { type: "json" };
export const c = {
  brand: "Situate",
  workspace: "Field notes",
  journey: {
    progress: "Your setup",
    steps: ["Your method", "Your sources", "Imported content", "Support tools"],
    step: (index: number) => `Step ${index} of 4`,
    complete: "Choice made",
    ahead: "Still to come",
    now: "You are here",
    invitation: "Let’s set up your notes and tasks around the way you work.",
    promise: "Your way of working belongs here.",
    permission: "Bring what helps. Leave the rest for later.",
    listening: "Start with what already works for you.",
    shape: "A little structure. On your terms.",
    ready: "This is starting to look like you.",
    blocked: "We can pick up where you left off.",
    blockedDetail:
      "Your answers are still here. There’s no need to start over.",
    arrival: "There’s a place for that now.",
    arrivalDetail:
      "Your choices are here. Start with a note, or follow an idea. The rest can grow with you.",
    pause: "Pause Bend’s welcome",
    resume: "Resume Bend’s welcome",
    reduced: "Motion follows your device’s reduced-motion preference.",
    keepsake: "In your own words",
    welcomeHeading: "Make yourself\nat home.",
    methodHeading: methodCopy.describeHeading,
    sourcesHeading: "Bring a little\nof your world.",
    proposalHeading: methodCopy.reviewHeading,
    samplesHeading: "Your content\nis imported.",
    planHeading: supportCopy.heading,
    sourceSettled:
      "Choose a simple structure you can keep using. Nothing is applied until you agree to the plan.",
    methodDetails: {
      keep: "Keep what works. Leave room to improve the rest.",
      custom: "No label needed. Tell me how you like to work.",
      guided: "Explore a few approaches, and borrow what fits.",
    },
    sourcesDetail:
      "Notes, lists, half-formed ideas. Bring them along, or begin with an empty page.",
    planDetail:
      "Here’s what you chose. Check it feels right before we make it your workspace.",
  },
  navigation: "Open navigation",
  setup: "Make yourself at home",
  stages: {
    access: "Your workspace is ready",
    method: "Start with the way you work",
    sources: "Bring what matters",
    "source-chat": sourceCopy.title,
    proposal: "Your proposed working method",
    samples: "Review imported content",
    "import-chat": "Import notes and tasks",
    plan: supportCopy.title,
    home: "Your workspace",
    conversation: "A weekend reading corner",
    note: "Reading corner",
  },
  intro:
    "Keep your own approach, describe something new, or explore a method together. You can change it as you go.",
  access:
    "AI access is connected for Field notes. Guided setup uses that access to discuss your organization and prepare a plan.",
  begin: "Plan my setup",
  manual: "Use without AI setup",
  manualDetail:
    "Your local notes remain readable and editable without AI. You can return to setup later.",
  blockedTitle: "AI access needs attention",
  blocked:
    "The provider could not complete this request. We cannot tell whether access, connectivity or capacity caused it. Your setup answers are still here.",
  retry: "Try connection again",
  change: "Choose different AI access",
  own: "Use my provider access",
  managed: "Explore Situate AI",
  managedDetail:
    "Managed AI is an optional paid service. Review its terms and available capacity before connecting. Choosing it here does not buy or switch anything.",
  accessDetail:
    "Connect or repair provider access in AI settings. Return to your setup when the connection is ready.",
  back: "Back",
  continue: "Continue",
  method: "What should we build on?",
  methods: {
    keep: "Keep my approach",
    custom: "Describe my own approach",
    guided: "Explore methods",
  },
  context: "How do you organize things now? What gets in the way?",
  contextExample:
    "I keep project lists and loose notes. I lose the next action when a project gets busy.",
  needsContext:
    "Add a little about your approach so it can be included in your plan.",
  guidance:
    "These solve different problems. You can borrow parts rather than adopt a whole system.",
  approaches: [
    {
      id: "gtd",
      title: "GTD · commitments and next actions",
      detail:
        "Useful when many commitments compete for attention. Capturing, clarifying and regular reviews take ongoing effort; a longer list alone will not reduce your workload.",
    },
    {
      id: "para",
      title: "PARA · organizing information",
      detail:
        "Groups material around projects, areas, resources and archives. Useful for retrieval; it needs sorting and maintenance and does not itself decide your next action.",
    },
    {
      id: "eisenhower",
      title: "Eisenhower · deciding what matters now",
      detail:
        "Compare urgency and importance for a focused decision. You still need to judge both, and it does not replace a place to keep notes or commitments.",
    },
  ],
  sourceLabel: "Where are your notes and tasks?",
  startingApproach: "Your starting approach",
  workingApproach: "Your working approach",
  source: "Source",
  sourceExample: "A notes export and a task list from my old organizer",
  sourceHelp:
    "Describe any source; it is not limited to a connector list. Access or a usable export may be needed. Leave unavailable sources for later.",
  importHelp:
    "The agent may need to develop an importer. Preparing it and copying content take time and AI capacity. Sources stay unchanged. Documents come after setup.",
  importStart: "Import notes and tasks",
  clean: "Start fresh instead",
  importState: {
    none: "No import selected",
    running: "Preparing the importer and copying notes and tasks…",
    failed:
      "The export could not be read. No content has been copied. Check the source or leave it for later.",
    ready:
      "Copied into Field notes: Reading corner and two tasks. The source is unchanged.",
    deferred: "Import left for later. No source changes or copies are pending.",
  },
  defer: "Leave this source for later",
  retryImport: "Retry import",
  refine:
    "While the import is being prepared, decide how your notes and tasks should fit together. We will apply the organization only once the import is finished and you agree.",
  organization: "Organization to use",
  organizationExample:
    "Keep project notes together. Give each project a small next-action list.",
  develop: "Also prepare a weekly review view",
  developHelp:
    "A separate development conversation will build this after you confirm the plan. You can use your notes and tasks in the meantime.",
  review: "Review my setup plan",
  waiting: "Finish the import or leave the source for later before continuing.",
  now: "Available when you enter",
  later: "Development to start",
  noDevelopment: "No plugin development selected. You can ask for tools later.",
  developmentTitle: "Weekly review view",
  developmentRequest:
    "Create a weekly review view for my project notes and next actions. Keep my existing organization. Do not connect external services or send messages.",
  capacity:
    "Confirming starts the listed development using your connected AI capacity. It may take time or be interrupted. Follow and influence it in its development conversation; closing the workspace or quitting does not keep it running.",
  planEmpty: "A clean workspace for your own notes and tasks.",
  planImported:
    "Your imported Reading corner note and two tasks, organized as agreed.",
  documentsLater:
    "Documents and other connections can be added later; they are not needed to finish setup.",
  confirm: "Apply plan and enter workspace",
  editPlan: "Change the plan",
  welcome: "Work with your agent, or on your own",
  collaboration:
    "Describe what you want to do in a conversation. Inspect changes as they happen, and steer the work when needed. Your local notes and tasks are available independently of AI.",
  scenarioTitle: "Try a small, fictional idea",
  exampleNote: "Example · Reading corner",
  removeExample: "Remove this example",
  exampleHelp:
    "This example is separate from your own note. Removing it keeps your original note and tasks.",
  scenario:
    "Plan a weekend reading corner: turn a short note into a next-action list. This uses notes and tasks already available here, not a calendar or email connection.",
  tryScenario: "Try this idea",
  dismissScenario: "Not now",
  blank: "Start with a note, not a blank page of instructions.",
  createNote: "Write a note",
  notes: "Notes and tasks",
  openNote: "Open your note",
  resume: "Return to guided setup",
  developments: "Development conversations",
  noDevelopments: "No development in progress.",
  openDevelopment: "Open development conversation",
  hintsOff: "Dismiss all hints",
  hintsDone: "Hints dismissed",
  localNote: "Your note",
  save: "Save note",
  saved: "Saved in this workspace",
  noteText:
    "A quiet corner for weekend reading. Reuse the small chair and bring a lamp from the study.",
  taskOne: "Measure the space by the window",
  taskTwo: "Check the lamp cable",
  suggestedRequest:
    "Use this fictional reading-corner note to make a small next-action list. Keep everything local.",
  scenarioResponse:
    "I kept the idea small and added a place to start. No calendar entry, message or other external action was created.",
  changeTitle: "Reading corner · change saved",
  removed: "Before",
  added: "After",
  before: "Make a reading corner.",
  after: "Make a reading corner. First, measure the space by the window.",
  changes: "Inspect changes",
  fullFile: "Open complete note",
  hintTitle: "See what changed",
  hint: "This comparison shows the saved change, not just the agent’s intention. Read what was removed and added, or open the complete note for context.",
  gotIt: "Got it",
  otherChat: "Open reading-corner conversation",
  noChange: "This conversation has no saved change yet.",
  aiUnavailable:
    "AI work is unavailable. Your notes and tasks still work; keep ideas here for later.",
  status: "Setup status",
} as const;
