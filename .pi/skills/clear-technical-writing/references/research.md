# Research basis and limits

## Audience and sentence-level clarity

Google's technical writing course recommends defining the reader's knowledge and the information they need, explaining unfamiliar project terminology, focusing sentences on a main idea, and removing unnecessary wording.

- [Audience](https://developers.google.com/tech-writing/one/audience)
- [Short sentences](https://developers.google.com/tech-writing/one/short-sentences)

These are practitioner guidelines, not a controlled evaluation of this skill. Shorter wording is useful when it reduces reading effort; it does not by itself establish understanding.

## Different documentation needs

[Diátaxis](https://diataxis.fr/start-here/) distinguishes tutorials, how-to guides, reference, and explanation by reader need. This skill uses those distinctions to select editing priorities, not to require a new directory structure or a uniform document template.

## Factuality is separate from readability

Devaraj et al., _Evaluating Factuality in Text Simplification_, ACL 2022, study factual errors in simplification datasets and model outputs. They distinguish problems involving inserted, deleted, and substituted information and find that existing simplification metrics do not adequately capture factuality.

Source: https://aclanthology.org/2022.acl-long.506/

This supports checking meaning separately from surface readability. It is not an evaluation of current coding assistants or this skill.

## Revision and two perspectives on quality

Yang et al., _Two-Pronged Human Evaluation of ChatGPT Self-Correction in Radiology Report Simplification_, Findings of ACL 2024, report benefits from self-correction in their domain and use radiologists to assess correctness and laypeople to assess simplicity and comprehension.

Source: https://aclanthology.org/2024.findings-acl.279/

The separate fidelity and comprehension checks are a practical adaptation. Medical report simplification is not software documentation; these findings do not establish that the same gains transfer across models, languages, or technical domains. Model self-review can miss errors and is not independent validation.

## What remains unverified

The combined workflow has not been experimentally validated as a skill. Its usefulness must be checked against representative documents and actual reader needs. Do not claim a guaranteed readability improvement, a universal optimal sentence length, or preservation of every fact merely because the workflow was followed.
