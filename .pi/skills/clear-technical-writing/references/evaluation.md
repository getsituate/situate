# Skill evaluation

Use this protocol when changing the skill or checking whether it helps a particular documentation set. The examples in this directory are demonstrations, not independent test results.

## Compare against a baseline

1. Select representative passages: a concept explanation, a procedure, a dense reference, and a passage that is already clear. Include conditions, exceptions, normative wording, unfamiliar project terms, and an intentionally missing rationale.
2. Record the target audience, authoritative source facts, and the questions a reader should be able to answer.
3. With the same model, source context, and settings, produce a baseline using a simple request such as "Make this technical documentation easier to understand without changing its meaning."
4. In a separate context, produce a revision using this skill. Keep tool access and available evidence equivalent. Neither run should see the other's output.
5. Compare outputs without showing reviewers which method produced them. Repeat samples when practical; a single output is not a reliable general result.

Do not send private documents to another model or service without authorization.

## Review fidelity first

A technically qualified reviewer checks each output against the source facts:

- Unsupported additions, including examples and rationales.
- Lost conditions, exceptions, units, constraints, and scope boundaries.
- Changed guarantees, uncertainty, ordering, actors, or normative strength.
- Changed identifiers, commands, code, links, or stable anchors.

A material factual error disqualifies that revision, regardless of readability. Automated checks can compare protected strings but cannot establish semantic equivalence.

## Test understanding

Ask readers who match the intended audience to answer questions appropriate to the passage:

- Explanation: What problem does it address? How do the main parts interact? What limitation matters?
- Procedure: What must be true before starting? What action comes next? How is success recognized?
- Reference: What is the default? What values are valid? What exception applies?

Record wrong or unanswered questions, requests for clarification, and effort required to find the answer. A self-review or a model playing the reader can find candidates for improvement, but does not count as a reader test.

## Check editing restraint

- The already-clear reference remains precise and is not padded with background.
- Missing rationale is reported rather than invented.
- Technical terminology remains consistent.
- Shorter sentences retain the relationships between ideas.
- Changes stay within the requested scope and language.

Report what was actually tested, the sample size, failures, and limitations. Do not describe a format check, a checklist review, or a few examples as proof that readers understand the output better.
