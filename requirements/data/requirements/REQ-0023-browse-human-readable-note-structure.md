---
id: REQ-0023
type: requirement
title: Keep notes independently browsable in a human-understandable structure
status: approved
priority: must
area: Personal organization
goals: [GOAL-0001, GOAL-0004]
---

## Description

Users must be able to browse and read their notes themselves within Situate, without relying on the assistant to retrieve or explain them. Notes must retain an organizational structure that people can understand and navigate, including after Situate reorganizes them.

A file view must be available by default in each workspace. Users can browse its content files and folders, open files, and create, rename, move, copy and delete files and folders without using the assistant. File operations follow the [identity rules](REQ-0035-preserve-file-and-task-identity.md); deletion retains history under [content recovery](REQ-0022-explain-note-changes.md). Markdown editing and rendered reading follow [manual file editing](REQ-0042-edit-markdown-source-and-read-rendered-content.md).

The file view opens text files internally, including source code, structured text and files without an extension. Markdown opens rendered with a source mode; other text opens as source. Binary files open in the operating system’s default application. File content determines whether it is text or binary; an extension alone is not sufficient. Read failures, size limits and unsupported text encodings are reported rather than treated as binary content. File operations and retained history still apply to binary files. Displaying an image embedded in Markdown is separate from opening that image as a standalone document. The [common document view](REQ-0058-browse-document-collection.md) adds cross-source discovery independently of this workspace file view. [Internal PDF and image previews](REQ-0059-preview-pdf-and-image-documents.md) are a should-have extension of the external-opening baseline; they do not require non-Markdown editing.

The normal file view shows user content, not technical workspace internals such as Git repositories and internal application state. The explicitly editable `.situate/working-method.md` document is the narrow exception; it does not expose the rest of `.situate/`. The initial delivery has no advanced technical-file editing view. This UI boundary does not prevent external-tool access or complete directory transfer under [REQ-0038](REQ-0038-copy-portable-workspaces.md).

No particular hierarchy or organizational method is prescribed. The structure may change when desired by the user, as described in [personal note organization](REQ-0006-preserve-personal-note-structure.md).

## Rationale

Delegating note maintenance must not turn the note collection into information that only the assistant can navigate. Direct access to an understandable organization helps users remain oriented and retain control over their notes.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. The ability to go through one's own notes and retain a structure understandable to humans was explicitly confirmed as a must-have requirement. User-desired changes to that structure remain permitted.

Private file-editor clarification conversation; date not recorded, transcript not included. The default workspace file view and manual file organization were confirmed as must-have capabilities.

Private file-editor specification clarification, 2026-10-04; transcript not included. The initial delivery opens only Markdown internally, delegates other formats to external applications, and excludes technical workspace internals from the normal file view.

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Internal PDF and image previews were confirmed as a should-have extension.

## Acceptance criteria

- Users can browse the organization of their notes and open and read notes without asking the assistant to retrieve them.
- Users can identify where a note belongs in the organization and navigate to other notes through that organization without requiring an assistant explanation.
- After Situate reorganizes notes, users can still browse and read them through the resulting structure.
- A workspace provides a file-and-folder view without requiring the user to build a plugin or ask the assistant to retrieve content.
- Users can create, rename, move, copy and delete content files and folders, and open files from that view.
- These operations preserve or create identities and update known references as specified in REQ-0035; deleting content does not discard its retained history.
- Both workspace browsing and plugin source inspection use the same file explorer and opening behavior: Markdown is rendered internally, other text is displayed internally as source, and binary files use the default external application. Plugin inspection remains read-only.
- Extensionless text and text with an unexpected extension open internally. Binary content with a text extension is not displayed or edited as text.
- An unavailable external handler, denied access or unreadable file is reported rather than presented as a successful opening.
- Non-Markdown files remain available for ordinary file operations and history even without an internal preview.
- Technical workspace internals are not displayed or editable in the normal file view, except `.situate/working-method.md`; there is no advanced technical-file view in the initial delivery.

## Open questions

- Which platform-specific handoff mechanisms and availability errors are needed for opening content in external applications?
- Which representative note collections, organizational methods and navigation tasks should be used to evaluate whether the structure is understandable to users?
