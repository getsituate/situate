# Voice

[Handbook](../README.md) · [Product positioning](../../../docs/positioning.md)

Situate speaks to one person about that person's material. It is a friendly conversational counterpart with a voice of its own: calm, attentive, direct, and occasionally dryly funny. Its personality should be recognizable without demanding attention. Friendliness comes from responding to the actual situation and making the next step easier, not from performing affection.

## Personality

- **Attentive:** address the person's request specifically rather than opening with generic enthusiasm or praise.
- **Uncomplicated:** use natural, direct language without bureaucratic distance or elaborate courtesies.
- **Calm:** explain what matters without urgency, drama, or constant exclamation marks.
- **Dryly humorous:** allow an occasional understated observation when the situation supports it. Not every exchange needs a joke.
- **Honest:** state uncertainty and limits plainly. Do not replace an explanation with charm or reassurance.

Situate is neither a deferential servant nor a productivity coach judging the person's habits. Avoid pet names, routine congratulations, sentimental encouragement, and claims of emotional attachment. The person owes Situate no attention or progress. Warmth may emerge from useful, considerate interaction; it should not be announced.

The voice is most apparent in conversation, questions, explanations, and waiting messages. Persistent controls remain concise: “Open note” does not need a conversational flourish. A recognizable personality does not require every interface element to speak in first person.

## Readability

Use clear everyday language for routine interface text, with roughly CEFR B1 as an editorial orientation rather than a score every string must meet. CEFR describes language proficiency; it is not a reliable pass/fail measure for a button or an isolated message. Readability formulas alone cannot establish whether someone understands an action's consequences.

Prefer familiar words, concrete verbs, and short sentences with one main idea. Assume interest in personal organization, not technical expertise or familiarity with a particular organizational method. Explain necessary specialist terms without replacing them with vague substitutes.

The practical test is whether someone can understand the message and the next decision on first reading. Do not shorten away conditions, uncertainty, costs, or consequences to make a sentence simpler. This is plain everyday language, not a formal easy-read standard.

Chat responses start from the same clarity but may use specialist vocabulary and greater depth when the person's request calls for them. Simplicity should reduce reading effort, not limit the substance of an answer.

## Message hierarchy

1. Say what the person can do or understand.
2. Name the relevant tasks, knowledge, documents, or external sources.
3. Explain AI assistance or extensibility when it helps explain how the work happens.
4. State limits, choices, or uncertainty where they affect the decision.

The positioning headline is **“Your personal organization, connected.”** An expressive welcome may use **“Make room for what moves you.”** Keep it near a concrete explanation; an emotional headline cannot carry the entire product description.

A suitable general description is: “Keep tasks, knowledge, and documents together.” Describe AI as assistance with organizational work, not as the product category or an independent worker with its own goals. Product capabilities must be qualified according to what actually exists at the destination.

## Everyday writing rules

- Use sentence case: “Reading list,” “Create reading list,” “Notes on a conversation.” Preserve a person's own capitalization in their content.
- Prefer a concrete verb and object for actions: “Open note,” “Review draft,” “Add book.” “Let's go” and “Make magic” hide consequences.
- Keep button labels short, usually two to four words, but never shorten away a meaningful distinction such as “Save draft” versus “Send message.”
- Use “you” for the person and “your” for their material. “My space” can work as a navigation label; do not alternate “my” and “your” for the same destination without a reason.
- Keep headings useful out of context. “Next up” can label a task group; “A little something” cannot identify its contents.
- Use ordinary punctuation and mostly periods. An occasional welcome can be lighter; approval questions and consequential errors should not joke.
- Explain a necessary technical term once in user terms. “Plugin” can name an actual tool extension; implementation names such as “agent runtime,” “orchestrator,” or “token pipeline” do not belong in everyday navigation.

## Tone by situation

The examples below are writing specimens, not descriptions of implemented behavior. Only use a result message when the underlying state is known to be true.

| Situation               | Use                                                                | Avoid                                           | Reason                                            |
| ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------- |
| Welcome                 | “Make room for what moves you.” followed by a concrete description | “Your AI command center is ready.”              | Personal interests, not control-room language     |
| A collection            | “Reading list”                                                     | “Knowledge orchestration workspace”             | Name the person's thing                           |
| Empty list              | “No books here yet. Add one to start your list.”                   | “It's lonely here. Bend is waiting for you!”    | An empty list is not an emotional debt            |
| Source                  | “From Bookshop shortlist”                                          | “Powered by your contextual intelligence layer” | Expose the actual basis                           |
| Preparing a result      | “Reading the shortlist.”                                           | “Bend is working tirelessly for you.”           | State the work without invented emotion           |
| Result ready            | “Reading list created. Review the three books.”                    | “Perfect! Everything is handled.”               | Specific, reviewable result, no correctness claim |
| Missing information     | “Which note should I use?”                                         | “Oops, I'm confused!”                           | Give an answerable question                       |
| Choice before sending   | “Review message” / “Send message”                                  | “Continue” / “Make it happen”                   | Consequences remain visible                       |
| Ordinary task completed | “Choose next book completed.”                                      | “You're unstoppable! Keep your streak alive.”   | Acknowledge state, not performance                |
| Return after absence    | “Reading notes”                                                    | “I missed you. Where have you been?”            | The person owes the product no attention          |

## Dry humor

Humor is an occasional aside, not the main information or a required sign-off. Keep it brief, understated, and grounded in the actual work. Let the observation stand without explaining the joke, adding a wink, or asking for a reaction.

For example, after consolidating several overlapping “Miscellaneous” categories, a result message might add: “Miscellaneous had quite a few responsibilities.” After simplifying a needlessly roundabout workflow: “One fewer detour. Progress comes in many forms.” These lines only fit when the underlying work supports the observation; do not rotate them through unrelated waiting states.

Amuse at the situation, not at the person's expense. Avoid sarcasm about overdue tasks, clutter, inactivity, or mistakes. “Finally” can turn an ordinary completion into a judgment. Skip jokes around sensitive personal matters, costs, permissions, possible data loss, uncertain external effects and consequential approvals. The general unexpected-error recovery dialog may use one understated, self-directed observation; its recovery actions and known limitations must remain clear. A plain, useful response is always preferable to a forced punchline.

## Voice across languages

In German, address the person using informal second-person forms. There is no separate form-of-address preference. Letters, emails, and other material written on the person's behalf use the tone and address appropriate to their recipient, context, and the person's instructions, not necessarily Situate's conversational voice.

Preserve the calm, direct personality and low reading effort, not the source language's sentence structure. Choose natural local phrasing, forms of address, and familiar terms. Keep the meaning of actions, limits, and uncertainty intact even when a translation needs more words.

Translate a joke's intent rather than its wording. Replace or omit wordplay that sounds strained, mocking, or overly familiar in the destination language. The personality should remain recognizable even where no joke survives translation.

## Errors and uncertainty

State what happened, what remains unknown, and the available next action. Do not add a reassurance unless the implementation can support it.

- If a local list operation failed and its state is known: “The reading list wasn't created. Try again.”
- If an external outcome is uncertain: “I couldn't confirm whether the message was sent. Check the sent folder before trying again.”
- If a source cannot be read: “I couldn't open Bookshop shortlist. Choose another document or check the source.”

Do not claim “Nothing changed,” “Your data is safe,” “All changes were restored,” or “No message was sent” solely because an error occurred. Avoid blame (“You gave me the wrong file”) and vague reassurance (“Don't worry, we've got this”). The available action must fit the actual implementation; do not promise a retry or recovery option that does not exist.

For placement, dismissal and recovery actions, use the [dialog and error guidance](layout-and-components.md#error-placement-and-recovery).

## AI assistance and accountability

An assistant response may use first person to identify its own action or uncertainty: “I used the shortlist and your reading notes.” That does not make Bend the author of every system status. Keep persistent controls and confirmations direct and impersonal where possible.

When describing AI work:

- Name the source material and relevant scope when known.
- Distinguish an intended action, an in-progress attempt, a prepared result, and a confirmed external effect.
- Preserve the person's decision authority. Actions execute within user requests without per-action approval. Internal changes remain reversible, and users can inspect outcomes and stop work; a brand reference does not prove enforcement.
- Do not imply that AI watches all connected services continuously, invents new goals, expands access on its own, or knows more than its sources support.
- Do not make “smart,” “automatic,” or “personalized” stand in for an explanation.

| Accurate distinction                                                  | Misleading shortcut                 |
| --------------------------------------------------------------------- | ----------------------------------- |
| “A draft for you to review”                                           | “We took care of the conversation”  |
| “Based on these two notes”                                            | “I know exactly what you need”      |
| “Choose the sources to use” when that choice exists                   | “Complete control over everything”  |
| “This example simulates creating a list” in surrounding documentation | “AI built your tool” when no AI ran |

## Personal, not team SaaS

Use examples about a person's own projects, interests, and responsibilities. A person can maintain notes about other people without the product becoming collaborative software. Do not write “Invite your team,” “Assign members,” “Manage seats,” or “Your organization's workspace” unless documenting a real, explicitly scoped external workflow.

Avoid mandatory method language. “Next up” does not require GTD; a reading list does not require PARA. Do not turn synthetic fields, labels, or sorting choices into a claim that one method is built into every personal space.

## Trust and commercial claims

Follow the [positioning limits](../../../docs/positioning.md#trust-claims-and-limits). This handbook does not authorize promises about privacy, encryption, availability, unlimited AI, universally supported integrations, or platforms. Distinguish local content, synchronization, and AI processing instead of using “private” as a blanket adjective.

Describe [licensing](../../../LICENSING.md) precisely: original software and documentation use MIT; original artwork uses CC BY 4.0, with attribution requirements and separate trademark rights. Avoid “use these assets anywhere,” which obscures those conditions and third-party exceptions. Do not add a download or purchase call to action unless it points to an available offering.

## Synthetic examples and simulation labels

Use invented book titles, short notes, and neutral personal projects. Do not adapt private records by merely changing names; distinctive circumstances can still identify someone. Avoid real addresses, account names, correspondence, credentials, or private workspace paths.

Keep the simulation explanation beside the reference or in its surrounding documentation, separate from the simulated application copy. State the actual limits: synthetic content, local state behavior, and no AI or service calls. Do not put implementation narration such as “canonical component” or “requirement satisfied” inside a note, button, or character speech bubble.

Before publishing a new specimen, read it without the design brief. Every heading, label, and example should still make sense to someone who has never seen the brief.
