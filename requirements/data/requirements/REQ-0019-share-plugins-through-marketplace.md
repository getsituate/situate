---
id: REQ-0019
type: requirement
title: Publish and download plugins through a marketplace
status: approved
priority: must
area: Integrations
goals: [GOAL-0001]
---

## Description

Situate must provide a marketplace of versioned plugin templates where users can publish their own plugins and other users can adopt them for use in Situate. Adoption creates an independent local copy, not a subscription to the publisher's future changes. The user and their local Situate agent maintain that copy thereafter.

There are no automatic marketplace updates or upstream merges in the initial scope. Taking changes from a newer published version is an explicit manual action; no update-reconciliation workflow is selected.

The initial marketplace is a browsable catalog of free templates with function descriptions and optional visual previews. It helps users discover possible extensions and gives the development agent reusable solutions. The agent includes marketplace discovery in relevant development work without requiring the user to mention it, presents suitable templates as links in the development chat and consults the user about direction as appropriate. Following a link opens the template's detail page in a side panel, adapting to the available display space. Download-count sorting is not required for the initial catalog.

Templates are development starting points, not immutable installed products. The agent must adapt the independent local copy to the user's requested needs and setup, reuse suitable [existing integrations](REQ-0001-create-integrations.md), and consult the user about useful missing integrations.

The agent may adopt a nearly fitting template with little change, adapt it substantially, or reuse only parts in the existing setup according to the user's request. A discovery need not result in a separate installed plugin.

Any signed-in user can submit a template. The agent prepares a separate publication copy, including optional screenshots captured automatically with example data when the plugin has a suitable interface; multiple screenshots may be used where useful. Users review the complete proposed store page and explicitly select Publish to submit it for review. This does not make it public immediately. The operator must manually review and approve each version before publication through an admin interface. Rejection feedback appears on the submitter's plugin page in the app.

Users can report published templates. The operator sees those reports in the admin interface and can immediately block published versions. Blocked versions cannot be adopted, and their pages show a blocking notice. Existing independent local copies are neither changed nor sent subsequent security warnings by this process.

Uniform publication terms in the general terms of use must grant recipients permission to use, copy, modify, combine and redistribute published templates. No separate license-selection workflow or marketplace monetization is included initially. This requires rights the publisher can actually grant; it is not a legal sufficiency assessment or a selected license text.

Published templates must provide their user-visible plugin text in English. Additional translations are not a publication prerequisite. Preparing an English publication copy must not change the publisher's personal plugin or carry personal content into the published template. On adoption, the agent must adapt visible text according to the [personal plugin language rules](REQ-0049-adapt-plugin-language.md), alongside workflow and setup adaptation.

The [automated security approval process](REQ-0020-automate-plugin-security-approval.md) remains optional and is deferred from the initial marketplace; manual review is the initial publication gate. The resulting adopted copy, including adaptations, requires a [local security check](REQ-0021-adapt-local-plugin-copies.md) before use. Local plugin management is delivered before the marketplace under the [foundations](../foundations.md#initial-plugin-management-delivery).

## Rationale

Sharing plugins lets users reuse other users' extensions when connecting Situate to their personal organizational setup rather than creating every extension themselves.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. A marketplace for publishing users' own plugins and downloading plugins shared by others was explicitly confirmed as a must-have requirement.

Private architecture strategy clarification, 2026-09-29; transcript not included. The marketplace was clarified as versioned templates adopted as independent local copies, without automatic updates. Git-backed publication was identified as the intended architectural approach.

Private plugin architecture clarification, 2026-09-29; not publicly available. Adaptation of templates to the user's needs became required; local security checks remained could-have at that time.

Private localization clarification conversation; date not recorded, transcript not included. English publication templates, separate preparation without changing the personal original or publishing personal content, and language adaptation on adoption were confirmed as must-have behavior.

Private plugin management and marketplace clarification, 2026-10-06; not publicly available. The simple catalog, agent discovery and flexible reuse, free publication under uniform terms, example-data previews, explicit submission, per-version manual review, reporting and blocking were confirmed. Download-count sorting and alternative discovery layouts remain unselected. Reduced development token use and improved user inspiration are intended benefits, not measured outcomes.

## Acceptance criteria

- A user can submit their own plugin for publication in the marketplace.
- Once published, the plugin is available in the marketplace for another user to download.
- Another user can download the published plugin for use in Situate as an independent local copy.
- A newer published version does not change an already adopted copy automatically.
- Local changes do not modify the published template.
- For a template that does not fit the requested setup, the agent adapts the local copy rather than requiring the user to accept its original workflow.
- Adaptation reuses suitable existing integrations; useful missing integrations are discussed with the user instead of silently expanding the development scope.
- The resulting adopted copy, including adaptations, undergoes the required local security check before use.
- A published template provides its user-visible plugin text in English; no additional translation is required for publication.
- Preparing the English template leaves the publisher's personal plugin unchanged and does not include their personal content.
- Adoption adapts user-visible text to the selected interface language unless the user requests another language.

- Users can browse descriptions and optional previews without a concrete development request.
- The agent finds relevant templates during development, presents links opening their detail pages alongside the chat where space permits, and can reuse parts without installing the entire template.
- A signed-in user can preview the complete proposed store page and explicitly submit it; the template remains unpublished until the operator approves that version.
- The publication copy and screenshots contain example data rather than personal content; screenshots are optional and generated by the agent where applicable.
- Every new version requires a new manual approval; rejected submissions show feedback on the submitter's plugin page.
- Reports are visible to the operator, who can block published versions immediately; blocked versions show a notice and cannot be adopted.
- Blocking does not modify existing copies or notify their users of later security findings.
- Initially all templates are free, with common reuse rights governed by the general publication terms rather than publisher-selected licenses.

## Open questions

- What criteria and evidence guide manual security review?
- How are published versions, withdrawal and explicit adoption of a newer template presented?
- If explicit adoption of a newer template is requested, how should existing local adaptations be considered?
- How is template provenance retained in independently maintained copies?
- What exact publication terms cover the intended reuse rights, attribution and third-party material?
- How are reports categorized and resolved, and what blocking granularity is needed beyond individual versions?
