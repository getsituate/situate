---
id: REQ-0027
type: requirement
title: Customize existing views and theming through plugins
status: approved
priority: should
area: Integrations
goals: [GOAL-0005]
---

## Description

Plugins should be able to change the visual presentation of existing Situate views, including views used to browse or inspect files. Plugins should also be able to customize the application's theme. These capabilities should allow plugin-defined changes rather than only selection among built-in appearances, without changing Situate's core application code.

This concerns existing presentations rather than [separate plugin-defined views](REQ-0026-provide-plugin-defined-views.md). Adding interface elements and changing their arrangement are covered by [REQ-0028](REQ-0028-extend-interface-elements-and-layout.md). The [plugin platform compatibility requirement](REQ-0014-plugin-platform-compatibility.md) also applies to visual customization.

## Rationale

Built-in presentations and themes may not reflect a user's preferred way of viewing information or personal style. Allowing plugins to change them supports a system that feels personally fitting without requiring a separate replacement view for every customization.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Changes to existing visual presentations, with file views as an example, and plugin-controlled theming were explicitly requested and classified as should-have. Broad extension opportunities, rather than only preset themes, were requested with the Pi Coding Agent as a conceptual reference.

## Acceptance criteria

- A plugin can visibly change the presentation of an existing file view within Situate, rather than only provide a separate view.
- A plugin can apply a theme customization that is not one of Situate's built-in appearance presets.
- Both kinds of customization use plugin extension points without changes to Situate's core application code.

## Open questions

- Which existing views and visual properties must be customizable beyond the file-view example?
- How are overlapping customizations from multiple plugins resolved?
- How do users enable, disable and restore visual customizations?
- Which accessibility and readability boundaries must customizations preserve?
