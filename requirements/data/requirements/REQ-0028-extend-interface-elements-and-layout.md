---
id: REQ-0028
type: requirement
title: Extend interface elements and layout through plugins
status: approved
priority: should
area: Integrations
goals: [GOAL-0005]
---

## Description

Plugins should be able to add their own interface elements to Situate and change the arrangement of existing interface elements. These capabilities should extend beyond the contents of a plugin's own view, allowing users to adapt the surrounding application interface to their working methods through extension points without changing Situate's core application code.

This complements [plugin-defined views](REQ-0026-provide-plugin-defined-views.md) and [visual customization of existing views and themes](REQ-0027-customize-existing-views-and-theming.md). The [plugin platform compatibility requirement](REQ-0014-plugin-platform-compatibility.md) also applies to interface extensions. Extension capabilities do not remove the requirement to [make plugin use visible](REQ-0018-show-plugin-use.md).

## Rationale

A fixed set and arrangement of interface elements can constrain how users organize their work. Plugin-based interface extensions let users adapt the application to their own workflows rather than only change its appearance.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Adding interface elements and changing their arrangement through plugins were initially raised as possibilities and subsequently confirmed as should-have. The requested direction was a high degree of extensibility through extension hooks, with the Pi Coding Agent as a conceptual reference rather than a prescribed implementation.

## Acceptance criteria

- A plugin can add an interface element that users can access within the application interface outside a plugin-defined view.
- A plugin can change the arrangement of existing application interface elements, rather than only arrange elements within its own view.
- Both capabilities use plugin extension points without changes to Situate's core application code.

## Open questions

- Which application regions and existing interface elements must support additions or rearrangement?
- How are conflicting layout changes from multiple plugins resolved?
- How can users recover a usable layout if an extension makes navigation difficult?
- Which interface elements must remain available to preserve user control and visibility of plugin use?
