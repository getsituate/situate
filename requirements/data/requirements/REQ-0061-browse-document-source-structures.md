---
id: REQ-0061
type: requirement
title: Browse source-provided document structures
status: approved
priority: should
area: Document management
goals: [GOAL-0001]
---

## Description

Deferred from initial delivery under [document source navigation](../foundations.md#deferred-document-source-navigation). The behavior below remains an approved should-have; a concrete user need must be established before revisiting delivery.

Where a connector exposes the source's organizational structure, Situate should offer it as supplementary navigation. A folder-based source can retain its folder navigation without requiring every other source to become a folder tree. The common [tag-based document view](REQ-0058-browse-document-collection.md) remains usable independently of this capability.

## Rationale

Users can orient themselves using familiar source organization without sacrificing a common cross-source document view.

## Source

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Product decisions, not evidence of prevalence or measured performance.

Private document-navigation scope clarification; date not recorded, transcript not included. Source-specific lists, folder filters and source structures are deferred; this does not reject the capability or change connection setup and processing boundaries.

## Acceptance criteria

- Users can navigate an organizational structure exposed by a capable connector and inspect its included documents.
- A source without an exposed hierarchy remains usable through the common collection.
- Browsing source structure does not expose documents outside the integration's agreed subset or require a synthetic universal folder tree.

## Open questions

- Which recurring document-finding task cannot be adequately served by the common collection, content search and tags, and would justify source navigation?

- Which non-folder source structures should be represented, and how are connector navigation capabilities declared?
