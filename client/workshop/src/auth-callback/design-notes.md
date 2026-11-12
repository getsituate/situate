# Browser sign-in return

Browser page shown after direct ChatGPT sign-in, with a confirmed connection or recovery guidance.

## Review

Start the browser workshop from `client/`:

```sh
npm run dev --workspace @situate/workshop
```

Open <http://localhost:1421/?workshop=controls&scenario=auth-callback-received>, then **Open preview**. Select **Browser sign-in return** under **Scenario**. Its two starting states are **AI provider connected** and **Connection not confirmed**.

The separate controls window changes the synthetic response and provides replay, pause, frame inspection, and a reduced-motion still. Reset restores the selected starting state and clears help and playback. Viewport changes preserve them. The preview's only interactive control opens return instructions; it never opens an app, closes a tab, contacts a provider, or reads a callback URL.

## What the browser knows

The production [loopback listener](../../../app/src-tauri/src/openai_oauth.rs) retains the accepted request's socket while the [login worker](../../../app/src-tauri/src/ai_login.rs) exchanges the code, verifies identity, persists credentials, and finishes connection setup. It sends the success page only when access is available and a model has been resolved without a model error. The browser remains loading until that result is known.

Rejected requests and incomplete setup receive recovery guidance. A failed or interrupted worker cannot send a success response. Browser delivery is bounded and best-effort: a closed tab does not undo a saved connection. Neither page echoes provider errors or request data.

There is no browser update channel, app-opening link, or automatic tab-closing contract. The workshop simulates final results; it does not perform authentication. These boundaries follow [REQ-0015](../../../../requirements/data/requirements/REQ-0015-connect-user-provided-models.md), including the distinction between authentication, saved access, and usable model access.

## Direction

| Direction        | Strength                                                                 | Trade-off                                                                   |
| ---------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Quiet receipt    | Minimal distraction and very explicit status.                            | Little personal recognition of a meaningful setup step.                     |
| Bend handoff     | Acknowledges the saved connection and directs attention back to Situate. | Requires a confirmed connection before the success page can be shown.       |
| Bend celebration | An expansive, memorable acknowledgment with viewport-wide confetti.      | Needs precise milestone copy, protected reading areas, and a finite ending. |

**Selected direction: Bend celebration.** Warm paper, plum type, the fixed wordmark, and one lemon receipt ground a larger celebration in Situate’s identity. A single burst of colored paper, curled strips, and small glints fills the browser viewport while Bend raises an arm and briefly lifts. The headline confirms the connection. One sentence directs the person back to Situate. The success page omits the separate status label, secondary hint, and footer. The platform-neutral help disclosure explains switching apps rather than offering a nonfunctional “Open Situate” button.

In Emotional Design terms, the illustration supplies visceral warmth; clear next-step guidance supplies behavioral usefulness; accurate, modest acknowledgment supports reflective trust. Bend offers company, not praise or a demand to watch. Errors omit the character and animation.

## Motion score

The 4.4-second sequence uses the workshop's unchanged Bend geometry and performance rig. Text and return guidance are visible from the first frame.

| Time         | Beat                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| 0–550 ms     | The already-checked receipt settles. Bend notices it and anticipates the celebration.                                 |
| 350–1400 ms  | Two overlapping confetti jets arc across the viewport. Bend raises an arm, opens the other, and lifts briefly.        |
| 1400–2600 ms | Bend gives one wink and lowers into a grounded pose. Individual glints swell once among the falling paper.            |
| 2600–4400 ms | The last paper pieces fall and fade. All particles disappear; the complete composition holds without a running clock. |

There is no transfer progress, recurring emitter, sound, navigation, or delayed action. The confetti sits behind the reading area, wordmark, footer text, and Bend. Small four-point glints swell once rather than flashing repeatedly. The layer cannot intercept pointer input and is hidden from assistive technology. One elapsed-time score determines every moving element. Pause, hidden/offscreen suspension, deterministic forward/backward seeking, replay, and teardown share that clock. Resizing recomposes the illustration without restarting it. OS reduced motion, including a live preference change, immediately removes all particles and shows the held ending. Turning reduced motion off does not replay automatically.

The warm palette, typography, paper objects, and finite character treatment follow the [brand handbook](../../../../design/brand/README.md), [motion guidance](../../../../design/brand/docs/motion.md), and [voice](../../../../design/brand/docs/voice.md). Existing workshop assets retain their [snapshot provenance](../brand/README.md); no outside artwork, fonts, or code is included.

## Review question

After seeing the success page, can a person explain what has completed and how to return to the app? Selecting this direction is not usability evidence.

Review at wide and narrow browser sizes, with return help open, keyboard-only input, 200% zoom, and reduced motion. The layout stacks below 700 CSS px and scrolls in short windows. Decorative SVG is hidden from assistive technology. The recovery status uses a polite live region; animation never sends announcements. Native VoiceOver, actual browser zoom, app switching, and mobile-browser behavior still need target-device review. Workshop viewport profiles are geometry assumptions, not device emulation.

## External guidance

- [UI Skills: Delight](https://www.ui-skills.com/skills/pbakaus/delight): acknowledge a meaningful action without delaying the task or overstating the outcome.
- [UI Skills: Animate](https://www.ui-skills.com/skills/pbakaus/animate): one authored focal sequence, bounded motion, intentional still, and interruption handling.
- [UI Skills: Accessible Animation](https://www.ui-skills.com/skills/iart-ai/accessible-animation): remove large-area decorative travel under reduced motion while keeping status and focus feedback.
- Inspo's [Convex sign-up reference](https://convex.dev) separates identity, one heading, and one next step. Its observed hierarchy was useful; its marketing layout, palette, and artwork were not adopted. The reference is not a callback flow or usability evidence.
