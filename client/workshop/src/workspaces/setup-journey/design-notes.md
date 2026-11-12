# A place to begin

An exploratory paper-garden journey toward a small personal worktable. Bend moves like a firm bent object: weight shifts, short tilts and arm gestures, with an unchanged arch. The landscape covers more distance than the character does on screen. A broad traveling wave and recurring landmarks make the journey visible without an idle loop.

## Storyboard

| Waypoint       | Held composition                                                                                      | Character intent                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create a place | A folder at the entrance, with linked notes on a nearby stand. A small loose page is caught overhead. | Welcome with one raised arm; look toward the route.                                                                                              |
| Connect        | The same entrance passes to the left. The linked notes and folder remain recognizable.                | Turn back slightly to acknowledge what is behind, then face forward.                                                                             |
| Working method | A folded map stands beside the path.                                                                  | The loose page briefly steals Bend's attention. A small rounded mouth, upward glance and late arm gesture suggest “oh, right” before continuing. |
| Bring content  | The map slips behind; a tray sits beside the path.                                                    | Lean toward the tray with a low open-arm gesture, then notice the worktable ahead.                                                               |
| Support        | A worktable, shelf, folder and paper plants come into view.                                           | Look toward the destination, without signaling that the final decision has already been made.                                                    |

Only one passing page provides the distracted moment. Folder, notes, map and tray belong to grounded places rather than orbiting over the ribbon. Plants are kept away from the character's resting feet. There are no speech bubbles, sounds or recurring gags. Completion checks belong to confirmed steps; the opening gesture is an invitation, not a completed action.

These objects are metaphors, not evidence of imported content, connected services or completed AI work. Product state belongs to the surrounding form. See [workspace creation](../../../../../requirements/data/requirements/REQ-0045-create-local-workspaces.md) and the [onboarding foundations](../../../../../requirements/data/foundations.md#onboarding-and-contextual-learning).

## Entering setup

Choosing **Create a workspace** opens the form immediately in the same frame. The header, garden and Bend remain mounted. `openingFrame(milliseconds)` supplies the decorative frame and progress reveal over 1100 ms:

- **0–460 ms:** allocate the progress row's space smoothly, keeping the same starting geometry.
- **220–550 ms:** fade the progress labels into that space without clipping their text.
- **40–750 ms:** a small preparation, a 14-unit rigid hop and a soft landing; the arch does not stretch.
- **250–1080 ms:** seven small paper pieces rise from the hands, drift outward and fade.
- **1100 ms onward:** hold exactly the original entrance pose, with no confetti.

The host's shared setup clock owns playback, inspection and lifecycle suspension. Reduced motion or paused motion selects the terminal frame directly. The form stays interactive throughout; returning to the workspace overview or resetting the scenario cancels the opening. Loading the create form directly starts settled rather than replaying the invitation.

## Between-step motion

The host supplies a separate 2700 ms transition:

- **0–750 ms:** the form leaves and its completion check draws; the artwork stays exactly still.
- **750–1150 ms:** a small completion nod, using the supplied reaction amplitude. The landscape stays still.
- **1150–2350 ms:** a brief anticipation, rigid rocking travel, a destination-specific glance or gesture, then settling.
- **2350–2700 ms:** exact destination still while the next form enters.

Waypoints are 340 world units apart. Bend also changes screen position, so the garden noticeably passes by instead of making the character walk in place. The blue ribbon follows a sampled sine curve with continuous tangents; the foreground strip follows a much shallower wave. A distant paper landscape moves at 42% of the ground-plane displacement.

The performance rig always receives `stride: 0` and `phase: 0`. Body, depth, highlight and inset path strings therefore remain canonical throughout. Small counter-lifts accompany lower-pivot tilts to keep the supporting end near the ground. This is stylized rigid rocking, not a biomechanical walk or an inverse-kinematics solution.

The page-following glance is confined to the second transition. The other segments retain their own held poses and do not replay the joke. All gestures are finite combinations of the local rig's wave, presentation, gaze, mouth and eyelid channels.

## Quiet arrival study

`arrivalFrame(progress)` describes a separate 2200 ms ending, followed by an indefinite hold:

| Progress  | Action                                                                               |
| --------- | ------------------------------------------------------------------------------------ |
| 0–0.42    | Bend comes a little closer. The loose page lands in the folder on the shelf.         |
| 0.40–0.70 | Bend reaches toward the desk and straightens a slightly crooked note by a few units. |
| 0.70–0.97 | A soft blink and a small wink; the arms open and the gaze returns to the person.     |
| 0.97–1    | Resolve into a quiet, satisfied still.                                               |

The ending starts with exactly the fifth waypoint's frame. It must run only after the real final confirmation, never merely because the support form becomes visible. It is not an extra form or a sixth setup step.

`SetupArrivalArtwork.vue` exposes this quieter alternative through an explicit `progress`. It has no confirmation binding or autonomous playback.

## Celebration and workspace handoff

Guided confirmation starts a 5800 ms sequence through `finaleFrame(milliseconds, viewport, origin)`. The measured garden bounds and scroll offset provide the origin. Bend stays in the same `JourneyStage`; the camera expands from that illustration into the full app content area.

| Time         | Action                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| 0–380 ms     | The form and progress leave.                                                                                      |
| 120–1000 ms  | The garden fills the content area; the loose page lands in the shelf folder.                                      |
| 850–1950 ms  | Bend prepares, makes a small rigid hop and lands. Two paper rockets launch in sequence and release colored paper. |
| 2100–2900 ms | Bend turns toward the desk, opens an arm and gives a brief wink. The welcome heading recedes.                     |
| 2650–3350 ms | The desk note lifts and unfolds into a larger sheet.                                                              |
| 3050–4420 ms | The camera approaches that sheet until it covers the viewport.                                                    |
| 4420–5800 ms | The paper reveals the workshop workspace. The view settles, then receives keyboard focus.                         |

The sheet passes in front of Bend as it unfolds; it is an occluding surface, not a rectangular mask placed over the character. Camera displacement follows a changing focal point so the paper stays in view during the approach. The workspace and normal chat are mounted behind the artwork and remain mounted after the handoff. Selected plugin developments have already started; their separate conversations are available in the sidebar, without replacing the normal chat.

**Go to workspace** ends the sequence immediately. **Pause** holds the current frame. Reduced motion goes directly to the normal chat; disabling decorative motion also bypasses the sequence. Hidden windows, offscreen content and open dialogs suspend playback without elapsed-time catch-up. Inspecting a frame holds it until replay or completion; scenario reset cancels playback.

Only successful guided confirmation starts the celebration. Merely viewing the support plan, continuing manually or loading a previously configured workspace does not. Imports and development conversations keep their own state and status; the celebration means arrival, not that pending work has finished.

## Contracts

`SetupJourneyArtwork.vue` retains the fixed `step`, `fromStep`, `travel`, `reaction` and optional `blocked` interface.

- Zero travel is the origin still, except for an explicitly supplied completion reaction.
- Full travel is exactly the destination still; reaction is ignored during travel.
- Matching origin and destination always hold that waypoint.
- A blocked journey holds the origin without a reaction.
- `JourneyStage.vue` retains one canonical actor and face. Its body paths never change; clip IDs are instance-unique.
- Pure complete frames make forward and backward seeking identical. There are no timers, transitions, random values or autonomous effects in the artwork components.
- Reduced motion, pause, visibility, modal suspension, progression and replay belong to the host. Reduced motion can display the selected terminal frame immediately.

The 500 × 470 composition scales uniformly to the host's desktop and narrow illustration areas. Foreground paper may leave the edges; Bend's face and full SVG frame remain contained. The illustration is decorative, has no interactive targets and does not move keyboard focus.

## Review

For the opening, load `first-entry` and finish or skip the welcome. **Opening frame** and **Replay opening** appear in the controls window while its form is visible.

For the next transition, open `first-entry-create`, then choose **Create workspace**. Use **Transition frame** and **Replay transition** in its controls window. Other held screens are `first-entry-ai`, `onboarding-method`, `onboarding-sources` and `onboarding-plan`.

For the full ending, load `onboarding-plan` and choose **Finish setup**, or choose **10 · Plan support** → **Finish setup · celebration** (`onboarding-finale`) for a held starting frame. Its current-screen controls offer **Celebration frame**, beat positions and **Replay celebration**. The browser flow in `client/workshop/tests/browser/setup-finale.spec.ts` exercises confirmation, the workspace handoff, skip, pause, reset, reduced motion and constrained sizes.

```sh
npm --prefix client/workshop test -- src/workspaces/setup-journey/
npm --prefix client/workshop run build
WORKSHOP_URL=http://127.0.0.1:1421 node client/workshop/src/workspaces/setup-journey/inspect.mjs
```

The browser inspection script needs a running workshop and installed Chromium/WebKit. Evidence goes to a temporary directory or `JOURNEY_REVIEW_OUTPUT`. It exercises creation and replay through the real controls, samples all four segments inside the same Vue preview, and drives the confirmed ending through the persistent stage's frame interface. It includes the separate 2200 ms quiet arrival study, not the fullscreen celebration. The celebration's browser tests exercise its confirmation binding and workspace handoff.

Inspect the five held frames, full travel playback and the arrival separately. Check the arch for deformation, recurring landmarks, the passing page, the note adjustment and the exact seam into arrival. Compare 1280 × 900, 390 × 844 and 320 × 568 host sizes, backward seeks, focus preservation and reduced-motion entry. Browser geometry is not native-device or assistive-technology verification.

The remaining usability question is whether the little distraction reads as affectionate character behavior without diverting attention from the next form. Reviewers should also check that the worktable feels like somewhere to begin, not a claim that the person's whole system is already complete. These are design hypotheses, not user-research findings.

## Sources

Bend, its rig and the paper assets use the workshop-local brand snapshot. The garden, shelf, worktable, note and ribbon geometry are original to this study. The host retains the canonical wordmark. No external assets or code are included; existing brand provenance and terms remain unchanged.

[UI Skills: motion performance](https://www.ui-skills.com/skills/ibelick/fixing-motion-performance) informed transform-based displacement and avoiding per-frame layout measurement or filters.
