# App updates and version history

## Review paths

Select **Update the app** for direct-install checks, download progress and user-confirmed restart. Select **Browse release history** to begin in **About Situate**, with website, package-managed, App Store and skipped-release starting states. Existing `release-notes-*` links remain valid.

From Updates or About Situate, choose **Browse version history**. Both open the same list of the installed version and earlier releases. A downloaded newer version does not appear in the reader, search results or adjacent-release navigation. Find a release by version number or words in its notes, open an entry, move to an older or newer release, or return to All releases. Returning preserves the filter, list position and focus on the selected release. Close history and Escape return to the invoking control.

- **Update ready in the workspace** places a small icon in the lower-right corner without adding a header or reserving layout space. Hover or keyboard focus reveals “Update available” to its left. It remains available with the sidebar collapsed. Selecting the icon or revealed label opens **Settings → Updates**, never immediate installation.
- **Download in progress** shows transferred bytes, percentage and a progress bar in Settings. The download is already running; there is no additional mandatory download confirmation or cancel feature.
- **Restart with actions running** uses a general activity warning without an action count or named action list. Existing close checks expose boolean chat/process activity, not a user-facing catalog of current actions (`client/app/src/plugins/process-lifecycle.ts` and `client/app/src/ai/chat.ts`). The dialog explains interruption and continuing chats through a new message after restart. **Update later** retains running work. Installation needs an explicit choice.
- **Restart with unsynchronized changes** offers synchronization while the workspace remains open or immediate restart with local changes retained. The controls complete synchronization; cancelling the wait does not schedule a later restart.

About Situate remains available on every channel. Store- and package-managed installations omit Updates, update checks and update-ready indications. Completing a simulated update never opens history.

## Fixtures and boundaries

All release numbers, dates and notes are synthetic examples, not announcements of shipped capabilities. The fixture catalog includes every release in the example series; the reader applies the simulated installed-version ceiling while retaining earlier releases skipped by that installation. Patch entries describe concrete corrections; minor entries describe capabilities and workflow changes, with necessary steps and platform limitations.

Search and scrolling keep longer histories browsable without adding a release picker to each article. The index and article each have one scrolling region; navigation and Close history remain outside it. The same list-to-detail flow works in narrow iOS and desktop previews. Native dialog behavior contains keyboard focus; entry controls explicitly receive focus before opening for consistent focus restoration.

Simulation controls remain in the controls window. No network, installation, restart, workspace writes, release-source format or production history cache is implemented. Browser profile geometry does not qualify native macOS or iOS behavior. Production uses the bundled catalog described in the [release preparation guide](../../../../docs/development/release-preparation.md); native resource delivery and failure handling require separate production verification.

## Restart preparation

Open `?workshop=controls&scenario=updates-restart&profile=mac` for running actions, or `?workshop=controls&scenario=updates-settings&profile=mac` for an idle restart. The ordinary dialog offers postponement and a save-and-restart path. Postponement receives initial focus and leaves actions running. At narrow desktop widths the two actions stack instead of forming an uneven wrapped row.

Preparation stays inline in Updates; navigation remains available. Use **Fail preparation** in the controls to show the generic window-preparation failure. Retry opens the ordinary confirmation again. **Force update…** is secondary and appears only after that failure. Its separate confirmation warns about stopping actions and losing unsaved changes in any open window, with initial focus on postponement. Chat continuation requires a new message.

The controls also expose known native stop-pending and stop-failed outcomes. Neither offers force as a bypass. **Finish stopping actions without installing** releases the simulated block without scheduling a restart; another installation requires a new request. Finer window, dictation and pending-edit diagnostics are not exposed as user-facing diagnoses.

Production adoption must retain package signature and installation-state validation, saved workspace data and persisted recovery drafts. Forced consent applies only to the confirmed package and does not authorize bypassing native writes. This model uses a synthetic version as its package identity and manual completion controls, not real persistence, deadlines, signature checks or process shutdown. Browser verification does not qualify native multiwindow shutdown or assistive technology.
