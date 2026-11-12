# Guided setup

## Review sequence

The workshop's Onboarding group contains five scenarios:

1. **Welcome** (`first-entry`)
2. **Create a workspace** (`first-entry-create`)
3. **Connect AI** (`first-entry-ai`)
4. **Verify a model** (`first-entry-model`)
5. **Set up your workspace** (`setup-conversation-brief`)

Creation, access and the setup conversation share one illustrated frame. A successful model check opens the starting-details form; authentication alone does not advance it. The form leads into one conversation for source exploration, working-method agreement, import and optional support. There is no separate method catalogue, proposal screen, source interview or import-completion screen in the review sequence. Imported files open from the conversation or workspace in a read-only reader.

The [conversation design notes](conversation-setup-notes.md) describe its states, app entry and simulation controls. The [first-visit notes](../workspaces/first-entry-notes.md) cover the welcome, creation, appearance and access checks. Older onboarding URLs resolve to relevant states in this sequence and do not add entries to the selector.

## Scope

This is an interactive proposal, not a production specification or usability finding. Initial setup targets macOS. The workshop uses synthetic data and performs no source access, import, authentication or plugin development. It does not establish durable restart, transfer, provider reliability or native accessibility behavior.

The [onboarding foundations](../../../../requirements/data/foundations.md#onboarding-and-contextual-learning), [source-preserving import requirement](../../../../requirements/data/requirements/REQ-0036-convert-imported-notes-and-tasks.md) and [workspace creation requirement](../../../../requirements/data/requirements/REQ-0045-create-local-workspaces.md) govern production adoption. The conversation proposal deliberately examines source context before method confirmation; actual import still follows explicit confirmation.

## Motion

The existing finite welcome, paper-garden stage transitions and 5.8-second finale are retained. Both early app entry and completed guided setup use the same finale. It acknowledges entering the workspace, not completed import or development. Pause, immediate skip, reduced motion, deterministic frame inspection and reset remain available. Native window chrome stays outside the app composition.

The local brand snapshot and canonical handbook govern the artwork and motion. No external code, fonts or artwork are added by this study. Rendered browser checks cover the simulated flow, not native-device qualification or user-research evidence.
