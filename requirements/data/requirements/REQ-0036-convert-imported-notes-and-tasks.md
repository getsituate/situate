---
id: REQ-0036
type: requirement
title: Convert imported notes and tasks without losing their meaning
status: approved
priority: must
area: Personal organization
goals: [GOAL-0001, GOAL-0003]
---

## Description

Import is available in ordinary conversations, including a new conversation after setup, rather than confined to onboarding. It is agent-assisted rather than limited to a fixed catalog of prebuilt importers. The user explains where notes, tasks and documents currently live; the agent clarifies the source structure and desired transfer and writes suitable importers for the source technology as needed. Access remains subject to available APIs, export capabilities and permissions; this is not a guarantee of access to every system.

During onboarding, the initial source description and source inspection inform the working-method discussion in one retained conversation. Actual import starts only after explicit confirmation of the current working method and workspace instructions. This confirmation includes the import request already supplied in the starting brief; no repeated source interview, additional import approval, confirmation dialog or mandatory approval summary is required. The agent clarifies genuine uncertainties about scope, access or interpretation in that conversation. This does not waive source-preservation rules, credential consent or task-scope rules.

For a partial or failed import, that same chat explains what has been transferred and what remains missing or blocked. Successful copies remain usable. The user can ask questions, request another attempt or continue onboarding without importing the rest. A separate partial-result approval is not required, and continuing does not imply that remaining work succeeded.

Import leaves source data unchanged and brings copies into the workspace. Within the workspace, imported notes and tasks must be converted into Situate's Markdown representation rather than merely copied without normalization. PDF, image and other document files remain ordinary files; importing them does not universally require conversion to Markdown.

The source convention used to identify tasks must be agreed with the user. Conversion preserves note titles, body content, links and actual attachments, preserves task field meanings, and assigns fresh identities to copied tasks under [REQ-0035](REQ-0035-preserve-file-and-task-identity.md). An old task marker may be replaced by the task-ID comment. Existing Markdown is normalized as well; tasks from other formats are converted into a suitable Markdown structure without imposing a project or filing model.

Markdown files added externally are versioned without inserting file IDs or rewriting their content for reference capture. An external checkbox without a task-ID comment is not automatically recognized or enriched as a task. Recognizing tasks by an agreed source convention during import does not make that convention a universal rule for later external edits.

Import preserves existing source content and metadata, including original YAML frontmatter, unknown fields, nested mappings and lists. Attachment metadata is retained alongside actual attachment files, their names and working links. Situate's file-reference model uses Git history rather than added identity or provenance fields. Temporary conversion mappings may exist during the active import and are removed after acknowledged completion.

Import conversion prepares content; general versioned write/edit operations publish it, with bounded batch creation for multiple prepared files. Shared native task-copy preparation generates fresh task IDs and retargets recognized task-identity links between copies while preserving other source bytes. Creation protects existing destinations; corrections check the current destination revision. Batch results distinguish verified published files from missing or uncertain effects without promising an all-or-nothing transaction or automatically replaying uncertain writes.

Unknown file and task metadata remains in its original location, with distinct field meanings retained. Malformed or unsupported metadata is reported and retained for source correction. Transformations that cannot safely preserve or regenerate task identities fail before publishing affected copies. Cancellation markers such as `[-]` retain their original representation; they must not become open tasks. When a source task state has no supported equivalent, the limitation is reported rather than assigning a different state. Once a file is in the workspace, the built-in editor provides the non-destructive warning and source-correction behavior in [REQ-0042](REQ-0042-edit-markdown-source-and-read-rendered-content.md#rendering-and-metadata).

## Rationale

Bringing existing organization into Situate should preserve its meaning and working method, rather than lose information or turn unrelated checklists into commitments.

## Source

Private content and workspace architecture clarification, 2026-09-29; not publicly available.

Private import clarification; date not recorded, not publicly available. Generic agent-assisted import, unchanged sources, workspace-local conversion and ordinary document files were confirmed.

Private file-reference and import decision, 2026-11-03; not publicly available. File UUIDs are removed, task-copy identity preparation remains native, and general publication supports import in later conversations.

Private onboarding import clarification; date not recorded, transcript not publicly available. Method-before-import ordering, contextual authorization without extra approval and conversational handling of partial results with optional continuation were confirmed.

## Acceptance criteria

- Starting from the user's description of the source, the agent establishes the source structure and desired transfer, asking questions where these are unclear before importing.
- Source inspection may precede working-method agreement, but actual onboarding import follows explicitly confirmed working instructions. The retained source brief and confirmation authorize the requested import without another source interview or approval step.
- After working-method confirmation, Open app ends guidance without cancelling an active import or labeling it complete. The same conversation, draft, substantive questions and imported results remain available in ordinary chat, with no return to a guided setup state.
- A partial or failed import is explained in the source chat with known transferred and missing scope. Successful copies remain usable, and the user can request another attempt or continue onboarding without resolving all missing content.
- Import remains available in a later ordinary chat, including a new conversation, without an active setup role or a separate import-only publication tool.
- A source is not excluded merely because it lacks a prebuilt importer; the agent can write an appropriate importer where available interfaces and permissions permit access.
- Unavailable access or insufficient permissions are surfaced rather than presented as guaranteed import support.
- Import leaves source data unchanged and creates copies in the workspace; normalization and conversion apply to those copies, not the source.
- PDF, image and other document files can be imported as ordinary files without forced Markdown conversion or stable IDs, following [REQ-0035](REQ-0035-preserve-file-and-task-identity.md).
- Before converting source tasks, Situate and the user agree which source convention identifies them.
- Import assigns fresh task IDs to recognized task copies and retargets recognized links among copies through shared native preparation; it does not add file IDs.
- Non-Markdown tasks become Markdown in a structure appropriate to the user's working method.
- Imported notes preserve their actual titles, body content, links and attachment files, including attachment names and working Markdown links.
- Single-file and batch imports preserve supplied content and metadata, including existing YAML frontmatter, unknown fields, nested mappings, lists and timestamps.
- Markdown sources without file metadata remain usable as supplied; Situate adds no file identity or provenance fields.
- Temporary conversion mappings are removed after acknowledged completion.
- Existing workspace files retain their metadata during import.
- Task metadata retains distinct field meanings rather than collapsing fields merely because they look similar.
- Conversion may replace an agreed source task marker with the task-ID comment without requiring both markers thereafter.
- An externally added Markdown file is versioned as supplied and can be referenced without content enrichment.
- An unmarked checkbox added externally remains an ordinary checkbox.
- General versioned writes and bounded batch creation publish prepared imports with destination protection, revision-checked corrections and verified partial results; uncertainty never triggers automatic replay.
- Unknown file and task metadata survives import. Malformed or unsupported metadata is reported, and transformations that cannot preserve its meaning fail safely.
- Cancelled entries retain their source representation and do not become open tasks. A source task state without a supported equivalent is reported without inventing a mapping.

## Open questions

- Which representative source technologies, formats and conventions should be covered by initial import verification without defining a fixed importer catalog?
- How should later repeated imports reconcile changes with previously imported copies?
- Which import-specific correction interactions are needed for malformed source metadata and uncertain field mappings, beyond the built-in editor's warnings?
