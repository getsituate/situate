# Local plugin management and development

## Proposal

Settings separates tools, connections and document sources into matching card grids. Connections own account setup; each consumer selects its accounts independently. Cards distinguish enabled code from usable access and link to consumers. Disabling a dependency includes indirect consumers; re-enabling it does not restart those consumers.

A development conversation carries an assignment rather than owning one plugin. It can reuse an existing connection, change several packages and edit ordinary workspace files. Selecting a plugin supplies starting context. The shared chat header and composer remain on a restrained lilac surface; narrow windows switch between the conversation and its file panel without clearing drafts.

Normal and development conversations use the same transcript renderer for messages, Activity disclosures and visible note changes. Implementation writes stay in Activity; notes and working-instruction edits remain visible in the conversation. Missing connection access has a direct setup action. Checks cover related revisions together. Publication outcomes include waiting for running actions, known failure, uncertainty after interruption, and active code whose origin notice failed. An uncertain outcome must be inspected before activation is attempted again.

This is a synthetic interaction proposal. It does not settle the production storage, publication or recovery protocol, alter the requirements catalog, or establish native integration availability.

## Review changes

**Changes** is a flat, path-sorted file list rooted at the workspace, including `.situate/plugins/…/code/`. Added, modified, deleted and renamed files carry A/M/D/R markers. Selecting a file opens a unified line diff computed from its recorded contents, with old/new line numbers and addition/removal counts. Markdown and code use the same source comparison. Repeated changes to one path retain their separate revision pairs. Unattributed observations are marked explicitly; current workspace contents never substitute for missing history.

**Expand changes** shows the file list beside the diff across the available pane width. **Restore sidebar** returns to the conversation layout. Path search covers the entire list; lists over 100 entries have page controls. Arrow keys, Home and End navigate across pages. Previous/next change controls remain available in the narrow detail view. Unchanged context is collapsed and can be expanded; long diffs reveal additional rows on request. Very large replacements use bounded comparison work and disclose when changed blocks are shown in full.

Workspace browsing belongs to **Files** in the main navigation, not to a second mode in this panel. The Changes panel retains its selection, search, list scroll and detail scroll. Loading, failed retrieval, an empty change list, unavailable revisions and unsupported previews have distinct feedback. Escape closes the panel and returns focus to its entry button. Comparisons remain available after activation; removing pending code marks unavailable candidate contents without deleting saved workspace files or history.

`PluginCodeBrowser.vue` remains the standalone, single-package browser. The `plugins-files`, `plugins-files-loading`, `plugins-files-error` and `plugins-files-empty` links retain their own browsing state and do not switch to assignment-wide inspection.

## Review paths

All development starting states belong to **Develop a plugin**, not separate top-level scenarios. Existing URLs remain valid.

| Starting state                           | Interaction to inspect                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `plugins-create`                         | Describe an assignment without choosing a package type.                                                           |
| `plugins-development`                    | Connection and consumer changes; discover another affected package using live controls.                           |
| `plugins-development-connection-only`    | A reusable connection with chat functionality and no consumer view.                                               |
| `plugins-development-reuse`              | Another consumer uses an unchanged connection and its existing access.                                            |
| `plugins-development-missing-connection` | Create the missing connection and its consumer together.                                                          |
| `plugins-development-shared-change`      | Extend a shared interface; fail one consumer check.                                                               |
| `plugins-development-system-change`      | Multiple connections, consumers and saved workspace edits.                                                        |
| `plugins-development-parallel`           | Switch between independent conversations; inspect attributable revisions and uncertain observations separately.   |
| `plugins-development-changes`            | Compare additions, edits, deletions and renames; simulate retrieval and history failures.                         |
| `plugins-development-workspace-files`    | Open the Changes overview through the retained entry URL.                                                         |
| `plugins-development-activation`         | Ready checks, waiting, failed or interrupted publication, and failed origin notification after activation.        |
| `plugins-development-access-needed`      | Active code still needs access. Cancel setup and return without losing the assignment.                            |
| `plugins-connection-platform`            | Connection settings with distinct permission, implementation, unsupported-platform and operation-failure reasons. |

`plugins-interrupted`, `plugins-error`, `plugins-success` and `plugins-general-error` retain their conversation paths. Interruption does not resume work on opening. The general error is an unexpected view/storage error, not a failed code check. Source creation and adaptation, including `documents-connect`, use the same development flow while retaining their prepared request and return navigation.

The connection and collection examples preserve account selection and illustrated-card alternatives. `plugins-list-illustrated` and `plugins-connections-illustrated` remain direct links. A single-package assignment is still available through an installed plugin's adaptation entry.

**Pending code** is the storage-cleanup list, not the conversation list. Its confirmation separates stopping work and removing unactivated code/checks from reversing saved edits. Active code, ordinary workspace content and conversation history remain. Cleanup is unavailable while publication has an unresolved outcome.

## Controls and integration

`model.ts` exports serializable state and transitions. `assignment-model.ts` owns related packages, checks, publication and inspection synchronization. `assignment-files.ts` keeps recorded revisions separate from current files. Views emit state snapshots; model transitions mutate the supplied state.

- `startPluginDevelopment(state, request?, kind?)` accepts an assignment and optional entry context. The optional kind preserves source handoff context; it is not a required user choice or an access restriction.
- `growAssignment(state)` adds a discovered package and its relevant dependencies to the current conversation and inspection.
- `startAssignmentChecks`, `finishAssignmentChecks`, `activateAssignment` and `resolveAssignmentActivation` drive synthetic check/publication outcomes. Editing checked code invalidates its evidence.
- `interruptPluginWork(state)` stops active work on workspace closure or application quit, not on pane closure.
- `openPluginFiles(state, pluginId)` inspects installed code without executing or enabling it.

`PluginsControls.vue` follows the visible screen. Changes-panel controls expose retrieval and historical availability; settings show connection outcomes and availability comparisons. Long-name examples, 500 additional files and a 1,200-line diff exercise constrained layouts and navigation. Reset replaces fixtures and cancels pending simulated actions; environment-only changes preserve drafts. There are no network calls, real file writes or executable plugin operations.

## Review question and limits

At wide and narrow macOS content sizes, can a reviewer find a file among hundreds of changes, distinguish identical filenames by their paths, and inspect the exact changed lines? Can they return from inspection and account setup without losing their draft? This remains a review question, not a usability finding.

The iOS comparison is hypothetical availability/layout only. No Apple Notes API, permission route, native plugin execution, publication durability or conflict-free concurrent editing is established by these fixtures. Native windowing, assistive technology and device behavior require separate qualification. Rollback, migrations and production storage recovery remain outside this exploration.

Run from `client/`:

```sh
npm run check --workspace @situate/workshop
npm run test:design
npm run build:design
npm run test:browser --workspace @situate/workshop -- workshop-plugin-chat.spec.ts workshop-plugins.spec.ts workshop-plugin-files.spec.ts workshop-plugin-collection.spec.ts plugin-sources.spec.ts
```

## Design basis

- [REQ-0001: creation and reuse](../../../../requirements/data/requirements/REQ-0001-create-integrations.md)
- [REQ-0014: platform compatibility](../../../../requirements/data/requirements/REQ-0014-plugin-platform-compatibility.md)
- [REQ-0017: source inspection](../../../../requirements/data/requirements/REQ-0017-inspect-plugin-instructions.md)
- [REQ-0032: management and disabling](../../../../requirements/data/requirements/REQ-0032-manage-plugin-status-and-disabling.md)
- [REQ-0033: checks and activation](../../../../requirements/data/requirements/REQ-0033-stage-and-activate-plugin-changes.md)
- [Situate brand handbook](../../../../design/brand/README.md)
- [UI Skills: distill](https://www.ui-skills.com/skills/pbakaus/distill): focused inspection with progressive disclosure of unchanged context.
- [UI Skills: better-layout](https://www.ui-skills.com/skills/jakubkrehel/better-layout): grouping, shared alignment and content-driven responsive structure. No third-party code or assets are included.
