---
id: REQ-0018
type: requirement
title: Identify the plugin supplying each tool call
status: approved
priority: must
area: Control and trust
goals: [GOAL-0004]
---

## Description

Each plugin-provided tool call identifies its supplying plugin in that call's entry. Users can inspect this attribution in the [work history](REQ-0040-reveal-tool-details-and-content-changes.md), both while the call runs and after it ends. Merely showing that a plugin is installed or available does not identify the supplier of an actual call.

The call and its attribution may remain hidden inside the collapsed work history or tool group, including during execution. When the call entry is visible, its plugin identity is shown without requiring users to expand its arguments or results. Chat does not add a separate always-visible usage indicator or attribute an entire work period to a plugin.

## Rationale

Readable [plugin instructions](REQ-0017-inspect-plugin-instructions.md) describe what a plugin contributes. Call-local attribution lets users inspect which plugin actually supplied a function without cluttering the conversation or attributing unrelated work to the same plugin.

## Source

Private requirements elicitation and conversation-interface design review; transcripts not included. The supplying plugin is identified on its tool-call entry, which may remain inside collapsed work history.

## Acceptance criteria

- Each plugin-provided tool-call entry identifies the plugin that supplies that call.
- Attribution is available when inspecting a running call and remains associated with its retained entry after completion, failure or cancellation.
- Collapsing the work history or tool group may hide both the call and its attribution, including while the call runs.
- When the call entry is visible, users can identify its plugin without expanding the call's arguments or results.
- Chat shows no separate always-visible plugin-use indicator or work-period-wide plugin attribution.
- Attribution distinguishes an actual plugin-provided call from a plugin merely being installed or available.

## Open questions

- What level of detail about the specific functionality used must be shown beyond identifying the plugin?
- How should contributions without a tool call, such as plugin instructions, be attributed?
