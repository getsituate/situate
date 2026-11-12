---
id: GOAL-0001
type: goal
title: Connect distributed personal organization without ongoing manual maintenance
status: approved
area: Personal organization
---

## User problem

People who consciously design their personal organization use different tools for tasks, knowledge, documents, email and calendars. They have to maintain the connections and current state across those tools themselves. The lack of connections and the associated maintenance effort were identified as the initial target audience's central problem during goal elicitation. Its prevalence and severity beyond the individual experience reported have not yet been established.

## Desired outcome

Users can treat their tasks, information and commitments as a connected personal system without continually maintaining links and current state themselves. Their preferred working method remains possible. Situate manages tasks, notes and knowledge, and documents in its own core, while connecting external email, calendar and supplementary data sources. Tasks and notes managed by Situate are brought into its core; complete migration of external sources is not required. The [foundations](../foundations.md) define this single-person scope.

Document management connects an agreed collection across sources without requiring relocation of originals. A common view and search provide access for users and the assistant, while source-specific filing rules remain configurable.

This goal concerns ongoing organization; [GOAL-0002](GOAL-0002-organizational-processes.md) covers handling specific processes.

## Success criteria

- When a process involves information from multiple systems, users do not have to manually reconstruct existing connections and transfer them between tools.
- Changes in a process can be reused in the personal organizational system without users updating the same state multiple times.
- Users can continue their preferred organizational approach rather than having to adopt another method for Situate.
- Manual maintenance effort decreases compared with the previous workflow. Baselines and the intended reduction remain to be established.

## Source

Private goal elicitation conversation; date not recorded, transcript not included. Topics: Situate as a connection between task, knowledge and document management, email and calendars; connecting existing systems rather than necessarily replacing them; emphasis on missing connections and reduced maintenance effort. The evidence is an individual account, not a validated finding about the wider target audience.

Private product-scope clarification conversation; date not recorded, transcript not included. The user confirmed an internal task, knowledge and document management core, takeover of tasks and notes, external email and calendar services, supplementary document integrations, and a single-person scope. These are product decisions, not additional evidence of prevalence.

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Cross-source document access, search and document workflows were confirmed without requiring migration of originals.

## Related requirements

- [Provide Situate on desktop and mobile platforms](../requirements/REQ-0012-platform-availability.md)
- [Update direct desktop installations with user-controlled restart](../requirements/REQ-0068-update-direct-desktop-installations.md)
- [Preserve workspace compatibility across app versions](../requirements/REQ-0069-preserve-workspace-version-compatibility.md)
- [Preserve plugin interfaces and expose minimum app versions](../requirements/REQ-0070-preserve-plugin-api-compatibility.md)
- [Support suitable desktop package managers](../requirements/REQ-0071-support-desktop-package-managers.md)

- [Use existing context, including traceable document-based answers](../requirements/REQ-0004-use-existing-context.md)
- [Connect document sources without mandatory migration](../requirements/REQ-0054-connect-document-sources.md)
- [Search document content across connected sources](../requirements/REQ-0055-search-document-content.md)
- [Refresh document information and expose availability](../requirements/REQ-0056-refresh-document-collection.md)
- [Organize and filter documents with hierarchical tags](../requirements/REQ-0057-organize-documents-with-hierarchical-tags.md)
- [Browse and filter the common document collection](../requirements/REQ-0058-browse-document-collection.md)
- [Read PDF and image documents inside Situate](../requirements/REQ-0059-preview-pdf-and-image-documents.md)
- [Save and pin document searches](../requirements/REQ-0060-save-document-searches.md)
- [Browse source-provided document structures](../requirements/REQ-0061-browse-document-source-structures.md)
- [Offer managed document storage across devices](../requirements/REQ-0062-synchronize-managed-document-storage.md)

## Open questions

- Which combinations of systems are particularly relevant to the initial target audience?
- How much manual maintenance is required today, and what reduction would users consider sufficient relief?
- Which representative source technologies, conventions and formats should be verified first for [agent-assisted import](../requirements/REQ-0036-convert-imported-notes-and-tasks.md) while preserving the user's working method, without limiting import to a fixed catalog?
- After import creates workspace-local copies and leaves sources unchanged, how should later changes be reconciled between them?
