---
id: REQ-0069
type: requirement
title: Preserve workspace compatibility across app versions
status: approved
priority: must
area: Platforms and synchronization
goals: [GOAL-0001]
---

## Description

By default, app releases must preserve mixed-version workspace use for at least six months from the publication of each supported app version. The window starts at that version's publication, not publication of its successor. This is an internal minimum compatibility policy for released versions, not an automatic expiry date.

When preserving mixed-version workspace use requires disproportionate transition effort, an explicit decision for the specific format change may permit an incompatible migration within this window. The decision must identify the affected app versions and the new minimum app version; older apps must refuse the migrated workspace safely and request an update. An app update or migration alone does not authorize this exception. It does not waive public plugin-interface compatibility under [REQ-0070](REQ-0070-preserve-plugin-api-compatibility.md).

Unless an explicit workspace-format exception applies, during that window a newer app must continue to understand data written by the older version. The older version must remain able to read and edit compatible workspace data without removing or corrupting information introduced by newer versions. New functionality need not become available in the older app. The same workspace can therefore remain in use on devices that receive or install updates at different times. [Plugin version requirements](REQ-0070-preserve-plugin-api-compatibility.md) can restrict individual plugins without making the entire workspace incompatible.

After the minimum window, a deliberate compatibility break is permitted but not required. Age alone must not block a version or workspace. If a workspace is actually incompatible with the installed app, Situate must block opening that workspace before incompatible processing or writes, explain that the app version is incompatible and ask the user to update. Other compatible workspaces remain usable.

A blocked workspace can be repaired through the [assisted repair flow](REQ-0063-start-assisted-repair-from-errors.md) without opening it for normal use or enabling incompatible plugin execution. Starting repair does not lift the block. Only a repaired state that passes compatibility verification permits normal opening again. If safe repair is unavailable in the installed app, the block remains and the prerequisite is explained, including an app update where required.

These rules govern workspace data compatibility, including changes received through [synchronization](REQ-0013-synchronization-service.md). They are internal release guidance, not a public promise of indefinite compatibility, permanently available migration paths, or a separate service API or operating-system support lifetime. [Plugin migration](REQ-0033-stage-and-activate-plugin-changes.md#data-formats-and-synchronized-changes) follows this bounded support policy; avoiding incompatibility beyond the window remains a design objective rather than an unlimited migration obligation.

Changes to published workspace formats must preserve supported data through compatible evolution or a tested migration. Migration failure or interruption must retain recoverable data and must not turn unreadable records into empty state. A migration must preserve the required mixed-version reading and writing behavior; successful opening in the new app alone is insufficient. Pre-release exceptions apply only to formats verified never to have shipped publicly.

## Rationale

Users may delay updates for months or receive releases at different times across distribution channels. Their personal system must remain usable across devices without data loss caused by routine mixed-version use.

## Source

Private application-update and compatibility clarification; date not recorded, transcript not publicly available. The behavior and must-have priority were confirmed.

Private update, migration and repair scope clarification; date not recorded, transcript not publicly available. The six-month policy remains internal guidance; indefinite migration availability is not required. Repair may restore a blocked workspace, but only verified compatibility removes its block.

Private migration-policy clarification; date not recorded, transcript not publicly available. Disproportionate transition effort may justify an explicitly approved workspace-format exception within the minimum window, with safe refusal and an update request on affected older apps.

## Acceptance criteria

- Within six months of an older version's publication, that version and newer releases can read and edit a shared compatible workspace unless an explicit exception for the specific workspace-format change has been approved.
- An exception identifies affected versions and the required minimum app version, preserves user data and verifies refusal before unsafe access on affected older apps; it does not waive public plugin-interface compatibility.
- Data written by the older supported app remains usable in the newer app.
- Editing in the older supported app preserves information added by the newer app, even when the older app does not expose the new feature.
- Skipping intermediate app releases within the compatibility window does not require manually installing each skipped release to retain workspace use.
- Upgrade tests use synthetic workspaces matching supported published formats and verify retained content, history, references, conversations and plugin state after reopening; fresh-workspace tests alone are insufficient.
- Required migrations are tested for failure, process interruption and repeated opening without lost data, duplicate conversion or automatic replay of completed or uncertain effects.
- A version older than six months can still open and edit a workspace when its data remains compatible.
- An actually incompatible workspace is refused before incompatible processing or writes, with an explanation and update request.
- Refusing one incompatible workspace leaves other compatible workspaces usable.
- Starting repair does not allow normal use of a blocked workspace; failed or cancelled repair leaves the block intact.
- A repaired workspace can be opened after compatibility verification succeeds; an unavailable safe repair leaves an explanation and the block in place.
- A plugin requiring a newer app version does not by itself cause workspace-wide refusal.

## Open questions

- How are incompatible changes received while a workspace is already open handled?
- Which migration and recovery paths, if any, are retained outside the minimum window without a permanent-availability commitment?
- What compatibility lifetimes apply to service APIs and supported operating-system versions?
- How is the six-month boundary calculated for release qualification?
