# Shared choice fields

Status: workshop proposal. `ui/SituateSelect.vue` supplies the single-value dropdown fields in the app previews, including document filters, settings, AI forms, plugin settings and file destination selection. Workshop simulation controls remain separate from the app UI. Production UI is not connected to this component.

## Interaction

- Desktop choices open beside the field and move above it when there is more room there. Mobile profiles use a bottom sheet; narrow content areas also use the sheet rather than squeeze an anchored list. Outside a configured workshop environment, coarse-pointer capability supplies the mobile default.
- Both presentations share option styling, selection marks, disabled states and targets of at least 48 CSS pixels. Long labels wrap. Long lists scroll independently, without scrolling the underlying view.
- Selection applies immediately and returns focus to the field. Close, Escape and an outside press dismiss without changing the value. Escape in a nested chooser does not close its containing form.
- Arrow keys, Home and End move the active option; typing finds matching labels. Enter or Space chooses. Tab cycles between the list and the close action while open. Disabled choices cannot be activated.
- Geometry uses the intersection of the workshop content rectangle and the visual viewport. Safe areas and keyboard occlusion are accounted for once. Opening a choice list does not require a text keyboard.

## Component contract

Use `SituateSelect` from `ui/` rather than introducing another select treatment in a feature view. Supply ordinary `option` children, optionally in `optgroup` elements, and a controlled `value` or leave the value uncontrolled. Label the field through `id` and a matching label, a wrapping label, or `aria-label`/`aria-labelledby`.

The visible control owns the field ID and accessibility attributes. The hidden native select preserves `name`, `form`, required validation and the existing `input`/`change` event contract: handlers can read the value from the event's native select target. Programmatic focus should target the visible field ID or combobox, not the hidden select. Native option popups are not used.

The default `appearance="field"` has a bordered, filled trigger. Use `appearance="toolbar"` inside an identifiable toolbar or compound field for a transparent trigger and unboxed chevron. Both retain 48-pixel targets, accessible labels and the same popup; field forms elsewhere keep their existing treatment.

Feature styles may size the outer `.situate-select` wrapper; the trigger and open list are styled centrally in `ui/select.css`. Shared supplied copy belongs in `ui/content.ts`. Platform behavior is provided through `ui/select-context.ts`, without importing product UI or services.

## Review

Open Documents and choose Add tags, Documents with or Sort documents. For other contexts, use Language & formats in Settings, the AI workspace selector, plugin schedule settings, or Folder inside the New file dialog. Check narrow portrait, landscape and keyboard-constrained sizes as well as desktop. Resetting the scenario closes an open chooser.

Browser tests exercise Chromium and WebKit, keyboard selection and cancellation, focus return and containment, nested dialogs, disabled fields, dynamic tag options and simulated iOS/Android bounds. Actual phone touch, native keyboard delivery and VoiceOver/TalkBack remain unverified. The sheet is app-rendered, not an emulation of an operating-system picker.

Guidance: UI Skills [Mobile Native](https://www.ui-skills.com/skills/emilkowalski/mobile-native/llms.txt) and [Better Accessibility](https://www.ui-skills.com/skills/jakubkrehel/better-accessibility/llms.txt). This explores a custom open-list presentation rather than the brand handbook's native-select default; canonical brand sources are unchanged. No third-party component code or assets are included.
