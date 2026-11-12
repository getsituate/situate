# Welcome variant “One line, one page”

Workshop exploration for the first-entry welcome. It is one of several alternatives under review, not an approved product design.

## Concept

The film opens close on Bend's crown in the dark brand stage, eyes closed. Bend wakes, and as the camera pulls back a tangerine line is drawn through its open arch, followed by cobalt and violet ribbons. Five keepsakes unfold along the lines: a page, a note card, two books and a folded leaf. Bend rocks into place, greets the viewer, then opens its arms as the objects draw closer. A large paper sheet is laid over the colorful world from the lower corner, folded edge first, while Bend watches it arrive. On the quiet page the Situate wordmark writes itself stroke by stroke and receives its tangerine accent last. After a held lockup, Bend steps down out of view and the wordmark travels into the header position of the creation form. The next screen therefore begins on the same paper with the name already in place.

The film moves from the expressive welcome stage to the quiet surface of daily work instead of ending at a peak of activity. The page turn is the turning point; the wordmark accent is the final punctuation.

## Storyboard

One elapsed-time score drives every layer (`timeline.ts`). The times are authored choices, not tested reading-speed findings. Total: 11.9 s.

| Time (s)   | Act       | Action                                                                                                                              | Visible text                                       |
| ---------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 0.0–0.7    | Wake      | Close-up of Bend's crown; the eyes open.                                                                                            | —                                                  |
| 0.5–3.4    | One line  | The camera pulls back. Ribbons draw in; Bend's gaze follows the tangerine line. Keepsakes unfold along the lines; one burst blooms. | —                                                  |
| 2.5–3.7    | Arrival   | Bend settles with three diminishing rigid-arch rocks.                                                                               | —                                                  |
| 3.5–5.6    | Hello     | Blink, anticipation, wave with wrist follow-through, three small mouth accents and one wink.                                        | “Hi, I'm Bend.”                                    |
| 5.7–8.2    | Gathering | Bend looks left and right and opens its arms; the keepsakes glide into an arc around it as the camera finishes settling.            | “Tasks, notes and documents, together …”           |
| 7.9–9.2    | New page  | A paper sheet is laid from the lower corner; its raised flap and edge cover the ribbons and objects. Bend watches it arrive.        | —                                                  |
| 9.0–10.6   | Name      | The wordmark strokes write in order; the accent settles last. Bend looks toward the name, blinks and relaxes its arms.              | Wordmark, “Your personal organization, connected.” |
| 10.6–11.15 | Hold      | Complete static lockup (`stillMs` = 10.9 s).                                                                                        | Same                                               |
| 11.15–11.9 | Handoff   | The tagline lifts away; Bend dips, then steps down out of view; the wordmark moves to the entry header. `finished` follows.         | Wordmark                                           |

## Composition

- **Landscape:** Bend left of center; captions, wordmark and tagline in a right-hand text column. Ribbons and gathered objects stay out of that column so text only sits on plain ink or paper.
- **Portrait:** wordmark, Bend and tagline are centered as one vertical lockup; act captions sit below Bend. The wordmark is above Bend, so neither crosses the other during the handoff. Objects flank Bend and bleed off the lower corners instead of shrinking the character. Controls stay at the top inside the safe area.
- **Camera:** one camera moves from a close-up on the crown (up to 3.2×) to the composed view at 1×. Ribbon planes follow with reduced depth factors for parallax; text and controls are in screen space.
- **Playback controls:** stay visible through the closing frame. In narrow viewports they sit at the bottom, clear of the wordmark's header destination.
- **Handoff target:** the header geometry of the current entry screen (`headerSlot` in `timeline.ts`). If that screen's header changes, update the function.

## Artwork

- Bend is the canonical `rest` / `welcome` export animated through the workshop snapshot of the performance rig. Body paths are untouched and `stride` stays at zero.
- Page, book, card and folded leaf are the workshop's copies of the canonical paper objects. The open book is drawn locally following the open-book recipe in the illustration guidance.
- Ribbons, the paper sheet, its raised flap, edge and single shadow plane are authored here as code-generated vector shapes in the canonical palette. The burst outline is the existing panorama burst.
- The wordmark uses the canonical path data, split into its strokes so they can be drawn in order; geometry and accent are unchanged.

No generated raster images or third-party assets are used. Inspo was not consulted: the canonical brand system defines this scene's vocabulary, and website screenshots do not inform a character film. UI Skills guidance on animation principles (one focal point, ease-out entrances, ease-in exits) and masked word reveals informed the staging; no code was copied.

## Playback contract

- `WelcomeVariant.vue` props: `paused` and optional `timeMs`. Emits `toggle` and `finished` (once, on completion or Skip).
- `timeMs` renders a fixed frame without a clock; Skip still emits `finished`.
- The clock advances only while visible, unpaused, in a visible document, without reduced motion and without an open modal dialog. Resuming continues from the same elapsed time; a stalled frame advances at most 100 ms.
- Reduced motion at start or during playback shows the still lockup (`stillMs`) and emits `finished` immediately.
- Resizing recomposes the same moment for the new viewport; it never restarts.
- Captions are hidden from assistive technology; one static description in the region carries the complete content.

## Open questions

- Is 11.9 s acceptable for a first visit with immediate Skip, or should the gathering act be shortened?
- Does the page turn read as “a fresh start” or as content being hidden?
- Is Bend stepping out of view a warm exit, or should it remain until the entry screen replaces it?
- The entry screen still shows its own boxed illustration after the film. Does repeating Bend there help continuity, or weaken the ending?
