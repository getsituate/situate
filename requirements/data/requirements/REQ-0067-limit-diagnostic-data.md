---
id: REQ-0067
type: requirement
title: Exclude personal content and credentials from diagnostic logs
status: approved
priority: must
area: Diagnostics
goals: [GOAL-0006]
---

## Description

Standard diagnostic logging must record technical activity and context rather than personal content. It must exclude text input, document and conversation content, private titles and labels, revealing file paths, AI prompts and responses, tool argument and return payloads, and complete external-service request or response bodies. Technical outcomes and error codes remain recordable.

Credentials, tokens, passwords and private keys must never be included in diagnostic logs. These limits apply to application and plugin events, every log level and every logging implementation, including local files and any later external destination.

The [workspace, device and session identifiers](REQ-0064-record-client-diagnostic-events.md) support pseudonymous technical correlation. The initial diagnostic schema contains no user identifier. These technical identifiers do not authorize recording names, email addresses or other personal content. Persistent identifiers and activity patterns are not proof of anonymity; future transmission still requires a separate assessment of the actual data flow.

Interaction events must use stable, content-neutral descriptions of the control or action instead of copying private text displayed in the interface. Errors are subject to the same limits as ordinary events: a message or diagnostic object from a plugin, model or external service is not safe to record merely because it describes a failure.

Possible later bugreport attachments do not authorize personal-content capture in the initial logging scope. Decisions about any additional content and its deliberate selection remain separate from standard logging and from the still-open policy for external delivery.

## Rationale

Developers need to understand technical sequences and outcomes without making detailed logging a routine duplicate of users' personal information or credentials.

## Source

Private client-logging requirements clarification; date not recorded, transcript not publicly available. Standard exclusion of personal content, content-neutral interaction events, exclusion of AI and tool payloads, and the credential boundary were included in the agreed must-have logging scope for application and plugins.

Private client-logging architecture clarification; date not recorded, transcript not publicly available. User, device and session correlation was initially requested while retaining exclusion of personal content.

Private diagnostic workspace-identity clarification; date not recorded, transcript not publicly available. Workspace identity replaced user identity without permitting personal-content logging.

## Acceptance criteria

- In a synthetic workflow containing distinctive input text, document content, titles and paths, standard logs record the relevant actions without those personal values.
- AI and tool activity records expose call context, duration and result status without prompt, response, argument or return payloads.
- A recorded click identifies the action without copying a private document title or other content-derived control label.
- Synthetic credentials embedded in normal events or error details do not appear in the recorded output at any log level.
- Application and plugin events, including error details, satisfy the same exclusions when captured through either the local-file or a test logging implementation.

## Open questions

- Beyond the agreed workspace, device and session identifiers, which technical metadata may be recorded without revealing personal names or paths?
- What validation, omission or redaction rules should apply to free-form errors and plugin-supplied fields?
- What additional data, if any, should users be able to deliberately attach to a future diagnostic report?
