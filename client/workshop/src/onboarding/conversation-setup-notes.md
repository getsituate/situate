# Conversational setup

## Proposal and review path

The Onboarding group follows one review sequence: **01 · Welcome**, **02 · Create a workspace**, **03 · Connect AI**, **04 · Verify a model**, and **05 · Set up your workspace**. The final scenario contains the brief, conversation and app-entry states. Older onboarding links redirect into this sequence rather than exposing separate method, proposal, source, import-review or support scenarios. It is not the current product contract: the onboarding foundations and REQ-0036 still describe method confirmation before source discussion, while this proposal combines the starting brief, source exploration and method discussion in one conversation. Import still follows an explicit working-method decision.

The starting-state presets cover the brief, a fresh workspace, preserving an existing method, proposal review, an active import in either view, unavailable source access, a partial import, support choices and the existing finale. Platform, viewport and response outcomes remain independent controls.

## Flow

- Creation and usable AI access lead directly into the brief after a successful model check. The same frame, Bend instance and stage-transition clock remain mounted throughout creation, access and the setup conversation. Loading a conversation starting state directly treats the first two progress steps as settled.
- The brief captures sources, whether content should be imported, and whether to preserve, change or jointly establish a working method. Starting without an import does not require inventing sources. No named-method catalogue appears.
- Starting opens one conversation inside the right-hand task panel, without a local chat header. The transcript and ordinary composer use its full height. Source details and preferences become its first user message. A reply can propose a method or ask a follow-up. The person can revise the proposal through the conversation or explicitly adopt it; a response alone never confirms it. There is no return-to-brief action inside the chat.
- The conversation stays mounted through guided step changes. The existing progress rail and illustrated transitions follow the current section. The rail represents settled setup decisions, not a percentage or time estimate; choosing no import settles that section without claiming copied files.
- After method confirmation, **Open app** becomes available. The same existing 5.8-second finale leads into the workspace whether import is still active or guided setup has reached its final confirmation. Pause, Skip, reduced motion and frame inspection reuse the existing finale components and score.
- The app opens the same setup conversation. Its draft and work state remain intact. A separate new chat and imported-file reader let reviewers examine parallel activity. **Guided view** restores the illustrated presentation without creating another conversation.
- The first app entry plays the finale once. Returning between the guide and app does not replay it; finishing setup later inside the app does not add a second ending.
- Stopping a response retains copied files. A blocked or partial import can be retried or explicitly deferred. App entry does not claim that an unfinished import succeeded.
- A concrete optional project-overview proposal appears after imported content supplies a reason for it. A fresh workspace needs no plugin. Selected development starts in a separate ordinary conversation after final confirmation and, when still guided, after the finale handoff.

Working-method confirmation, import recovery and optional support use the shared [conversation question pattern](../chat/question-notes.md), not separate onboarding decision cards. Selecting a suggested answer sends it directly; a written response uses the ordinary composer. Imported files appear as normal message references. Ordinary app chats keep their title and navigation.

## Simulation and boundaries

Sources, source observations, working-method replies, three imported files and development are synthetic. No files, accounts, models or operating-system permissions are accessed. The source description is retained verbatim; arbitrary text is not semantically interpreted by an actual model.

Automatic replies settle after a short scripted wait; the import has a longer wait so the app-entry handoff can be inspected while it is active. **Wait for manual response completion** holds work until **Complete response**. Response completion belongs to the controls, not a preview component's lifetime. Reset clears pending work, conversation input and draft state while environment-only changes preserve them.

The existing shell, ChatView, SetupFrame, step transitions, Markdown reader and finale are reused within the independent workshop. Broader workspace switching, actual AI interpretation, importer execution, plugin generation and durable continuation are not qualified by this study. The default target is macOS; constrained browser dimensions do not qualify iOS onboarding or native keyboard and accessibility behavior.

## Review questions

1. Can someone starting fresh reach a useful working-method decision without supplying sources or choosing a productivity system?
2. Can someone keeping an existing organization recognize their source description and agreed rules without repeating either?
3. During import, does **Open app** feel like continuing the same work rather than cancelling or declaring it complete?
4. After using another chat, can the person find the setup conversation and return to the guide with their unsent question intact?
5. Does the unchanged finale remain understandable when the workspace is usable but import is still active?

Review at 1280 × 900 and at narrower or shorter desktop sizes. The browser flow exercises explicit method confirmation, the same finale on both entry routes, uninterrupted playback, app/guide return, parallel chat drafts, blocked access, file reading, partial import and reset. These are scripted walkthroughs, not user-research findings or provider qualification.
