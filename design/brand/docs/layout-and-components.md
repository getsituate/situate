# Layout and components

[Handbook](../README.md) · [Visual reference](../reference/index.html) · [Tokens and typography](tokens-and-typography.md)

These recipes define how the brand becomes usable surfaces. They are not a shipped component API or a specification for every product workflow. Interactive examples use synthetic personal content and simulated behavior.

## Page structure

### Expressive welcome

Use this when the reader is being introduced to a space or an idea, not whenever they return to an existing task.

1. Constrain the outer shell to 1536 px including gutters; center it. Use 48 px horizontal gutters on wide screens, 28 px at 1000 px and below, 18 px at 700 px and below, and 14 px below 360 px.
2. Give the header 26 px vertical padding. Place the vector wordmark on the left at approximately 146 × 42 px. Use a short navigation group on the right, not a command bar full of utilities.
3. Center the hero text with 48 px above and 36 px below. Put a short eyebrow above the headline; allow 22 px around the headline and 24 px below its supporting paragraph.
4. Use one main action, about 50 px tall. Put the action before the illustration in reading order.
5. Follow with a bounded scene, 32 px corner radius, using the broad panoramic proportion of roughly 3:1. Keep its text and controls in HTML, outside the artwork's moving layers.
6. Separate the next major section by 80–100 px. At narrow widths use about 55–65 px, not desktop-sized empty gaps.

The scene can crop ribbons at its edges. Do not crop Bend's face, the only meaningful object, or a control. At narrow widths, change the crop or remove edge decoration; do not scale the entire desktop page until text becomes tiny.

### Daily work surface

Use a flat surface panel with a 1 px border and 28 px radius. A top bar uses 20 px vertical and 30 px horizontal padding; its secondary label is 12–13 px. Content is the center of gravity.

For a personal-content panel with a supporting explanation, start with `minmax(0, 1.3fr) minmax(0, 1fr)`. The larger column contains the person's material, not an activity feed. Give it 38 px side padding, 38 px top, and 42 px bottom. The supporting column uses roughly 30 px padding and a quiet lilac ground (`#eee7f9`). A 1 px divider separates the columns. A tinted panel is an explanation area, not automatically an AI chat or permanent assistant sidebar.

At 1000 px, reduce inner padding to 23–30 px. At 700 px, stack the columns with the personal material first; replace the vertical divider with a horizontal one. Use 22–24 px inner padding. A real embedded component should respond to its own available width, not assume the full viewport belongs to it.

A work header may use a 37 px title, a 13 px description, and a 50–70 px object emblem. Keep 30 px between this header and the first group. Do not place a full illustration between the title and the work.

## Component recipes

### Primary and secondary actions

- Primary: ink fill, surface label, pill radius, 50 px minimum height, 13 px vertical and 24 px horizontal padding, 14 px semibold label. Use one primary action per decision group.
- Secondary: surface fill with ink text and, when needed for identification, a stronger outline. Do not give all secondary actions bright fills.
- Text action: underlined text with about 4 px underline offset; at least 44 px hit height. Underlines distinguish links in prose without relying on violet alone.
- Warm accent action: tangerine with ink text, reserved for an expressive context. It is not a default destructive treatment.
- Arrow: optional, approximately 22 px. Treat it as decorative when the label already describes the action; do not use an unexplained arrow as the only control name.

Keep hover changes small: ink may become `#503468`; a tangerine action may become peach. Keep the same geometry so text does not shift. Focus must remain visible independently of hover. Use an inset outline with `--situate-stroke-focus` (3 px) and `--situate-focus-offset` on light surfaces. Keep the ring inside the control so scroll containers do not crop it; leave enough internal padding to separate it from text and icons. Use cobalt or the strong theme accent; use a two-color or light ring on a colored stage when contrast requires it. Verify the actual adjacency. Mark the active pane with a quieter inner contour, separate from keyboard focus.

A control being disabled needs an explanation when the reason is not obvious. Do not use a permanent wait cursor for all disabled states. Only a genuinely in-progress action should suggest waiting.

### Context navigation

Use compact pills with 11 px vertical and 17 px horizontal padding and a minimum 44 px hit height. A selected context can use pale violet `#e9dfff` and semibold ink text. Text and selected state must remain understandable without the fill.

Pick semantics from behavior: links navigate; buttons perform actions; actual tabs require a tablist, associated panels, and keyboard behavior. Do not copy a tab appearance and add ARIA tab roles without implementing their behavior. Allow labels to wrap or move to another row before shrinking them.

### Task row

Use a native checkbox sized about 21 × 21 px inside a full-row label. The row has 15 px top and bottom padding, a 14 px gap after the checkbox, 14 px body text, and a quiet bottom divider. Keep its target at least 44 px high. Multiple lines align to the checkbox rather than centering a checkbox halfway down a paragraph.

Completed state uses the checked control plus struck-through muted text. Update any adjacent open-item count in words. A color change alone is insufficient. Do not append a bouncing Bend, a reward counter, or an achievement badge to an ordinary checkbox.

### Note preview

A note looks like content worth returning to, not another dashboard metric. Start with a pale warm ground, a 15 px radius, and 21 px padding. Use a 16 px semibold title, a 13 px excerpt with 1.7 line height, and a quiet metadata line separated by about 20 px.

A suitable warm recipe is background `#fbf3e2`, border `#ddccb0`, excerpt `#6a594b`, and hover `#f5ead4`. These are a bounded note treatment, not a second application palette. Use the canonical token roles if an equivalent exists rather than defining a duplicate screen-specific color.

Make either the whole preview a single action or provide distinct non-overlapping controls. Do not nest links or buttons inside a clickable button. Show the full title somewhere accessible if visual truncation is unavoidable.

### Document row

Use a 38 × 45 px file emblem, 13 px gap, 17 px vertical padding, a 14 px semibold title, and 11–13 px metadata. The emblem can sit on a pale blue `#deedff` ground with a 6 px radius. Pair it with a filename or document title; a file-type badge by itself is not a useful accessible name.

For real document types, state the actual type. For synthetic examples use simple names such as “Bookshop shortlist.” Do not imply an integration, download, or synchronized copy that the example does not implement.

### Input and choice

Use native input, textarea, and select controls with explicit labels. Put instructions and validation text outside the placeholder. Keep ordinary help in `aria-describedby`; append an error message's ID only while that error applies, then remove it on recovery. A hidden element directly referenced by `aria-describedby` can still be read as the control's description. Hiding the message or clearing `aria-invalid` alone is not enough. Default to at least 44 px target height for new controls, a surface ground, and a clearly visible boundary. The quiet separator color is too weak to be the only boundary of an input.

Reserve rounded rectangles for input fields; pill-shaped fields can be confused with actions. A 6–12 px radius works for compact choices. Long editable content needs a flatter, stable surface with generous line height, not a decorative paper fold covering the text.

### Related material

Use a restrained tint such as `#f5f0fd`, a 12 px radius, and 16–18 px padding. State why the link matters: “From Bookshop shortlist” or “Related note.” Keep a source link available when a result depends on it. Do not treat a small source label as permission to make the rest of an AI action opaque.

### Dialog

A compact content dialog uses surface ground, a 24 px radius, 30 px padding, maximum width about 520 px, and a width no greater than `calc(100% - 36px)`. Limit height to about 85 viewport percent and permit internal scrolling. On narrow screens, use 24 px padding and wrap titles and actions.

#### Text hierarchy

Task dialogs use the same compact hierarchy for confirmations, forms, errors, progress and longer reviews. A wider dialog or a destructive action does not need a larger title.

| Role                          | Size at a 16 px root            | Line height | Weight | Treatment                                                     |
| ----------------------------- | ------------------------------- | ----------- | ------ | ------------------------------------------------------------- |
| Dialog title                  | 20 px (`1.25rem`, `text-lead`)  | 1.3         | 650    | One visible title in ink                                      |
| Body and required explanation | 16 px (`1rem`, `text-body`)     | 1.55        | 400    | Ink; include consequences and recovery steps here             |
| Body section heading          | 16 px (`1rem`, `text-body`)     | 1.4         | 600    | Use only to group distinct content                            |
| Optional supporting text      | 14 px (`.875rem`, `text-small`) | 1.5         | 400    | Muted; never the only explanation of a risk or blocked action |
| Action label                  | 14 px                           | 1.55        | 600    | Existing Button variants and at least 44 px targets           |

Use the body font family and normal letter spacing throughout. Keep titles in sentence case. Do not use page/display headings, uppercase eyebrows or enlarged status labels inside a task dialog. Preserve semantic heading levels: the modal title is normally `h2`, followed by `h3` sections. Size follows the dialog role, not a page's heading rules.

Leave 16 px between the title/header and body, 12 px between paragraphs, about 20 px before a new section with 8 px below its heading, and 24 px before the action row. Keep one short explanation where one is enough. Add details only when the current state changes the decision. At narrow widths, wrap titles and actions without reducing this type scale.

Group dialog explanations with headings and space, not decorative vertical rules or quote-like indentation. Keep side rules for actual quotations or structural dividers, not ordinary warnings, dependency lists or examples.

`SituateDialog` owns this hierarchy. Put the title in its `header` slot; use `data-dialog-title` for a title inside a specialist layout, `data-dialog-section` for a section role, and `data-dialog-help` for optional supporting text. Do not redefine title or body typography in a feature stylesheet or let page styles override it. The component library provides a rendered example of all four text roles.

Rendered documents and code previews retain their own typography inside `data-dialog-document`; their headings are content, not extra modal titles. Navigation drawers and anchored choice/issue popups are different surfaces and keep their own compact presentation, even if they use native dialog mechanics. These exceptions do not create a second style for task confirmations or errors.

Use a 44 px close target with an accessible name. Give the dialog a visible title, move focus appropriately when it opens, keep interaction within a modal while it is open, support Escape when appropriate, and return focus to the invoking control. Native `<dialog>` helps, but focus behavior still needs testing. Do not animate artwork behind a modal or make a decorative layer intercept dismissal.

### Error placement and recovery

- Keep field validation beside the field, associate it with `aria-describedby`, and focus the invalid control after submission. Nonblocking status and recoverable empty results stay in their own view; not every error needs a modal.
- Use a dialog when failed or uncertain work requires a recovery decision before proceeding: for example, an unconfirmed model choice, a conversation that could not be saved, or a failed settings write. Give it a visible, specific heading, a localized explanation of the known state, and only actions the implementation supports. Follow [errors and uncertainty](voice.md#errors-and-uncertainty).
- Dismiss closes the explanation, not the underlying failure. Keep unsaved responses, drafts and pending choices intact. Retain a clearly labeled, styled recovery control and truthful unsaved status until saving is confirmed. Do not duplicate the same failure inside the conversation transcript or report dismissal as successful recovery. Settings with live previews must retain their documented preview/revert policy: show the confirmed value after reconciliation, preserve any separate unsaved edits, and never reapply or discard a choice merely because the explanation was dismissed.
- Open once for a new failure, not on every render, keystroke or background refresh. After dismissal, reopen through the recovery control or a new failed attempt. A retry must preserve uncertainty until readback or saving succeeds.
- Use the shared `SituateDialog` surface and `SituateButton` variants rather than a custom popup or screen-specific button rules. Use no more than one primary recovery/confirmation action, secondary Cancel or Dismiss, and an explicitly labeled `danger` confirmation for destructive effects. Keep destructive confirmations separate from dismissal; never discard unsaved work implicitly.

Supply an accessible name and description. Put initial focus on the relevant input or a safe action; preserve native modal keyboard containment and return focus to the invoking control or a stable workflow target. Escape follows the same dismissal policy as Cancel; disable cancellation only while the operation genuinely cannot be interrupted. Backdrop dismissal must follow that policy too, never bypass it. Allow long translations and action rows to wrap, keep focus indicators visible, and require no motion to understand a failure or complete recovery. Any added transitions must respect reduced motion.

See the [production UI API](../../../client/packages/ui/README.md) for controlled opening, header/actions slots and form composition. Test dismissal, retry, repeated failures, retained work and focus in the actual product flow; a screenshot alone does not establish those behaviors.

## States without theatrics

| State                | Visual and verbal treatment                                                                                                        | Avoid                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Empty collection     | Title, one brief explanation, one relevant action; optional small static object                                                    | A large sad character or “You have nothing”                                     |
| Reading or preparing | Plain status text near the result area; optional [Mini Bend](../bend/mini/README.md) eye frames only while an operation is pending | A full-character loop, an idle loader, or animation as the only progress signal |
| Result ready         | Result title, source, actionable next step                                                                                         | Confetti before the actual result is available                                  |
| Needs a choice       | Specific question and labeled options                                                                                              | A mascot shrug with no explanation                                              |
| Failed or uncertain  | State what is known and what the person can do                                                                                     | Claiming everything is safe, unchanged, or recoverable without evidence         |
| Unavailable action   | Reason next to the control or in associated help                                                                                   | Faint unexplained disabled text                                                 |

For a loading mark, keep visible status text outside the region marked `aria-busy="true"` so its announcement is not deferred with the region's updates. Use one polite status announcement per meaningful transition; hide frame punctuation and decorative SVG. Clear `aria-busy` and stop the mark on every terminal outcome. An indeterminate mark has no numerical progress value. Pausing decoration must not change busy state or prevent a result.

## Practical compositions

### A quiet reading list

Use “Reading list” as the context title, a short explanation, and a list of entries. Each entry uses a small book cover, title, secondary author text, and a labeled reading-status control. Synthetic book covers can use a simple tangerine, cobalt, or violet ground and a cropped arch. Keep the content panel surface-colored and avoid a separate saturated card around every book. Bend need not appear.

### A new personal collection

Show the requested collection name, the material it is based on, and a concrete action. The supporting illustration can use Bend carrying books at 160–240 px, with one curve and at most three surrounding paper objects. Once the result is visible, return to the quiet list treatment. Creating the collection should not require playing or finishing a gesture.

### A review before an external action

Lead with the actual recipient, destination, and proposed content, followed by precise action labels. Keep this surface neutral and free of celebratory artwork. A brand example may demonstrate the visual hierarchy, but must state outside the simulated work area that nothing is sent. Do not turn a prototype approval button into evidence of a security boundary.

## Responsive and accessibility checks

Test at 320, 375, 768, and 1440 CSS px, at 200% zoom, and with longer-than-example names. Essential content and focus outlines must not be clipped by rounded-panel overflow. Text must reflow without a horizontal page scroll. Preserve a logical heading order and reading order when stacking panels.

Use real buttons, links, labels, and inputs before adding custom keyboard code. Pair visible state changes with concise status announcements where useful, not announcements for every decorative motion. Ensure touch and keyboard users can do the same work as pointer users. See [implementation checks](implementation.md#verification).
