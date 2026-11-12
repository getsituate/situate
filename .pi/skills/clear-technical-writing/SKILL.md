---
name: clear-technical-writing
description: "Write, revise, or review technical documentation in clear language while preserving technical accuracy. Use for simplifying developer documentation, explaining difficult concepts, improving architecture guides, tutorials, how-to guides, and API references, or auditing documentation for readability and missing context."
metadata:
  version: "1.0.0"
---

# Clear technical writing

Make technical documentation easier to understand without weakening its meaning. Improve both the language and the explanation: short sentences cannot repair missing context or an unexplained concept.

## 1. Establish the writing contract

Identify the reader, their prior knowledge, the document's purpose, language, and scope. Follow repository instructions and the explicit brief.

Unless the brief says otherwise, write for a technically experienced reader who is new to this project. Assume general development knowledge, not knowledge of internal names, components, or decisions. Preserve the document's language unless translation is requested. Do not equate clear language with writing for children.

Identify the dominant purpose of the affected section:

| Type        | Reader need                       | Prioritize                                                               |
| ----------- | --------------------------------- | ------------------------------------------------------------------------ |
| Tutorial    | Learn through a guided experience | Small steps, safe prerequisites, observable intermediate results         |
| How-to      | Complete a specific task          | Preconditions, ordered actions, expected results, relevant failure cases |
| Reference   | Look up exact information         | Stable terms, complete constraints, predictable structure                |
| Explanation | Understand a concept or decision  | Purpose, mechanism, relationships, rationale, trade-offs and limits      |

Use this distinction to guide local edits, not to impose a new site structure. Do not turn a reference into a tutorial or insert extensive background into every procedure.

If no text, file, or topic was supplied, ask for one. Ask about the audience only when a reasonable assumption would materially change the result.

## 2. Read and protect the meaning

For revisions, read the complete affected passage and enough surrounding context to resolve its terms and references. Inspect linked definitions or relevant source code when needed and authorized; do not scan unrelated material.

For new documentation, establish the factual basis from supplied requirements, source code, authoritative references, or verified behavior before drafting. Distinguish current behavior from proposals and requirements.

Keep a working record of the facts that must survive:

- Actors, actions, causes, ownership, ordering, and lifecycle boundaries.
- Preconditions, exceptions, negation, quantifiers, defaults, units, and limits.
- Guarantees, uncertainty, attribution, and normative strength: must, should, may.
- Public identifiers, technical terms, commands, code, URLs, citations, stable IDs, anchors, and required notices.

Keep this working record out of the finished document. Preserve code and commands unless the user requested changes to them or a verified correction is within scope. Do not silently change interfaces or product behavior to make an explanation easier.

## 3. Diagnose two kinds of difficulty

Before rewriting, identify concrete problems:

**Language:** noun-heavy phrases, hidden actors, nested clauses, vague pronouns, unnecessary words, inconsistent terminology, or an abstract heading that obscures the topic.

**Explanation:** an undefined project term, missing prerequisite, a concept used before introduction, an unexplained relationship, a jump in reasoning, or an instruction without enough information to recognize success.

Preserve passages that already work. Do not rewrite merely to demonstrate activity.

Read [examples.md](references/examples.md) when first applying this skill or when the appropriate edit is unclear.

## 4. Revise the explanation and the language

### Build understanding

- Introduce unfamiliar project concepts before relying on them. Define a term at its first relevant use or link to a suitable existing definition.
- In concept explanations, usually move from the problem or purpose to the basic mechanism, then a small example, then details and limits. Adapt this sequence to the reader's actual question; it is not a mandatory heading template.
- Make supported relationships explicit: who calls whom, where data lives, what triggers a change, or why a constraint matters.
- Use the smallest example that clarifies the mechanism. Examples must match established behavior. Synthetic values are acceptable; invented API names, defaults, guarantees, or design rationales are not.
- Use analogies sparingly. State their limits when they could imply false properties; prefer a direct technical example when it is clearer.
- Keep optional depth separate or link to it. Do not remove necessary qualifications for brevity.
- If the source does not establish a needed explanation, consult an authorized source or report the gap separately. Never fill it with a plausible story.

### Reduce reading effort

- Prefer direct verbs and concrete subjects: say who does what.
- Give each sentence a clear main point. Split overloaded sentences without losing conditions, causal links, or exceptions.
- Replace unnecessary complexity, not necessary terminology. Explain a precise technical term rather than replacing it with a vague synonym.
- Use one term consistently for one concept. Do not rotate synonyms for variety.
- Prefer familiar words where they have the same meaning. Remove empty introductions and phrases such as "it is important to note that."
- Keep passive voice when the actor is unknown, irrelevant, or less important than the result. Never guess an actor just to make a sentence active.
- Keep paragraphs focused. Use numbered lists for ordered steps, bullets for parallel items, and tables for genuine comparisons.
- In instructions, state a relevant condition before the action and include expected results where supported.
- Preserve logical connections and natural flow. Do not replace a coherent paragraph with disconnected short sentences.
- Do not add enthusiasm, slang, rhetorical questions, or claims that a task is "easy" to make documentation approachable.

No fixed sentence-length ceiling, reading-grade target, word blacklist, or percentage reduction is an acceptance criterion. A necessary definition may make the document longer and easier to understand.

## 5. Run two separate checks

### Technical fidelity

Compare the revision against the source and the protected facts. Check specifically for information added, deleted, or changed:

- Did a conditional action become unconditional?
- Did may become will, should become must, or an attempted operation become a guarantee?
- Did a reason, actor, ordering, scope boundary, or capability appear without evidence?
- Did an exception, warning, limitation, or necessary technical term disappear?
- Do identifiers, links, anchors, code, and commands still match?

For new text, trace each product-specific claim to the established factual basis. Fix discrepancies before delivery; report unresolved factual gaps separately.

### Reader comprehension

Read from the target reader's perspective:

- Can the reader state what the concept is for and how its main parts relate, if this is an explanation?
- Can the reader identify prerequisites, the next action, and its expected result, if this is a procedure?
- Can the reader locate and interpret exact constraints, if this is a reference?
- Are unfamiliar terms introduced and pronoun references unambiguous?
- Does understanding depend on project knowledge the reader was not given?

Treat these questions as a review, not proof of actual reader understanding. Readability scores and model self-review are aids, not substitutes for factual review or testing with readers. If a humanizer pass is requested, run both checks again afterward.

## 6. Deliver in the requested mode

- **Pasted text:** Return the revision without a preamble. Add a short separate note only for unresolved gaps or consequential ambiguity.
- **File edit:** Make scoped edits and briefly report changed files, checks, and blockers. Preserve unrelated work.
- **New documentation:** Produce the requested document from verified facts; keep research notes and editing commentary out of it.
- **Review only:** Do not rewrite files. Report specific passages, the comprehension problem, and a suggested correction, ordered by impact.

Do not insert explanations of this workflow or quality claims into the documentation. Do not automatically run another writing skill; a voice edit is optional, not a dependency.

For evidence or methodology questions, read [research.md](references/research.md). For evaluating changes to this skill, use [evaluation.md](references/evaluation.md).
