---
id: REQ-0053
type: requirement
title: Enforce complete German and English interface translations
status: approved
priority: must
area: Interaction
goals: [GOAL-0002]
---

## Description

Continuous integration must fail when a text used by the supplied Situate interface lacks either its German or its English translation. Translation completeness is a required check before publication, not permission to routinely ship an incomplete German interface.

If a German interface text nevertheless cannot be resolved at runtime, the interface must display the corresponding English text instead of an internal translation key or an empty field. This fallback supplements, rather than replaces, the completeness check.

The check covers the [supplied interface](REQ-0047-choose-interface-language.md). Personal plugins are exempt from having to provide both languages under the [plugin language rules](REQ-0049-adapt-plugin-language.md); English marketplace publication requirements remain separate.

## Rationale

People need usable controls and messages in either supported language. A failing completeness check catches known gaps before delivery, while an English fallback provides a readable safety net for missing German text at runtime.

## Source

Private localization detail interview; date not recorded, transcript not included. Failing CI for missing supported-language texts and an additional English runtime fallback were explicitly confirmed. Priority was approved as must. CI implementation is separate from this requirement.

## Acceptance criteria

- Removing a German translation for a used supplied-interface text causes the CI completeness check to fail.
- Removing its English translation also causes the check to fail.
- Introducing a used supplied-interface text without both language versions causes the check to fail.
- Complete German and English translations satisfy the completeness check; unrelated CI checks remain independent.
- Simulating an unavailable German translation at runtime displays the matching English text, not an internal key or an empty field.
- Personal plugins are not rejected by this check merely because they provide only their user's chosen language.

## Open questions

- What user-visible behavior applies if both the selected translation and its English fallback are unexpectedly unavailable at runtime?
