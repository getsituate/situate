---
id: REQ-0039
type: requirement
title: Make chat activity clear and personable
status: approved
priority: must
area: Interaction
goals: [GOAL-0002, GOAL-0005]
---

## Description

Chat is the primary interaction for working with Situate. While Situate processes a request, the chat must clearly indicate that work is ongoing without requiring users to inspect technical details.

The conversation list must also show which ordinary and development chats are working, even when their views are closed, under [REQ-0011](REQ-0011-work-on-topics-in-parallel.md). Opening the chat or expanding tool details must not be necessary to discover ongoing work.

Short activity messages and polished animation should give Situate a calm, friendly, recognizable personality, following the [voice requirement](REQ-0050-use-clear-personable-language.md). Messages may relate to the work being performed and occasionally use [dry humor](REQ-0051-use-occasional-dry-humor.md) where appropriate. They must not imply specific actions or results that have not occurred. Mini Bend, defined in design/brand/bend/mini/README.md, accompanies one short, replaceable comment while work is ongoing. Reduced-motion preferences keep the mark static without removing the text or changing execution.

A separate small, fast, low-cost model generates the comments from only a brief description of current work, not the full conversation or tool results. These are personality-bearing comments, not purported internal reasoning from the executing model. Comments follow the [conversation language](REQ-0048-follow-conversation-language.md). They refresh at intervals using current work context, independently of the timing of individual tool calls and work-stage transitions. Main-chat execution never waits for comment generation. Exact intervals, latency and cost targets remain unspecified.

Settings let users disable generated comments. A catalog of general, context-independent messages supplies the text when generation is disabled or unavailable. Comments replace one another beside Mini Bend rather than accumulating as chat messages or activity entries. Model-selection and provider-default details are specified separately from this display behavior.

The entire Mini Bend working indication, including its comment, disappears when the request finishes, fails, is cancelled, or waits for a required user answer. Results, errors and required decisions remain visible separately. Neither animation nor a late comment response may prolong or revive the working indication after work has stopped.

## Rationale

Users need to distinguish ongoing work from an idle or unresponsive chat. A personable presentation should support emotional connection rather than make waiting feel like watching a technical log.

## Source

Private chat interaction requirements conversation; date not recorded, transcript not included.

Private localization and voice clarification conversation; date not recorded, transcript not included. A calm, direct, friendly voice with occasional dry humor was confirmed, without staged affection or productivity judgments.

Private chat-design clarification conversation; date not recorded, transcript not included. Mini Bend, separately generated low-context comments, periodic independent updates, a settings opt-out with predefined messages, and removal of the indication when work stops were confirmed.

Private plugin management and marketplace clarification, 2026-10-06; not publicly available. Working indicators in the conversation list cover both ordinary and development chats independently of view visibility.

## Acceptance criteria

- Users can submit requests and follow Situate's work through chat as the primary interaction.
- An ongoing request has a visible working indication, including before the first response text appears and between tool calls.
- The working indication does not depend on expanding tool-call details.
- Mini Bend and one short comment accompany ongoing work; reduced-motion preferences show a static mark instead of animation.
- The comment model receives only a brief current-work description, not full conversation content or tool results.
- Comments refresh periodically using current context; tool calls and work-stage changes do not trigger or wait for a refresh.
- Replacing a comment does not append a chat message or an activity entry.
- Generated comments follow the conversation language and are not presented as the executing model's internal reasoning.
- Users can disable generated comments in Settings; predefined context-independent messages then appear instead. Unavailable generation also uses predefined messages without blocking work.
- Completion, failure, cancellation and waiting for a required answer remove both Mini Bend and its comment; separate results, errors and question controls remain visible.
- A pending comment response arriving after work stops does not restore the indication.
- The conversation list indicates ongoing ordinary and development work even when the corresponding chat view is closed; completion, failure or stopping clears that working indication.
- Activity messages use approachable language and can refer to the current work without claiming unperformed actions or unconfirmed results.

## Open questions

- Which refresh interval and text-length limits keep comments readable without distracting from the conversation?
- Which latency and cost targets define a suitable comment model?
- Which user evaluation and visual review criteria establish a natural personality and animation quality?
