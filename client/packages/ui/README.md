# Situate UI

The production client imports reusable Vue components from `@situate/ui`. Components use the host's `--situate-*` CSS tokens. Callers supply labels and content; Field's feedback prefixes, Select's shared choice and validation messages, and ResizeHandle's help and pixel values come from `@situate/localization`. They do not load workspace data or execute application services.

## Components

- Actions: `SituateButton`, `SituateIconButton`, `SituateIcon`.
- Forms: `SituateInput`, `SituateTextarea`, `SituateCheckbox`, `SituateRadio`, `SituateSelect`, `SituateSwitch`, `SituateFilterChip`, `SituateField`.
- Feedback and surfaces: `SituateBadge`, `SituateNotice`, `SituateEmptyState`, `SituatePanel`, `SituateDialog`, `SituateDialogActions`, `SituatePopover`, `SituateMenu`, `SituateDisclosure`, `SituateTooltip`, `SituateProgress`.
- Layout: `SituateScrollbars`, `SituateResizeHandle`.

```vue
<script setup>
import { ref } from "vue";
import { SituateButton, SituateField, SituateInput } from "@situate/ui";

defineProps({ nameLabel: String, saveLabel: String, nameError: String });
const emit = defineEmits(["save"]);
const name = ref("");
</script>

<template>
  <form @submit.prevent="emit('save', name)">
    <SituateField
      :label="nameLabel"
      :error="nameError"
      v-slot="{ controlAttrs }"
    >
      <SituateInput v-bind="controlAttrs" v-model="name" />
    </SituateField>
    <SituateButton type="submit">{{ saveLabel }}</SituateButton>
  </form>
</template>
```

Supply labels and messages from the application's localization catalog. `Field` binds its generated ID, description IDs and invalid state through `controlAttrs`; bind these to one control. Use a native `fieldset` and `legend` for a group of radio buttons.

`Field` accepts `help`, `error` and nonblocking `warning` text. Error takes precedence; only error sets `aria-invalid`. The slot's `controlAttrs` includes `data-field-tone` for Input and Textarea boundaries. Append caller-owned descriptions to its `aria-describedby` value rather than replacing it. Clearing feedback removes its description ID and tone without changing the control ID. `reserveFeedback` reserves two small-text lines and allows longer messages to grow. `announce` enables a polite, atomic feedback live region; both options default off. Callers own validation timing, action availability and focus. Disable announcements when focusing a described invalid control after submission to avoid duplicate announcements.

`Button` supports `variant="primary|secondary|ghost|danger|plain"`, `size="normal|small"`, `disabled` and `busy`. Busy controls cannot be activated and expose `aria-busy`; callers supply the progress wording. `IconButton` requires an accessible `label` and accepts an icon name or default-slot artwork.

Button's optional `title` and IconButton's `title` or `label` supply shared hover/keyboard-focus help instead of native title bubbles. Caller descriptions are preserved. `Tooltip` can also bind an `anchor` and emit `describe` with its description ID, or supply `triggerAttrs` through its default slot. Its text is supplementary: the trigger still needs an accessible name.

Text controls accept native attributes/listeners and optional `v-model`. Checkbox and Switch models are boolean; Radio and Select models are single string/number values. Switch also supports native `checked`/`change` ownership. FilterChip requires a localized `removeLabel`, renders its content in the default slot, and emits `remove` with the click event.

`Select` renders a custom dialog with a listbox, presented as a sheet on mobile hosts, coarse pointers and narrow viewports. Supply native `option`/`optgroup` elements in its default slot and control it with `value` plus `change`, or `v-model` (including `.number`). A hidden native select preserves `name`, `form`, `required`, disabled choices and form submission/reset behavior. Emitted `input` and `change` events target that native select. Labels, IDs, descriptions and focus belong to the visible combobox trigger. `appearance="field"` is the default; `appearance="toolbar"` provides a compact presentation. The popup supports arrow keys, Home/End, typeahead, Enter/Space, Escape and focus restoration. Hosts can provide `selectEnvironment` with a reactive `mobile` value; sheet placement follows the visual viewport and safe-area insets.

`Badge` and `Notice` accept `tone="neutral|info|success|warning|danger"`; text identifies the actual state. Neither assigns a live-region role automatically. `EmptyState` accepts `title`, `description` and `title`/default/`actions` slots. `Panel` provides a neutral surface. Use the title slot when a different heading level is needed.

Input, Textarea, Checkbox, Radio and Dialog expose their native node as `.element`; imperative focus and selection methods are available where applicable. Button exposes `.element` and `focus()`. Select exposes its hidden form select as `.element`, while `focus()` focuses its visible trigger. A component ref is not an `HTMLElement`.

`Dialog` supports caller-owned `:open="visible"` for reactive modal opening, or imperative `showModal()` and `close()` when `open` is omitted. The controlled mode opens only on state transitions; handle `@cancel.prevent` by changing the caller state. Do not combine native `open` attributes with imperative modal opening. Use `.element` for other native operations. Supply its accessible name, initial focus and invoking-control restoration; native Escape and close events are forwarded. It defaults to a bounded, scrollable surface. Use `appearance="plain"` only for specialized layouts such as a navigation drawer. The `header` slot arranges a caller-owned heading and optional close IconButton; the `actions` slot arranges application Buttons. Use `DialogActions` inside a form when actions must remain within that form. Choose a secondary cancel action, a primary confirmation, or `variant="danger"` for a destructive confirmation; do not override their styles in dialog consumers. Follow the [dialog and recovery guidance](../../../design/brand/docs/layout-and-components.md#dialog) for error placement, dismissal and protecting unsaved work.

Default dialogs use a 1.25rem/1.3/650 title, 1rem/1.55/400 body, and 1rem/1.4/600 section headings, all in the system body font with normal letter spacing. Direct `h2`/`h3` children and `h1`–`h3` headings within the header slot receive title styling. Mark the actual heading with `data-dialog-title` in custom nested layouts. `data-dialog-section` applies section styling; `data-dialog-help` applies muted .875rem/1.5/400 secondary text. Put `data-dialog-document` on document or code preview containers to preserve their own descendant typography. Task dialogs retain these defaults even when customizing layout or scrolling; plain surfaces do not receive this hierarchy.

`Menu` and `Popover` take caller-owned `open`, a localized `label`, and either an `anchor` element or viewport `point: { x, y }`. They emit `close`; the caller must update `open`. Positioning follows the visual viewport and safe-area bounds. `align="start|end"` chooses the anchor edge (end by default); `maxHeight` optionally limits the surface height in pixels, within viewport bounds. Surfaces invoked inside an open modal remain hosted there. Menu items stay caller-owned: supply `menuitem`, `menuitemradio` or `menuitemcheckbox` roles, checked state and action handlers. `initialFocus="first|last|checked"` selects the opening item; `:close-on-select="false"` leaves dismissal to the caller. Popover does not add menu navigation to arbitrary content.

`Disclosure` accepts a `label` prop or label slot, default-slot content, and optional `v-model:open`; native details attributes and toggle events remain available. `Progress` requires a label. Finite `value` and positive `max` describe measured work; an optional fractional `estimate` only changes the indeterminate visual fill, never numeric accessibility values.

Mount `Scrollbars` once at the application root, with or without a default slot. It tracks native scrolling throughout the document, including teleported content, and releases its listeners when its final owner unmounts. It does not wrap or replace scrolling surfaces.

`ResizeHandle` models a pixel dimension with `v-model`, `min`, `max`, `resetValue`, a localized `label` and the controlled element's ID in `controls`. A vertical separator changes width; a horizontal separator changes height. `update:modelValue` previews movement, `change` commits a completed gesture, and `dragging` reports pointer activity. Escape, lost capture and window blur cancel a drag. The caller owns pane geometry and persistence; ratio-based layouts must convert at that boundary.

Use `appearance="plain"` on text controls or `variant="plain"` on actions only for a specialized presentation, such as a tree row or editor. Ordinary controls should rely on library defaults.

## Workshop adoption

The design workshop has its own independent library. Matching component names and contracts make manual adoption possible, but source equality is not required. Copy a selected component with its relative helpers, styles and tests, reconcile its callers and token values, then verify production flows. Text controls also need `text-control.ts` and `text-control.css`; Select needs `select-context.ts` and `select.css`.

See the [adoption guide](../../../docs/development/design-workshop.md#adopt-an-approved-design) and [component inventory](../../workshop/src/component-library/inventory.md). Do not add live workshop imports, symlinks or automatic synchronization. This package alone does not register a plugin runtime or establish a long-term SDK compatibility guarantee.
