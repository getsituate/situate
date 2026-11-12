# First visit and workspace appearance

## Review path

Normal startup shows the workspace overview, with the workspace list and creation/opening actions. Choose **Create a workspace** to start **01 · Welcome** (`first-entry`); completion or Skip goes directly to **02 · Create a workspace** (`first-entry-create`). The creation preset opens the form directly for inspection. `first-entry-ai`, `first-entry-model` and `first-entry-paused` open provider selection, model verification and resumption directly.

The greeting fills the content viewport before the creation form appears. Skip is immediately available; reduced motion goes directly to creation without a delay. Pausing affects only decoration, never a workspace operation. Cancel before creation returns to the normal overview. Opening an existing workspace bypasses the welcome and creation; an already-created incomplete workspace restores its retained setup step.

Creation reuses the existing name, directory selection, preflight, collision and failure interactions. Color changes are scoped to the creation surface. Successful creation records the accent on the workspace fixture; cancellation discards the color preview. Opening an existing workspace uses that fixture's appearance instead. The guided setup retains the chosen accent on its step markers and primary actions. General application-wide theme rendering and theme settings are outside this study.

## Fullscreen welcome studies

The first-visit scenario (`first-entry`) uses the Astra welcome and leads directly to creation. The earlier Opus link redirects to this welcome. The animation owns the full content viewport, including its playback controls; native window chrome remains outside the composition.

During the introduction, **Animation frame** in the controls window freezes a chosen instant without completing the scene. **Replay animation** restarts from the beginning; **Reset scenario** also restores the workspace fixture. The inspector disappears when the preview reaches creation. Skip and motion controls remain in the preview because they belong to the user experience.

The studies' own `design-notes.md` files describe their scores, artwork and remaining design questions. Review complete playback and the handoff, not only isolated stills. A detailed scene is not necessarily a more welcoming one; compare immediate recognition, reading effort and the desire to skip.

## Palette

Creation uses the same six-color picker as workspace appearance settings, backed by the workshop palette:

- Violet-deep with surface text.
- Cobalt with surface text.
- Tangerine, sky, peach and lemon with ink text.

The [brand contrast reference](../../../../design/brand/docs/tokens-and-typography.md#contrast-reference) documents these pairs. Strong outlines and native radio state distinguish choices without depending on color alone. Focus has an ink boundary when it uses the selected accent. Bend's material, wordmark and illustrative colors are not recolored. These are experimental workspace appearances, not changes to canonical tokens or a complete theme system.

## Simulation boundaries

No directories, accounts or network authentication are accessed. The folder picker selects synthetic locations. The separate controls window can hold, fail or complete workspace operations and introduce a folder collision. Device authorization, recovery-key entry and selecting a synchronized workspace remain separate design questions.

Successful creation opens AI setup immediately in the simulation. Its 2700 ms visual transition keeps the same frame, wordmark and Bend instance. The right-hand content fades out from 0–250 ms while Bend stays still. The creation check then draws from 250–750 ms, without competing movement. The finished check holds from 750–1150 ms: six short rays disperse from 750–1050 ms and Bend gives a small, satisfied nod. From 1150–2350 ms, the paper garden advances to its next waypoint while Bend shifts its weight without deforming its arch. Provider selection fades in from 2350–2700 ms as Connect AI gains its accent. No operation waits for animation completion. Failed creation leaves the form and progress unchanged.

Finishing the fullscreen welcome opens the setup frame, where the progress row appears over a 1100 ms invitation. The form remains interactive. **Opening frame** and **Replay opening** inspect this entrance without creating a workspace; loading creation directly starts settled.

The setup clock coordinates the opening and subsequent guided-stage transitions. Successful final confirmation starts a separate finite 5800 ms celebration: the garden fills the app content area, Bend launches paper rockets, and an unfolding desk note reveals the workspace already mounted behind it. **Pause** holds playback and **Go to workspace** skips it immediately. Confirmation retains selected requests without starting them. Finishing or skipping the celebration opens the normal workspace and then starts the selected development chats in parallel; plugin construction and start failures belong to those chats. **Celebration frame** and **Replay celebration** inspect the ending without repeating authorization. The [paper-garden score](setup-journey/design-notes.md) describes its five waypoints and workspace handoff. On desktop, the task card scrolls independently so Bend does not move when a long form advances. Reduced motion or a prior motion pause shows the destination directly. Hidden or offscreen surfaces and open dialogs suspend playback without accumulating elapsed background time. Resizing recomposes the current frame, and teardown cancels the clock.

After creation, **Transition frame** and **Replay transition** in the controls inspect the handoff without creating another workspace or reconnecting a provider. These controls disappear when provider setup advances or setup is paused. Inspecting the final frame does not issue a navigation command; a preview reload shows the current task without replaying creation.

Progress begins on the creation form: creation, AI connection, working-method design, content takeover and optional support. Every newly created workspace follows this path; opening an existing folder or signing into synchronization does not. Later stages are informational, not navigation shortcuts. The setup frame pairs a finite Bend gesture and paper objects on the left with a task card on the right. Narrow views stack the illustration above the card; short narrow views prioritize the task. Canonical objects keep their colors over cobalt, tangerine and violet ribbons. Reduced motion keeps the same composition without the gesture. The AI stage reuses the provider/authentication study without its local-use bypass. Provider authentication alone does not unlock working-method design: users choose an eligible model and authorize a separate test request. Only a successful model-check outcome advances into **05 · Set up your workspace**, which captures sources and working preferences together before continuing in one conversation. The [conversation flow](../onboarding/conversation-setup-notes.md) describes method confirmation, import and app entry. The controls simulate provider and model-check outcomes separately. Unknown providers can have an empty model catalog; a compatible endpoint allows a manual model ID.

Finishing later retains the workspace and setup state in the controls session. Pending authentication is cancelled, credential drafts are cleared, and pending model checks become inactive. Resumption does not repeat creation or its transition; preview reloads reconnect to the same state. Reloading the controls or resetting the scenario does not persist that state. This is not filesystem persistence or native application restart recovery.

[REQ-0045](../../../../requirements/data/requirements/REQ-0045-create-local-workspaces.md) requires AI connection before guided onboarding, with no initial manual-use bypass. The guided route models that access gate; older standalone optional-access scenes are not the onboarding contract. Production must retain answers, drafts, decisions and the current step across exit/crash and workspace transfer, require destination-device access where missing, and wait for user interaction before continuing interrupted AI work. Those durable behaviors are not implemented by this controls-session simulation. Established workspaces do not acquire a permanent AI-availability gate. Initial onboarding delivery targets macOS; post-setup tutorials are outside its scope.

## Evaluation

Can a person explain what belongs to a workspace and choose between creating, opening and synchronization? Can they locate the proposed folder, change the workspace accent, and distinguish a preview from a created workspace? Compare the animated entry with reduced motion without making users wait through either to begin.

Browser walkthroughs cover Chromium and WebKit, desktop and narrow viewports, immediate skip, color contrast pairs, validation failure/recovery, cancellation and reset. Mobile safe areas and keyboard occlusion are workshop assumptions, not native-device or assistive-technology verification.

The motion and focus treatment draws on UI Skills **Animate** (`pbakaus/animate`) and **Fixing accessibility** (`ibelick/fixing-accessibility`), subordinate to the brand's finite-welcome and motion-preference guidance. Step transitions use the workshop's canonical `rest-welcome.svg` snapshot and performance rig; the host owns the shared clock, and the paper-garden score supplies complete rigid-body poses.
