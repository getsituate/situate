# Situate — Product Capability Catalog

Documentation date: **9 November 2026**.

Use Situate to turn information into notes, task updates, email drafts, calendar actions and reusable tools. This catalog describes the results you can work toward with Situate, the conditions for each capability and the evidence behind its support status.

## Functional areas

| Area                                  | What you can do and use afterward                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Notes](notes.md)                     | Develop thoughts, find information and revise or combine notes. Keep the result in chat or save usable text in workspace files.                       |
| [Task management](task-management.md) | Capture and update tasks, organize work and discuss priorities or blockers. Get a reasoned overview or saved changes to task files.                   |
| [Email](email.md)                     | Understand correspondence, find messages, save drafts, organize mail and send requested messages through the assumed working Gmail connection.        |
| [Calendar](calendar.md)               | Find suitable times, check conflicts and create or change events through the assumed working Google Calendar connection.                              |
| [Documents](documents.md)             | **Not supported today; tentative future target.** The desired results include understanding, creating, revising and organizing documents.             |
| [Plugins](plugins.md)                 | Develop callable tools, service connections, individual views and working-method guidance. Each extension has its own access and platform conditions. |

Read the [complete Markdown reading edition](Situate-Product-Capability-Catalog.md) for all six areas in one file.

## How to read the entries

Start with a capability's **Benefit**, then its **Support**, **Prerequisites and limits**, and **Evidence**. A proposal in chat, a saved file and an action in an external account are different results; the entry says which one is covered.

Normal work includes questions, suggestions, choosing between alternatives and several search, reading or editing steps. **Supported** does not mean one instruction must succeed without further input. Support and the strength of the evidence are separate: an executable path can be established by code analysis without a live-model trial.

The [shared prerequisites](#shared-prerequisites-and-boundaries), [email/calendar connector scope](#email-and-calendar-connector-scope) and [status legend](#status-and-evidence-legend) apply alongside each area's conditions. Use the [named capability index](#area-and-identifier-index) to find a specific entry. Its **44 descriptions** include unsupported targets; this is not a count of available product functions.

## Shared prerequisites and boundaries

- AI work needs configured, working model access. Content must be supplied or retrieved through accessible tools; its presence in a workspace or account does not by itself put it in the conversation.
- Saving or changing a file requires writable storage and a successful operation. A chat answer claiming that something was saved, sent or changed is not evidence that the action occurred.
- Search results, file reads and retained conversation context are bounded. Several steps can locate a particular answer. A complete inventory or collection-wide conclusion additionally needs a defined scope, sufficient coverage and current sources. Model judgments, citations and calculations still need appropriate review.
- Imported files are local copies. Editing a copy does not update its external original. External-source access has its own assessment unless explicitly assumed below.
- Workflows start on request and require the application and workspace to remain open. Hiding a view does not stop running work; closing the workspace or application does.
- Plugins are trusted code, not adversarially sandboxed programs. The reviewed runtime can perform external actions without per-action confirmation. An interrupted action may have an unknown outcome; establish the external state before deciding whether to retry.
- Functional areas are not workspaces. Workspaces separate environments such as private and professional life; the catalog does not imply shared context or operations across them.

### Email and calendar connector scope

**Situate does not supply a native email-service or calendar-service connector.** For every entry in [Email](email.md) and [Calendar](calendar.md), assume an already working, configured, enabled and authenticated **Gmail** or **Google Calendar** plugin connector, respectively, with full required permissions and callable operations. Calendar-related email communication uses the same Gmail assumption. The area introductions specify the operations covered. Full account permissions do not grant access to other people's unshared calendars.

This is a stipulated prerequisite, not an executed connection, login or account test. Capabilities are stated directly under that fulfilled scope; the absence of a bundled connector does not lower their ratings. Situate's own execution limits still apply. [P01](plugins.md#p01--connect-new-data-sources) instead assesses developing a connection without assuming that it already works.

## Status and evidence legend

| Support status                         | Meaning within the entry's stated scope                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supported**                          | Suitable evidence establishes an executable workflow through which the described result can be achieved within the stated scope. Dialogue, choices between suggestions and multiple steps may be part of that workflow.         |
| **Partially supported**                | A useful subset is established, but an essential part of the described result is unavailable or evidenced recurring difficulties prevent it under ordinary conditions. The entry must identify that part and the usable subset. |
| **Not supported at reviewed revision** | Absence is established by evidence or an explicit product specification. Missing evidence alone is insufficient.                                                                                                                |
| **Unclear**                            | The available evidence does not establish whether the described result is reachable in the stated scope. The entry identifies the unresolved question.                                                                          |

A clarification question or a choice between suggestions is part of collaboration, not a limitation. Situate must contribute substantially rather than hand the essential work back to the user, but a substantial contribution alone is not enough for **Supported** if an essential part of the result remains unreachable. Missing proof for every edge case, unlimited collections, exhaustive search or perfect model answers does not by itself justify **Partially supported**. Where completeness is part of the requested result, the coverage limits still matter.

These values are independent of requirement approval, release qualification and evidence type. Current support and tentative targets remain distinct. Entries name different platform or source assessments explicitly rather than applying one rating to every variant.

Evidence types are **Product specification**, **Code analysis**, **Synthetic check**, **Executed product workflow**, **User report** and **Assumption**. Code analysis can establish an executable workflow; general model ability alone cannot. A synthetic component check is not a live account or model workflow, and reading test sources is not executing them. User reports retain their product version and scope. Evidence labels such as R1 are local to their area.

## Product revision and scope

The assessed product is the **main application**, `client/app/` and `client/crates/`, at commit `27b6831c3e55b2de4a59d6cd32cf1935d373338d` on `use-case-validation` (5 November 2026). The documentation date is not a new product version or test date. No released version is claimed. [Documents](documents.md) records current non-support and a tentative future target from the product-owner specification dated 9 November 2026.

**Current product scope is macOS only; iOS is deferred and is not currently supported.** The recorded assessment below covers macOS and iOS separately; its earlier iOS analysis and simulator results are retained evidence, not an active support or delivery commitment. Notes primarily cover macOS internal text notes; task management covers writable macOS and application-local iOS workspaces. Email and calendar use the shared conversation/plugin path under the connector scope above. Plugin evidence includes native macOS and limited iOS simulator records. These scopes do not establish general native workflow parity or physical-device qualification. Historical prototype and synthetic workshop behavior are not main-application evidence.

The area evidence sections identify report dates, source locations and recorded checks. Note, task and email reports have no stated investigation date; the calendar report is dated 7 November and the plugin report 6 November 2026. Recorded test results are attributed to those sources, not to this documentation revision.

## Open records and scope distinctions

- **Notes and email retrieval:** N03 uses literal workspace searches, folder inspection and model-led reading. E03 uses the stipulated Gmail operations and message metadata. Both cover finding requested information through successive steps, not proving that every relevant item was found. Their source and access conditions remain different.
- **Documents and attachments:** E01's use of suitable attachment readers does not establish D01–D08 document support.
- **Connections:** P01 covers developing a usable connection through accessible interfaces; E01–E07 and K01–K07 begin with a working connector. Authorization and operations for a particular new service still need to be established for that service.
- **Personal guidance:** P05's enabled plugin guidance, K07's central working-method instruction and E02's explicitly read style file are distinct ways to supply context, not a promise that arbitrary files load automatically.
- **Custom collections:** [P06](plugins.md#p06--create-custom-information-structures) covers developing a collection whose fields, records and relationships can be saved and edited through plugin functions and views. Field validation and relationship rules belong to that plugin, not a shared collection model. Practical usability and rule correctness remain specific to the resulting plugin.

Other open evidence questions concern original Apple Notes access and native note workflows; external task write-back and blocked native-host task checks; attachment-format coverage, quantitative reproducibility and model interpretation; calendar edge cases; and plugin-specific account access and native iOS suitability. The area files describe these limits without turning them into delivery commitments.

## Area and identifier index

Each linked entry owns its benefit, support assessment and evidence.

### Notes

- [N01 — Develop thoughts](notes.md#n01--develop-thoughts)
- [N02 — Place content appropriately](notes.md#n02--place-content-appropriately)
- [N03 — Retrieve content](notes.md#n03--retrieve-content)
- [N04 — Answer questions about notes](notes.md#n04--answer-questions-about-notes)
- [N05 — Condense content](notes.md#n05--condense-content)
- [N06 — Compare and combine](notes.md#n06--compare-and-combine)
- [N07 — Identify patterns and connections](notes.md#n07--identify-patterns-and-connections)
- [N08 — Transform content](notes.md#n08--transform-content)
- [N09 — Continue and revise notes](notes.md#n09--continue-and-revise-notes)
- [N10 — Organize the collection](notes.md#n10--organize-the-collection)

### Task management

- [A01 — Derive and capture tasks](task-management.md#a01--derive-and-capture-tasks)
- [A02 — Structure tasks](task-management.md#a02--structure-tasks)
- [A03 — Suggest priorities](task-management.md#a03--suggest-priorities)
- [A04 — Find and summarize tasks](task-management.md#a04--find-and-summarize-tasks)
- [A05 — Keep tasks current](task-management.md#a05--keep-tasks-current)
- [A07 — Identify dependencies and blockers](task-management.md#a07--identify-dependencies-and-blockers)

### Email

- [E01 — Understand emails and conversation threads](email.md#e01--understand-emails-and-conversation-threads)
- [E02 — Compose emails](email.md#e02--compose-emails)
- [E03 — Find information in the email collection](email.md#e03--find-information-in-the-email-collection)
- [E04 — Organize the mailbox](email.md#e04--organize-the-mailbox)
- [E05 — Send and forward emails](email.md#e05--send-and-forward-emails)
- [E06 — Follow up open correspondence](email.md#e06--follow-up-open-correspondence)
- [E07 — Recognize communication patterns](email.md#e07--recognize-communication-patterns)

### Calendar

- [K01 — Capture events](calendar.md#k01--capture-events)
- [K02 — Find events and get an overview](calendar.md#k02--find-events-and-get-an-overview)
- [K03 — Find suitable time windows](calendar.md#k03--find-suitable-time-windows)
- [K04 — Identify conflicts and tight schedules](calendar.md#k04--identify-conflicts-and-tight-schedules)
- [K05 — Keep events up to date](calendar.md#k05--keep-events-up-to-date)
- [K06 — Recognize time distribution and patterns](calendar.md#k06--recognize-time-distribution-and-patterns)
- [K07 — Capture and apply personal calendar rules](calendar.md#k07--capture-and-apply-personal-calendar-rules)

### Documents

- [D01 — Understand documents](documents.md#d01--understand-documents)
- [D02 — Find information in documents](documents.md#d02--find-information-in-documents)
- [D03 — Create documents](documents.md#d03--create-documents)
- [D04 — Revise documents](documents.md#d04--revise-documents)
- [D05 — Compare and combine documents](documents.md#d05--compare-and-combine-documents)
- [D06 — Structure and design documents](documents.md#d06--structure-and-design-documents)
- [D07 — Organize the document collection](documents.md#d07--organize-the-document-collection)
- [D08 — Check documents against requirements](documents.md#d08--check-documents-against-requirements)

### Plugins

- [P01 — Connect new data sources](plugins.md#p01--connect-new-data-sources)
- [P02 — Develop custom tools and workflows](plugins.md#p02--develop-custom-tools-and-workflows)
- [P03 — Create individual views](plugins.md#p03--create-individual-views)
- [P04 — Evolve extensions](plugins.md#p04--evolve-extensions)
- [P05 — Store personal working methods](plugins.md#p05--store-personal-working-methods)
- [P06 — Create custom information structures](plugins.md#p06--create-custom-information-structures)

## About this catalog

This overview and the six area files are the authoritative sources. The complete reading edition is generated from them. Authoring, publication prerequisites and regeneration are covered by the [working framework](working-framework.md).

The catalog complements the [product concept](../product-concept.md), [positioning](../positioning.md) and [requirements catalog](../../requirements/README.md). Requirement approval records a product decision, not delivery. A desired capability does not promise implementation or a release date. Use cases and person- or situation-specific adaptations are outside this catalog.
