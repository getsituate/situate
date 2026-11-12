---
id: REQ-0068
type: requirement
title: Update direct desktop installations with user-controlled restart
status: approved
priority: must
area: Platforms and synchronization
goals: [GOAL-0001]
---

## Description

Direct desktop installations must automatically check for app updates and download available updates in the background. Installation and the subsequent application restart require the user's confirmation. Downloading an update must not itself interrupt ongoing work or initiate plugin migrations. Users must also be able to check for updates manually.

Automatic checks use a rolling 24-hour interval from the last successful update check, retained across application restarts. If no successful check is recorded, a check is due. A due check runs in the background at application startup or while the application remains running. After device sleep, a due check runs when the application resumes; Situate does not wake the device for update checks. Checks neither block startup or interaction nor open a dialog. Manual checks remain available independently of the automatic interval.

Direct desktop update downloads have no application-specific restriction for mobile-data or metered connections. The mobile-data restrictions for dictation-model provisioning do not apply to app updates. Mobile app updates remain managed by their app store.

A failed check does not reset the 24-hour interval. After consecutive failed automatic checks, Situate waits 1 minute, then 5 minutes, then 30 minutes, and then 60 minutes between further attempts. If connectivity prevented a due check, Situate retries when connectivity returns; repeated server failures retain their waiting period rather than bypassing it on every connectivity change. Manual checks can run immediately regardless of the automatic waiting period, but concurrent requests share one in-flight check.

An update check has a 30-second deadline; exceeding it is a failed check. This is not a deadline for downloading the entire update. Automatic check failures do not open dialogs. Download failures retry independently of the successful-check interval, so successful discovery followed by a failed download does not force another 24-hour wait. After consecutive failed automatic downloads, the waits between attempts are 1 minute, 5 minutes, 30 minutes and then 60 minutes for further failures. Interrupted or incomplete downloads restart from the beginning rather than resuming partial bytes.

Keep downloaded updates in a private device-local cache outside workspaces. Retain at most one verified update package plus one in-progress download/verification candidate. A completed package remains available across application restarts and is reverified before use. Replace an older cached package only after its replacement has been verified; a failed replacement download does not discard the still-valid older package. Remove the installed package after confirming a successful upgrade.

The update path must respect the installation channel: app-store and package-managed installations remain updated through their respective store or package manager rather than being overwritten by the direct-install updater. Distribution channels need not make the same release available simultaneously. For store- and package-managed installations, Situate does not perform its own automatic or manual update checks, download app updates or promote available updates. Discovery, download and installation remain with the store or package manager. The built-in update area is available only for direct installations. Explanations of actual workspace or plugin incompatibility under [REQ-0069](REQ-0069-preserve-workspace-version-compatibility.md) and [REQ-0070](REQ-0070-preserve-plugin-api-compatibility.md) remain available regardless of installation channel; they are distinct from update promotion.

Once an update is downloaded and ready for a direct installation, Situate shows a quiet, persistently accessible indication at a consistent location in the interface. The indication provides access to user-confirmed installation without opening a dialog automatically or issuing repeated reminders.

If actions are running when the user requests installation, Situate must explain the interruption and let the user postpone the update or explicitly abort the actions and proceed. Postponing leaves ongoing work running and does not schedule an unsolicited later restart. Application closure retains the saved-state and pending-synchronization choices in [REQ-0037](REQ-0037-keep-workspaces-independent.md). After restart, interrupted chats remain available and wait for user interaction under [REQ-0011](REQ-0011-work-on-topics-in-parallel.md).

Users can also explicitly force installation and restart when an open window cannot complete preparation. Before proceeding, Situate warns that running actions will stop and unsaved changes in any open window may be lost. This consent is separate from an ordinary installation or stopping actions while saving work; it applies only to the confirmed update package. A forced update does not wait for window readiness or require unsaved edits to be secured. It still stops native operations before replacing the bundle, verifies the package and installation state, and preserves already saved workspace data and recovery drafts. Window preparation has a bounded wait and offers a retry or this explicitly confirmed forced path after failure. Native shutdown reports a timeout while retaining admission until in-flight persistence settles; installation must not continue automatically after that timeout. If native operations cannot be stopped safely, explain that limit and the available manual installation path rather than bypassing writes in progress.

A retained failed conversation checkpoint is distinct from a running write. Once actual work and cleanup have settled, a retained persistence failure ends preparation and releases reversible update barriers without discarding or retrying the checkpoint. Unresolved cleanup obligations continue to block installation. Seal new conversation writes and owner initialization together with the final quiescence check before replacing the bundle.

Update diagnostics record the check, download, preparation, installation and restart stages, including whether a forced update was requested and a bounded failure reason. Preparation failures distinguish waiting for native actions, window readiness, dictation and pending file edits. Logs must not contain workspace content, paths, credentials or raw network responses.

The interruption notice explains that the user can continue affected chats with another message. It must not promise seamless resumption of an individual external action or imply that aborting reverses effects already triggered. A separate explanation of external-action reversal or outcome uncertainty is not required in this notice. Uncertain external outcomes retain the existing agent/model responsibility in REQ-0011.

If an installation attempt fails and the application bundle is known unchanged, Situate releases the reversible preparation, leaves the original installation usable and retains the verified update package for a later user-requested attempt. Actions already aborted for the update are not automatically replayed.

If bundle replacement or relaunch has an uncertain outcome, Situate explains the known state and necessary recovery steps without automatically retrying installation or restarting. Keep mutation admission sealed in that process; manual recovery explains how to close Situate without deleting workspaces and warns about unsaved changes. A further installation attempt requires explicit user action and renewed validation of the package and installation state. If manual recovery is needed, use a trusted installer of the target update version or a newer version without deleting or resetting workspaces. No application-owned automatic rollback is required or promised.

Correct faulty released application versions through a new update with a higher version number, not an application rollback or downgrade. Direct-update feed and website download metadata must not be rewound to an older release, and published artifact bytes must not be replaced under the same version. Operators may pause availability while preparing the fix without advertising an older application version. Changing or pausing feed metadata does not reliably revoke already downloaded, validly signed packages; a package-revocation system is not included in this delivery.

Situate must not automatically display a changelog, including after successful installation and restart. Users can open the version history from the update area in direct installations and from About Situate regardless of installation channel, including App Store installations. Access through About Situate does not introduce an update area, update checks or update promotion for store- or package-managed installations.

The version history starts with the first release prepared through the changelog workflow. The installed app includes all finalized, committed changelogs from that point onward at or below its installed version, identified by version number. No separate publication record or public-availability evidence is required for inclusion. Older releases require neither retroactive changelogs nor imported publication records. Users can browse individual releases, including releases skipped when updating; this is not limited to versions previously installed on that device. Newer uninstalled versions are excluded, including a version already downloaded by the updater. The update area links to the installed history, not release notes for an available update. The history is available offline without fetching release notes. Entries explain new capabilities, changes to existing workflows and concrete bug fixes in terms users understand. Necessary user actions, relevant limitations and platform-specific differences are identified where applicable. Commit lists and internal changes without an observable user impact are not substitutes for user-oriented release notes.

## Rationale

Users can keep direct installations current without repeatedly downloading installers or having their work interrupted at an unexpected time. An optional version history lets users understand product changes and look up relevant fixes without interrupting their work after an update.

## Source

Private application-update and compatibility clarification; date not recorded, transcript not publicly available. The behavior and must-have priority were confirmed.

Private update-control clarification; date not recorded, transcript not publicly available. A manual update-check action was confirmed in addition to automatic checks.

Private update-check scheduling clarification; date not recorded, transcript not publicly available. A rolling 24-hour interval was selected to cover applications kept open for days without interrupting startup or interaction. Due checks run at startup, during use or after device sleep without waking the device. Failed checks do not reset the interval; connectivity restoration triggers retry, with waiting periods after repeated failures.

Private update-notification and distribution-channel clarification; date not recorded, transcript not publicly available. Direct installations show a quiet, persistently accessible update-ready indication without automatic dialogs or repeated reminders. Store- and package-managed installations leave discovery, download and installation to their channel and omit the built-in update area. Actual incompatibility explanations remain available on every channel.

Private app-update network-scope clarification; date not recorded, transcript not publicly available. No special mobile-data or metered-connection restriction was selected for direct desktop app updates. Dictation-model provisioning rules remain separate; mobile app updates are managed by app stores.

Private restart-dialog clarification, 2026-10-30; transcript not publicly available. The notice retains chat-continuation guidance without requiring a separate explanation of external-action reversal or uncertain outcomes. The underlying action and uncertainty rules remain unchanged.

Private update-retry policy clarification; date not recorded, transcript not publicly available. Check retries after 1, 5, 30 and then 60 minutes, a 30-second check deadline, immediate coalesced manual checks, connectivity-aware retries and quiet automatic failures were confirmed. Download retries remain independent of successful-check scheduling.

Private update-download retention clarification; date not recorded, transcript not publicly available. A private cache outside workspaces retains one verified package across app restarts plus one in-progress candidate, with verification before reuse and replacement, cleanup after successful upgrade, no partial-download resumption and independent download retries after 1, 5, 30 and then 60 minutes.

Private update-installation failure clarification; date not recorded, transcript not publicly available. Known-unchanged failures release preparation and retain the verified package; aborted actions are not replayed. Uncertain replacement/relaunch requires truthful recovery guidance without automatic retry/restart. Further attempts need explicit user action and renewed validation; manual recovery uses a trusted same/newer installer without resetting workspaces, not a custom automatic rollback.

Private faulty-release handling clarification; date not recorded, transcript not publicly available. Faulty releases are corrected by higher-version updates, without app rollback/downgrade, metadata rewind or replacement of published bytes under the same version. Availability may be paused without offering an older version; cached signed packages are not reliably recalled by feed changes and no separate revocation system is included.

Private app-versioning and changelog clarification; date not recorded, transcript not publicly available. An optional, user-oriented history for every published version was selected instead of automatic changelog display. Access from the direct-install update area and from About Situate on all installation channels, including the App Store, was confirmed. A subsequent clarification limited the bundled history to the installed version and earlier published releases, with no release-note fetch or preview of newer uninstalled versions. A later scope clarification starts the history with the new changelog workflow and excludes retroactive changelogs, historical imports and earlier publication-evidence prerequisites.

## Acceptance criteria

- A direct desktop installation checks for and downloads an available update without requiring a manual website download.
- Users can manually initiate an update check in a direct desktop installation without waiting for the next automatic check.
- The last successful check time is retained across application restarts; without a recorded successful check, an automatic check is due.
- A due automatic check runs at startup or once 24 hours have elapsed during continued application use, without requiring an application restart.
- Resuming after device sleep runs a due check; update checking does not wake the device.
- Automatic checks do not block application startup or interaction and do not open a dialog.
- Failed checks do not advance the last successful check time or postpone the next check by a new 24-hour interval.
- After consecutive failed automatic checks, the waits between attempts are 1 minute, 5 minutes, 30 minutes and then 60 minutes for further failures.
- Restored connectivity triggers retry of a due check that could not complete while offline; repeated server failures retain their automatic waiting period despite connectivity changes.
- Manual checks need not wait for the automatic retry interval; concurrent manual and automatic requests share one in-flight check.
- A check that exceeds 30 seconds fails without advancing the successful-check timestamp; the deadline does not apply to the whole update download.
- Automatic check failures do not open dialogs.
- Failed downloads retry independently of the 24-hour successful-check interval, after waits of 1 minute, 5 minutes, 30 minutes and then 60 minutes between further failed attempts.
- Interrupted or incomplete downloads restart from the beginning; partial-download resumption is not required.
- A verified package remains available across app restarts in private device-local storage outside workspaces and is reverified before use.
- The cache retains at most one verified package plus one in-progress download/verification candidate. An older package is replaced only after verifying the newer one; failure to download the replacement preserves the still-valid older package.
- The installed update package is removed after confirming a successful upgrade.
- Direct desktop app-update downloads are not blocked solely because a connection is classified as mobile data or metered; dictation-model download restrictions are not applied to them.
- Background download leaves running actions and the installed app version unchanged.
- Installation and restart do not occur without confirmation.
- If a failed installation leaves the bundle known unchanged, reversible preparation is released, the original installation remains usable and the verified package is retained for a later user-requested attempt.
- Actions aborted for installation are not automatically replayed after an installation failure.
- Uncertain replacement or relaunch outcomes are explained with recovery steps, without automatic installation retry or restart; another attempt requires explicit user action and renewed package/installation-state validation.
- Manual recovery guidance uses a trusted installer of the same or a newer version without deleting or resetting workspaces. No application-owned automatic rollback is required or promised.
- Faulty released versions are corrected through higher-version updates, without an application rollback or downgrade workflow.
- Direct-update feed and website download metadata do not revert to an older application release, and published bytes are not replaced under the same version. Pausing availability does not advertise an older application version.
- Feed changes or pauses are not presented as reliable revocation of already downloaded signed packages; no separate package-revocation system is included in this delivery.
- A package-managed or store-managed installation is not overwritten by the direct-install updater.
- A downloaded update ready for direct installation is indicated at a consistent, persistently accessible interface location, with access to user-confirmed installation.
- Update availability does not open a dialog automatically or trigger repeated reminders.
- Store- and package-managed installations perform no Situate-owned automatic or manual update checks or app-update downloads and show neither update promotions nor the built-in update area.
- An actual workspace or plugin incompatibility still explains the required app version regardless of installation channel.
- When work is running, users can postpone installation without interrupting it, or explicitly abort it and proceed.
- A separate forced-update confirmation warns that actions will stop and unsaved changes in any open window may be lost. Only that confirmation permits bypassing window readiness and unsaved-edit checks, and it is invalidated when the update package changes.
- A forced update still stops native operations before bundle replacement, revalidates the package and installation state, and preserves saved data and persisted recovery drafts.
- Window preparation has a bounded wait. Failure offers an actionable retry or forced-update choice. Native shutdown timeouts report the blockage, retain admission until in-flight persistence settles and never continue installation automatically; inability to stop native writes retains a safe failure and manual installation guidance.
- Update diagnostics identify stages, bounded failure reasons and forced attempts without logging content, paths, credentials or raw responses.
- A settled conversation persistence failure ends preparation without installing or discarding its checkpoint, and releases reversible update barriers. Pending execution, mutations, native operations and unresolved cleanup still block installation.
- Update closure preserves the existing choices for pending synchronization and retains interrupted conversation state.
- Reopening after the update does not silently resume interrupted conversations; the user can continue an affected chat through a new message.
- The interruption notice explains continuation through a new chat message without promising guaranteed action resumption; no separate explanation of external-action reversal or outcome uncertainty is required.
- Installing an update and restarting into the new version does not automatically open a changelog or version history.
- Users can open the version history from the direct-install update area.
- Users can open the same version history from About Situate on every installation channel, including App Store installations, without introducing a Situate-owned update area or update promotion on store- or package-managed installations.
- Starting with the first release prepared through the changelog workflow, all finalized, committed changelogs at or below the installed version are included automatically, including releases skipped during an update, without a separate publication record.
- Releases predating that workflow need no changelogs or imported publication records and do not block the first new release.
- Newer uninstalled versions are excluded from history, search and release navigation even when an update is downloaded and ready.
- History opened from Updates refers to the installed history, not the available update's release notes.
- Browsing history works offline and makes no release-note requests.
- Entries describe user-visible capabilities, workflow changes and concrete bug fixes rather than merely listing commits or internal implementation changes.
- Entries identify necessary user actions, relevant limitations and platform-specific differences when applicable.

## Open questions

- What download controls, if any, are offered?
- What space is required for downloading, extracting and replacing an update, and how is insufficient space explained?
- How are required migrations presented, including their duration, failure handling and data-preserving recovery?
- Which direct Linux installation formats and updater behavior are supported?
