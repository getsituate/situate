# Plugin uninstallation

Workshop reference for the installed-plugin collection, including tools, connections and document sources. Product behavior is defined in [REQ-0032](../../../../requirements/data/requirements/REQ-0032-manage-plugin-status-and-disabling.md). The workshop simulates removal without changing workspace files.

## Placement

The footer of each card keeps **View files** and **Enable / Disable** visible. An always-visible **More actions** button beside Enable / Disable opens **Uninstall…**. Disabled plugins use the same entry.

A permanent Uninstall button would compete with everyday actions across the entire grid. Putting it only in plugin settings would exclude plugins without settings and make removal of disabled plugins harder to find. The menu keeps the action at its object without making removal a primary action. No hover or right-click is required.

## Confirmation and outcomes

- Name the selected plugin and workspace scope. Focus Cancel initially; Escape returns to the card's More actions button.
- Offer **Disable instead** for enabled plugins. This opens the existing disable confirmation, including its dependent-plugin and running-action explanations.
- List direct and indirect dependents, even when disabled. Removal is blocked until they are adapted or uninstalled; it does not remove or disable them silently.
- Running actions block removal. They can finish without being aborted. Disabling remains the separate route for controlling running work.
- Confirmation enters a pending state. The controls window completes or fails the simulated removal; duplicate submission and dismissal are unavailable until the outcome is known.
- A simulated failure occurs before removal and retains the plugin. Retry uses the same selection. Success removes its card, announces the plugin's name and focuses the collection heading.
- Reset restores the selected starting state and discards the simulated operation.

Starting states under **Plugins**: `plugins-uninstall`, `plugins-uninstall-disabled`, `plugins-uninstall-dependencies`, `plugins-uninstall-running`, `plugins-uninstall-pending` and `plugins-uninstall-error`. Ordinary cards also reach this flow; these are states, not separate scenarios.

## Storage boundary

Product uninstallation removes the complete plugin directory, including its code, settings, data, encrypted credential envelope, drafts and plugin-specific histories. Ordinary notes, tasks, documents, conversations and general workspace history remain intact. An absent directory does not establish an installation, and a replacement with the same plugin ID does not inherit the removed installation's state or execution handles.

Dependent plugins block removal rather than being removed automatically. Running work must finish before uninstallation. No external account revocation, automatic reinstall or undo is promised. A real partial or uncertain removal must not reuse the fixture's known-before-removal error message without inspecting the actual state; it cannot offer a blind retry.

## Review

Ask a reviewer to remove an unused, disabled plugin without guidance, then remove a connection that other tools need. Check whether they find More actions and can explain Disable versus Uninstall before confirming. Discoverability of the menu is the main untested assumption.

Use macOS-sized content and narrow iOS reference geometry. Browser rendering does not establish native windowing, VoiceOver, touch or device behavior. All removal, action completion and failures use synthetic in-memory state.

## Design guidance

- [Interaction contracts](https://www.ui-skills.com/skills/kemiljk/interaction-contracts): distinguish confirmation, pending work, cancellation and known outcomes.
- [Fixing accessibility](https://www.ui-skills.com/skills/ibelick/fixing-accessibility): named menu triggers, keyboard access and focus restoration.
- [Harden](https://www.ui-skills.com/skills/pbakaus/harden): constrained layouts, blocked actions, failure and retry.
