# Questions in conversations

## Review

In **Chat → Conversation**, compare the question states with three, six and ten suggestions, including the longer-answer states. **Question · free-text answer** covers an open question; **Question · answered** shows its retained result. The same interaction is used in **Onboarding → 05 · Set up your workspace**.

The active question, suggested answers and existing full composer share one surface. There is one writing area and one chat draft. The question stays beside the composer while the history scrolls; after answering, it appears in the history with the response. Attachments, dictation and model controls retain the shared composer's existing availability.

The surface uses a soft workspace-accent tint, a compact conversation emblem and stronger question typography. Suggested answers are surface-colored actions with trailing arrows, not selection controls. The input retains its ordinary boundary and focus ring. The emblem is omitted in the narrowest panes. There is no decorative animation.

## Interaction and state

Selecting a suggestion sends its label immediately as a normal user message, without another confirmation step or replacing an unsent draft. Written answers use Send or Enter; Shift+Enter retains multiline entry. Free text is always possible, including when no suggestions match or no suitable AI model is selected.

Answered and superseded questions stay readable without active controls. The host rejects stale IDs, unknown choices, empty answers and repeated submissions. A newer question supersedes the earlier pending question without inventing an answer. Newly delivered questions use the existing polite status announcement; restored history is not announced again.

Changing the environment or switching between the onboarding guide and app preserves the draft. Resetting or replacing the example clears it and cancels pending simulated work. Entering the app does not complete or cancel the setup conversation.

## Choice counts and space

Short labels wrap; sentence-length labels form a vertical list automatically. Initially, at most six suggestions are rendered. **Show more** exposes all remaining suggestions without clearing the draft or sending an answer. The question text and suggestions scroll together independently of the input. The expanded dock occupies at most 70% of the chat pane, leaving history visible. Below 480 px of window height, the answer area scrolls as a whole so neither the full question nor the composer is clipped. **Collapse question** hides the question, suggestions and composer; **Show question** restores them without discarding the draft or selecting an answer. An icon beside the question text replaces a separate disclosure row. Its tooltip and accessible name identify Collapse question or Show question; the collapsed surface retains a short label. The disclosure retains focus. A newly delivered question opens expanded.

**Question · long question and answers** adds a multi-paragraph question with sentence-length suggestions to the existing Conversation scenario. Compare the expanded and collapsed states at 1040 × 760, 390 × 600 and 320 × 350. The disclosure is a proposal: keeping the interaction inline avoids modal context switching, while bounding the expanded area alone would still leave too little reading space in a short pane. Test whether someone can consult an earlier message, reopen the question and finish an unsent answer without assistance.

Two to four suggestions remain a provisional authoring recommendation, with six as an upper target for a focused question. This is a design judgment, not a research result or a production schema limit. Very short windows leave little suggestion-list space; reachable input geometry alone does not establish readability.

Review six longer answers at 1040 × 760 and 390 × 760. Ask someone to answer with an option that is not suggested, then ask a clarifying question before deciding. Observe whether the shared writing area and the meaning of Send are understandable without explaining them. These are evaluation tasks, not reported findings.

## References

Source-structure references for grouped question interactions: the [Pi question extension](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/question.ts) and the [OpenCode question dock](https://github.com/anomalyco/opencode/blob/bf5d12c588911a35ec56ad991c3b83cf937f424a/packages/app/src/session/requests/session-question-dock-classic.tsx). These are not usability evidence.

## Host boundaries

The workshop event carries an ID, question text, identified suggestions, status and the accepted answer. A response identifies a suggestion or contains verbatim written text. The shared component does not know onboarding phases or execute domain actions.

The onboarding host binds working-method confirmation to a choice on the current proposal. Written feedback is not approval. Import decisions retain copied files. Development needs an explicit selection and subsequent final handoff; entering the app or asking about development does not authorize it.

These examples are synthetic, not a registered production LLM tool or durable execution protocol. Trip answers receive a fixed reply; onboarding feedback feeds the next scripted proposal. Native macOS/iOS behavior, VoiceOver, real providers and semantic interpretation of permission need independent qualification.
