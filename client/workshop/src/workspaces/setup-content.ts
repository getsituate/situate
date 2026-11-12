export const setupCopy = {
  progress: "Workspace setup",
  openingFrame: "Opening frame",
  replayOpening: "Replay opening",
  transitionFrame: "Transition frame",
  replayTransition: "Replay transition",
  livePlayback: "Live playback",
  transitionDuration: (milliseconds: number) => `${milliseconds} ms total`,
  steps: [
    "Create a workspace",
    "Connect AI",
    "Shape your working method",
    "Bring your content",
    "Set up support",
  ],
  done: "Complete",
  pause: "Finish later",
  paused: "Pick up where you left off.",
  pausedDetail:
    "Your workspace and setup progress are kept. Resume when you’re ready; a working AI connection is needed to continue the guided setup.",
  resume: "Resume setup",
  required:
    "First, connect AI. We’ll use it to shape your working method together. You can finish later without losing your workspace.",
  modelTitle: "Choose the model we’ll work with.",
  modelDetail:
    "Your provider is connected. Check a model before we begin shaping your workspace together.",
  modelLabel: "Model for setup",
  chooseModel: "Choose a model",
  manualModel: "Model ID",
  noModels:
    "No eligible models are available for this connection. Choose another provider or sign-in method.",
  changeProvider: "Change connection",
  check: "Check model and begin",
  checking: "Checking model access…",
  checkDetail:
    "This sends a small test request without workspace content. Your provider’s usage limits and charges may apply.",
  failed:
    "The model could not be verified. Your workspace is unchanged. Try again or change the connection.",
};
