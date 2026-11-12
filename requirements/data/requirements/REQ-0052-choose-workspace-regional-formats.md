---
id: REQ-0052
type: requirement
title: Choose workspace time, date and number formats independently
status: approved
priority: must
area: Interaction
goals: [GOAL-0002]
---

## Description

Users must be able to choose time, date and number display formats through three independent selections, separate from the [interface language](REQ-0047-choose-interface-language.md). There is no region selector. The preferences belong to the workspace, persist across reopening, and synchronize with its settings when synchronization is configured.

Time offers 12-hour and 24-hour display. Date offers day-month-year with dots or slashes, month-day-year with slashes, and year-month-day with hyphens. Numbers offer a decimal point with comma, space or apostrophe grouping, and a decimal comma with point or space grouping. The format options show examples directly in the selectors.

At workspace creation, each format is initialized independently from the corresponding supported device setting. An unavailable or unsupported device value falls back only for that field: German uses 24-hour time, day-month-year with dots, and decimal comma with point grouping; English uses 12-hour time, month-day-year with slashes, and decimal point with comma grouping. Later device-setting or interface-language changes do not overwrite the stored preferences.

Local changes and received synchronized changes must immediately update regional display formatting without a restart, preserving ongoing input, open content, and chat history. Formatting changes presentation, not underlying values or existing written content. It must not choose or convert currencies, change a time-zone reference, or shift appointments; those semantics come from the data and the relevant domain context.

## Rationale

A person can prefer an English interface while using familiar German date and number conventions. Storing these choices in the workspace keeps its preferred conventions consistent across devices instead of coupling them to interface translation.

## Source

Private localization detail interview; date not recorded, transcript not included. Independent workspace-owned regional formats, device-derived initialization, synchronization, immediate updates, and separation from currency and time-zone semantics were explicitly confirmed. Priority was approved as must.

## Acceptance criteria

- A workspace can combine an English interface with German date and number conventions, and changing either preference does not change the other.
- Users can choose time, date and number formats separately; changing one leaves the other two unchanged. The interface does not require a region selection.
- Creating a workspace initializes each format from its supported device value. A missing or unsupported value uses the initial interface language's fallback for that field only.
- Each format persists across reopening and travels with synchronized workspace settings; opening on a device with different settings does not replace it.
- The selections include every format listed in the description, with examples directly in the selectors and no separate preview.
- A manual change updates time, date and number presentation immediately without a restart; a received synchronized change does the same on other open devices.
- Updates preserve ongoing input, open content, and chat history without resetting or rewriting them.
- Changing regional formats does not translate existing written dates or numbers in notes and documents, alter stored numeric values, convert currencies, or shift appointment times.

## Open questions

- How should an in-progress numeric or date entry be presented when a synchronized format change arrives, while preserving its input and meaning?
- Which time-zone rules apply in each scheduling context? This requirement does not select them.
