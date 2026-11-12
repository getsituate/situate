# Listening room: brand transfer review

[Handbook](../README.md) · [Exercise](transfer-brief.md) · [Listening room](../examples/listening-room/index.html) · [Validation commands](README.md)

Reviewed on 2026-10-01. This is a bounded authoring exercise and an agent-led design and implementation review, not user research.

## Question and method

Could a fresh contributor use the written brand packet to make a new composition, component, illustration, and Bend situation without additional aesthetic coaching?

- **Frozen input:** commit `d3f119744b58de538a553a42be3659cef714f905`, including the exercise and its seven review criteria.
- **Author:** a fresh OpenAI `gpt-6-astra` session with high reasoning, in a separate worktree. The session was given the exercise, its output boundary, and local test-tool availability. It did not receive the earlier design conversation or intermediate visual feedback.
- **Source boundary:** current handbook, tokens, character kit, artwork, reference, and product documentation. Archived explorations, Git history, external references, and sibling worktrees were excluded by the instructions. This was an instructed boundary, not a security sandbox.
- **Write boundary:** `design/brand/examples/listening-room/`. Canonical sources stayed frozen during the first attempt.
- **First submission:** integrated unchanged as commit `bdb7856` before corrections. Its five files contain the page, CSS, interaction code, browser tests, and implementation note.
- **Review:** the integrating agent inspected and tested the submission; a separate read-only agent also inspected source, renders, and behavior. Neither review constitutes participant evidence.

The packet was sufficient for the first submission's visual construction and canonical-character reuse. The submission was not defect-free: review found misleading accessible descriptions, including a pattern already present in the supplied reference. The current example includes the corrections below.

## First-submission findings

| Criterion     | Observed evidence                                                                                                                                                                       | Assessment                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Original wordmark, paper/plum fields, violet emphasis, rounded display hierarchy, broad curves, and offset sleeve depth; a character-free working surface below the illustrated welcome | Visually coherent with the packet in inspected desktop and narrow renders. This is review judgment, not measured user recognition.                                |
| Character     | Calls the shared renderer with `point` / `curious`; uses its SVG export as the static fallback                                                                                          | No independent body drawing. Crown face, empty opening, depth, highlight, inset, and rear-root layering remain visible in the inspected static and paused frames. |
| New material  | Original record/sleeve motif and three abstract cover designs; an album → side → track → note component                                                                                 | More than relabeled reading-list content. The canonical pointing pose establishes a new relationship with the record without changing anatomy.                    |
| Motion        | Explicit one-second pointing gesture, still control, pause across replay, finite completion, replacement, and reduced-motion handling                                                   | Checked behavior met the exercise. No automatic motion; notes and tasks update independently of animation.                                                        |
| Interaction   | Separate kept notes per album/side/track, empty state, blank-input recovery, note restoration, reversible task, literal treatment of entered markup                                     | Required local workflows worked. Unkept drafts are discarded on selection changes; there is no note-history undo or persistent storage.                           |
| Accessibility | Native controls, keyboard operation, validation focus, sampled contrast, and tested reflow                                                                                              | Those checks passed, but conditional descriptions were wrong in the accessibility tree. See corrections below. No screen-reader speech test was performed.        |
| Reuse         | Direct references to shared tokens, wordmark, renderer, controller, and static export; unchanged canonical token/character sources                                                      | No hidden runtime dependency appeared in inspected code or browser requests. Local provenance identified the original new artwork.                                |

At 320 CSS px, the static left arm has approximately 1 CSS px of clearance from the stage edge. The inspected arm, feet, record, and sleeve remain visible, but the composition is tight. This is a remaining framing limitation, not an observed clipping failure or a claim that the crop is comfortable for users.

## Corrections after first review

Commit `744a8f3` changes behavior and guidance without redesigning the composition or character:

1. **Conditional descriptions.** The gesture button always referenced a hidden device-preference explanation. With motion available, Chromium nevertheless exposed “Motion is off in your system settings” as its description. The note field similarly referenced its hidden blank-input error before failure and after recovery. Description IDs are now attached only while the corresponding messages apply; ordinary help remains associated.
2. **Reference pattern.** The frozen visual reference also permanently associated its hidden validation error. The reference now updates that association on failure and recovery. The layout and motion chapters explain why hiding a referenced message is insufficient.
3. **Regression coverage.** Browser tests inspect Chromium's accessibility tree for normal, invalid, recovered, reduced-motion, and restored-motion states. These assertions test exposed metadata, not actual screen-reader speech.
4. **Draft wording.** Visible help now names album, side, and track changes as the points at which unkept edits are discarded. The underlying page-memory behavior is unchanged.

The exercise also exposed an administrative conflict: the handbook requires central artwork provenance, while the frozen write boundary prohibited changing that manifest. The author recorded provenance locally rather than modifying a frozen source. The integrated [manifest](../docs/provenance.md) now registers that artwork, and the exercise clarifies the local-record/central-registration handoff for future runs.

No record-specific component recipe was needed from the packet. Side-local numbering and one note per track are example-level choices, not additions to Situate's product requirements. No further fresh-context trial was run after these corrections; do not describe the revised packet as independently retested for general transfer.

## Verification and limits

The first submission's browser suite and source checks were rerun by the integrating agent and the read-only reviewer. After corrections, the integrating agent reran the Listening room and reference suites, including the new accessibility-tree assertions. The maintained commands are in the [validation guide](README.md) and [example implementation note](../examples/listening-room/implementation.md).

Environment: installed Chrome `154.0.8037.58` on macOS, using an existing Playwright installation. The Listening room checks covered 320, 375, 768, and 1440 CSS px, long content, system-font fallback, and 200% CSS zoom. Sampled text contrast was at least 5.16:1; sampled essential-control boundaries were at least 3.89:1. Local images loaded, IDs were unique, and the checked browser runs reported no script errors or attempted remote requests. Static content was inspected with JavaScript disabled.

Motion checks included completion, replacement, pause/resume, stop, offscreen suspension, live and initial reduced motion, teardown, and synthetic visibility/cache-restoration events. Those events do not establish actual OS suspension or browser back/forward-cache behavior.

This single exercise supports a narrow conclusion: the packet enabled one fresh agent to produce a visually consistent, genuinely new application of the identity, while review exposed an accessibility pattern that needed correction. It does not establish universal contributor reproducibility, user preference, emotion recognition, accessibility conformance, production readiness, cross-browser parity, physical-touch usability, screen-reader experience, or real browser-zoom behavior.
