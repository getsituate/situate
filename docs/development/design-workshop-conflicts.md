# File-editor conflict scenarios

These scenarios explore local file-editor conflicts, not workspace synchronization conflicts. Start the [design workshop](design-workshop.md) and choose a conflict scenario under **Files and editing**. The preview uses the workshop's Vue editor, with its file tree, reading/source modes and history. All sources and write outcomes are synthetic.

| Scenario                 | Review path                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `files-conflict`         | Inspect two complete sources without selecting either; choose one whole version and apply it, or decide later and reopen review. |
| `files-conflict-failure` | Fail an application, retain both candidates and the choice, then retry.                                                          |
| `files-conflict-race`    | Change the source during application, invalidate the choice, and refresh before choosing again.                                  |
| `files-merged`           | Apply a non-conflicting simulated change to the committed current document without a success popup or announcement.              |

## Interaction contract

- Inspection and selection are separate. Neither candidate is selected initially. Applying a selection replaces the whole file, including metadata and endings.
- While applying, duplicate application and selection are disabled. Inspection and dismissal remain available. Resolve pending outcomes from the controls window.
- A failed write retains both candidates and the selection. Retry must not imply that the first write succeeded.
- Escape, close, and deciding later retain the conflict and any still-valid choice. Reopening review restores them.
- A newer source revision invalidates pending outcomes and the old selection. Old candidates remain readable but are labeled out of date. Refresh replaces the changed-file candidate and requires a new choice.
- Successful application updates the saved model and closes the review. Local saving is not a synchronization-success claim.
- An automatic merge silently updates committed current content. Preserve reading/source mode, focus, selection and scroll where possible; do not switch unrelated files or replace an inspected historical version. Returning to the current version displays the updated model. Automatic merging is unavailable while an unresolved conflict requires a choice.

Desktop review shows both full sources side by side. Compact review shows one at a time with inspection controls and independent scroll positions. Modal focus begins on the heading, Tab remains contained, and Escape returns to the review trigger. Refresh returns focus to the heading; failure offers Retry. Application completion must not steal focus if review was already dismissed. Automatic merging does not move focus.

## Scope and verification

Use platform profiles, constrained sizes and keyboard occlusion from the separate workshop controls. The dialog must fit the effective app content area and scroll at short heights. Profiles are not native device execution.

Run `npm run test:design` and `npm run test:browser:design` from `client/`. Workshop tests exercise synthetic state transitions and browser interactions; they do not verify atomic filesystem writes, a real merge algorithm, durable conflict retention, workspace synchronization, native focus or screen-reader speech. Production storage and lifecycle tests remain separate.

The design basis is [REQ-0042](../../requirements/data/requirements/REQ-0042-edit-markdown-source-and-read-rendered-content.md), the [product concept](../product-concept.md), [positioning](../positioning.md), and [foundations](../../requirements/data/foundations.md). Canonical [brand provenance](../../design/brand/docs/provenance.md) applies to the workshop's local asset snapshot. [Accessibility guidance](https://www.ui-skills.com/skills/ibelick/fixing-accessibility/llms.txt) informed modal semantics and feedback. These scenarios are design proposals, not user-research results.
