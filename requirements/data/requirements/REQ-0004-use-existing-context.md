---
id: REQ-0004
type: requirement
title: Use existing context directly when handling user requests
status: approved
priority: must
area: Personal organization
goals: [GOAL-0001, GOAL-0002]
---

## Description

For an assigned organizational process, Situate must directly consider available, relevant and authorized context. This includes personal notes, related correspondence and an existing process history within the current workspace and its authorized connections. Content from another workspace is not automatically searched or used; [workspace independence](REQ-0037-keep-workspaces-independent.md) permits explicitly developed cross-workspace plugins without implying automatic sharing. Users must not have to explain previously documented information again or routinely confirm the known state.

The agent may independently read local files in the current workspace, including past chats and process histories, without user attachment, per-file permission or dedicated Situate restrictions on those reads. Situate does not add a special incentive or prompt to inspect history. Choosing relevant context remains part of agent and model judgment, not a mandate for proactive history retrieval, a history index or a separate history-memory pipeline. Existing model-access and [privacy rules](../foundations.md#hosting-and-data-processing) remain in force; local read access does not authorize unrestricted transmission of the workspace to a model provider.

The assistant must be able to use the same configured document collection and [content search](REQ-0055-search-document-content.md) as the document view. Users can ask content questions and receive answers with traceable document sources and access to the original where reachable. A filing-and-response workflow can use a stored attachment to prepare an email draft; source filing follows [document connectors](REQ-0054-connect-document-sources.md), and sending remains subject to approval. Document search preparation does not introduce a proactive chat-history retrieval mandate.

Gaps and contradictions that need resolution for processing must be clarified with targeted questions to the user. Direct use of context does not authorize work outside the user's request or configured account access.

## Rationale

Reconstructing and explaining an ongoing process again takes time and mental effort. Existing context should contribute directly to a prepared result.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: explicit request to use existing context directly rather than reconfirm the current state; subsequent confirmation as a must-have requirement alongside process history and storage control.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. Automatic context use was bounded to the current workspace and its connections.

Private agent lifecycle clarification; date not recorded, not publicly available. Independent reading of current-workspace files, chats and histories was confirmed without per-file permission, dedicated read restrictions or special history-inspection prompting; workspace, approval and model/privacy boundaries remain unchanged.

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Cross-source document access, search and document workflows were confirmed without requiring migration of originals.

## Acceptance criteria

- For a new message about a documented process, Situate considers relevant available notes and correspondence without requiring routine confirmation of the entire previous state.
- Information in an available process history can be used for subsequent work without the user entering it again.
- The agent can read current-workspace local files, including past chats and process histories, without attaching them or requesting permission per file; Situate adds neither dedicated restrictions on these reads nor a special incentive or prompt to inspect history.
- This access does not bypass model-provider privacy rules or authorize unrestricted transmission of the workspace.
- Opening another workspace does not automatically make its notes, chats or connections context for the current workspace.
- If necessary information is missing or contradictory, Situate asks targeted questions rather than requiring the user to describe the entire process again.
- Actions derived from existing context execute within the user's request without per-action approval.
- The assistant can find relevant documents through the same collection used by the document view and answer content questions with traceable source references.
- Users can navigate from a document-based answer to its original when reachable; an unavailable original is identified rather than presented as accessible.
- A requested workflow can use a filed document's content to prepare a response without automatically sending it.

## Open questions

- How should users be shown uncertainty about context relevance and freshness beyond the document availability and refresh states in [REQ-0056](REQ-0056-refresh-document-collection.md)?
- What reference granularity and verification criteria are needed for document-based answers?
- How are conflicting sources weighted, and when is a follow-up question required?
