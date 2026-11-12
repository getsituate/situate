# Input feedback — design proposal

For the production component API, see [the UI library](../../../packages/ui/README.md).

## Pattern

Use the existing `SituateField` wrapper rather than a separate notice below an input. Keep the label, input, persistent help and feedback together, with 8 px gaps. Feedback has no tinted panel or left rail. It uses plum text, a small symbol and an explicit localized **Error:** or **Warning:** prefix.

- **Error:** the value cannot be used. A solid plum edge with a second inner stroke identifies the input; a circled exclamation and corrective text explain it. Set `aria-invalid` only while invalid.
- **Warning:** the value is usable but has a relevant consequence worth reviewing. Use a dashed plum edge and triangular exclamation. Keep the action available and do not set `aria-invalid`. Do not require dismissal or confirmation for ordinary warnings.
- **Help:** persistent neutral instructions, never a placeholder-only explanation.
- **Corrected:** return to the normal boundary and help. Remove the old message and its description ID; no success badge, toast or mandatory acknowledgment.
- **Focus:** retain the existing inset 3 px cobalt or strong-accent ring independently of validation. The gallery's focus example displays the contour without moving actual keyboard focus.

This uses existing brand tokens, not a new red/green semantic palette. Text and symbols carry meaning independently of color. Tangerine is not an error color. The gallery's similar-name warning is a synthetic illustration of a nonblocking condition, not a proposed workspace rule.

A full-width notice remains appropriate for form-wide operation failures. An invalid value is not an operation failure, and an uncertain operation result must not be reduced to a field warning.

## Timing and interaction

For Workspace name:

1. Opening the form or typing into an unvisited field shows no validation error.
2. Leaving the field validates it. Submitting also validates, even when the name is empty. Do not disable the create action solely because of a local name error; an attempt explains the required correction instead of silently doing nothing.
3. After the first validation, update local feedback as the person edits. Clear it as soon as the value is usable, without moving focus or replacing the input. If the edited value becomes invalid again, show the relevant error. No debounce is needed for synchronous name rules.
4. After an invalid submission, focus the invalid input. In a larger form, focus the first invalid control in document order. Never focus the feedback paragraph.
5. Keep the existing folder checks, pending states and operation-failure recovery separate. A valid name alone does not mean creation is available or has succeeded.

The wrapper does not validate, move focus, disable actions or manage asynchronous work. The caller owns these policies. `error` takes precedence over `warning` if both are supplied.

## Layout and accessibility

`controlAttrs` supplies a stable input ID, `aria-describedby`, conditional `aria-invalid` and `data-field-tone`. Bind it to the actual native input, not a decorative container. The label's `for` uses that same ID. Help stays first in the description list, followed by the current feedback. Append any additional caller-owned descriptions without losing these IDs.

`reserveFeedback` reserves two lines at the current small-text size. Workspace creation opts in so its short required-name message does not move the next field. The empty reservation has no text or description ID. Longer errors, translations and zoom may grow the area; never truncate, clamp, absolutely position or overlap the message. The input's dimensions do not change with tone. The default gallery example deliberately omits help; the other examples retain it.

`announce` opts into a persistent, polite, atomic live region for feedback that appears after blur. It defaults off for static examples. Workspace creation turns it off for submission and relies on focusing the described invalid input to avoid simultaneous live and focus announcements. Do not add `role="alert"` to every local validation message. Repeated identical feedback is not rewritten on every keystroke. Screen-reader announcement timing still needs native VoiceOver verification.

Use native Tab/Shift+Tab order and Enter submission. Error and warning messages are not tab stops; there is no dismissal control. Correction keeps keyboard focus and removes obsolete associations immediately. Read-only gallery fields can receive focus for inspection; the existing interactive Name example below the gallery and the creation scenario demonstrate editing.

## Review

Start with Volta's shims first on `PATH`:

```sh
cd client
npm run design
```

In the separate controls window:

- Select **Component library**, **Ready**. Go to **Text and choices**. Inspect the six `SituateField` examples and Tab through real input focus. Use **Long labels and content** and **Example width → 280 CSS pixels** for constrained examples. Use the editable **Name** field and Save to exercise the existing catalog validation.
- Select **Create a workspace** under Onboarding (starting-state URL: `?workshop=controls&scenario=first-entry-create`). Clear Workspace name, Tab away, return and type `Field notes`. Repeat with Enter on the empty input and with the Create workspace action. Reset restores the initial fixture and clears validation.
- Resize to desktop and narrow content widths. Check that the short message does not shift the next field and that longer errors wrap without hiding the corrective text. Profile and keyboard-occlusion controls remain in the controls window; changing the environment must preserve the draft.

Compare the compact field pattern with the existing standalone notice pattern in the catalog. Recommendation: use the field pattern for invalid input; reserve notices for outcomes affecting the whole form. The main remaining usability hypothesis is whether people immediately connect the message to the field and understand that a warning permits continuation. Test this with an empty-name correction and a separate nonblocking warning task; no user study has been conducted.

## Production integration guidance

1. Reconcile the workshop changes to `src/ui/SituateField.vue` and `src/ui/text-control.css` with `client/packages/ui/src/SituateField.vue` and `client/packages/ui/src/text-control.css`. `SituateField` is already exported: extend its existing API with `warning`, `reserveFeedback` and `announce`; preserve existing slots and error/help behavior. Bind `data-field-tone` to `SituateInput` or `SituateTextarea`. Keep focus styling independent. Copy the selected tests, not the workshop import paths or fixture catalog.
2. The workshop's `en.field-feedback.json` is English design copy. Production must use central English/German catalogs under `client/packages/localization/src/catalogs/`. Supply translated prefix strings through the production library's localization boundary or caller props; do not copy the workshop JSON import into the library. Reuse `workspace.workspaceName`, `workspace.eGFieldNotes` and `native.workspace.name.required`/`invalid`/`reserved` via `t` and `localizeError`. Add a localized help key if the persistent folder-name explanation is adopted. Do not add the synthetic warning rule.
3. In `client/app/src/workspaces/WorkspaceCreateForm.vue`, wrap Workspace name in `SituateField` and bind `controlAttrs`. Replace the `p.entry-error` banner for local name validation. Preserve collision descriptions and existing destination/operation recovery. Reconcile the `name-error` ID change with consumers/tests; do not leave hidden errors referenced after recovery. Adopt the reviewed blur/submission/correction policy and keep the native input ref for focus. Gate actual creation with existing preflight checks, even when a validation attempt is allowed.
4. Remove or narrow the obsolete banner rule in `client/app/src/workspaces/workspace-entry.css` only after reviewing other consumers. Add the local field spacing without changing the setup frame, illustrations, accent picker or subsequent steps. The workshop's creation layout predates some production layout refinements; transfer the field pattern, not the entire workshop form.
5. Test the production library in isolation, then onboarding with empty, invalid, corrected and collision names. Verify Enter, clicking Create workspace, first-invalid focus, repeated submissions, retained values, pending preflight, failed creation and clearing stale descriptions. Run central translation completeness and real-locale browser/visual checks. Review English and German at constrained widths and zoom. Qualify native macOS keyboard/VoiceOver behavior separately; browser WebKit is not native qualification. Initial iOS onboarding remains deferred under the foundations.

The design follows REQ-0045's name/destination review and explicit creation boundary, REQ-0053's production translation obligations, and the brand's input and error-placement guidance. It introduces no new naming restrictions. Production lifecycle/rendering behavior and typing flicker are outside this proposal.
