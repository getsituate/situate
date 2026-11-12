# Incremental plugin delivery

## Decision status and review boundary

Proposal for scope and delivery tracking; not an approved architecture change or an implementation report.

Reviewed `plugin-development` at `797ae3312bc2c12990fdeec1e320839bdceb05ef` against the common ancestor with `simple-plugin` at `392089b4`. The branch diff contains 783 files, 162,041 added lines and 1,410 removed lines, including generated artifacts, tests, runtime experiments and unrelated changes. These counts are not a measure of production complexity alone.

The review covers catalog changes, the development and view milestone plans, the workshop management/development specification, the host Vue loader and existing catalog validation. It does not establish runtime correctness or visually verify the application. No native journey or visual comparison was run for this review.

## Findings

- The branch's initial source-service milestone already combines retained workspace copies, immutable revisions, supervised service execution, request-bound contributions, dependency coordination, checks, adoption, compensation, post-adoption verification and recovery. Basic views add another integration boundary before the first usable visual workflow.
- The branch has already separated later capabilities into milestones. The remaining problem is the size of the initial capability set, not a complete absence of planning.
- Its `docs/development/plugin-view-milestone.md` explicitly records incomplete native qualification: recovery assertions failed, and other attempts encountered tooltip/capture failures and a deadline. Browser results do not establish installed-app acceptance. The source-service integration checklist also remains open.
- The workshop describes a concrete interface: Settings cards, a shared chat header/composer, a light lilac development surface and a collapsible read-only file panel. This should be an acceptance reference for each delivered state, not a finishing step after backend integration. The reported design mismatch has not been independently reproduced by this review.
- The catalog already separates product approval from implementation. Its `status: approved` must retain that meaning. A branch plan or passing isolated test cannot establish completion of a broad requirement.
- There is a planning inconsistency to resolve before reuse: REQ-0033 removes the copy after adoption and successful final verification, while the branch integration checklist requires separate explicit cleanup. Do not inherit both behaviors accidentally.

## Preserve the target, select the delivery slice

Carry forward reviewed product meaning and stable IDs, not the entire implementation branch or all its ADRs. The requirement changes remain useful target behavior even when their delivery is deferred.

| Branch catalog change                                               | Treatment                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| REQ-0001: plugin-owned skills and normal/development modes          | Preserve; normal-chat skills are the proposed first slice, development-mode extension follows later.                                |
| REQ-0005: process history                                           | Preserve the clarified history boundaries; reuse existing conversation history rather than introducing a second invocation journal. |
| REQ-0021: unavailable security reviews and revision-bound overrides | Preserve; marketplace adoption is deferred, not silently exempted from review.                                                      |
| REQ-0022: removal of temporary-copy histories                       | Preserve with REQ-0033; deleted trial references must not resolve against another workspace.                                        |
| REQ-0026: host Vue views and accepted hang risk                     | Preserve as the view target, including its recovery prerequisite. Not needed for text-only contributions.                           |
| REQ-0032: management, disable and recovery                          | Preserve; implement the portion needed for the admitted contributions before enabling them.                                         |
| REQ-0033: staging, checks, adoption, migration and verification     | Preserve; select compatible, single-plugin changes first, not the whole migration/dependency lifecycle.                             |
| REQ-0037: workspace ownership versus shared UI failure              | Preserve; no claim that separate workspaces isolate a host UI hang.                                                                 |
| REQ-0063: contextual repair from errors                             | Preserve as a separate future increment; no requirement to build a general error-repair system before ordinary authoring.           |
| REQ-0013: synchronization and recovery clarifications               | Review and transfer separately from local plugin implementation. Synchronization does not become a first-iteration dependency.      |
| Foundations                                                         | Transfer consistently with the selected catalog changes; retain trust, approval, history and privacy boundaries.                    |

A catalog-only transfer should be a separately reviewable change, including reference validation. This proposal does not yet copy the branch catalog or declare its architecture accepted on the new branch.

## Proposed first iteration: local instruction plugins

### User outcome

A person describes a working method, develops it in a distinct conversation, inspects its instructions and uses the adopted skill in normal chat. For example, a weekly review skill guides an existing chat through reviewing local notes using existing host tools. It introduces no new service, executable tool or custom view.

This is a complete but narrow plugin workflow, not a claim that executable integrations or REQ-0001 as a whole are finished. If a custom view is essential to the first useful release, this scope must be reconsidered explicitly rather than adding views silently during implementation.

### Included

- One workspace-local package containing a small manifest, Markdown skills and supporting non-executable resources. Normal-chat contributions only; reject unsupported executable contributions and dependencies rather than silently ignoring them.
- One active development per workspace initially. Other chats remain usable; additional development requests explain the limit without losing the user's request. This is an explicit temporary restriction, not the final concurrency behavior.
- Settings entry for creation and editing, plus a normal-chat handoff into the same development flow. Reuse existing conversation, pane, persistence and agent owners.
- The workshop's development presentation and read-only file panel, scoped to the supported package. No connection/account cards or inactive controls suggesting unavailable features.
- A temporary workspace copy for authoring and trials. Development uses built-in tools and host-owned instructions; editing a skill does not install it into the developing agent's own guidance.
- Structural validation and focused synthetic behavior checks using the actual skill-loading path. Model-dependent quality remains uncertain; structural validation alone is not proof that instructions work. Define the required behavioral checks for the selected example before implementation.
- Checked, compatible, code/resource-only adoption through existing versioned writes. Verify the exact candidate and original-source preconditions; block a conflicting external edit instead of overwriting it. Copy no trial data, configuration or credentials back.
- Contributions change at the next normal-chat model request. An already-running request retains its original instruction selection and tool/approval context. No replay of its work.
- Read-only verification of the adopted revision before reporting completion. Known adoption remains recorded if verification fails; resumption must not adopt it again. Cleanup follows the agreed REQ-0033 boundary.
- Inspect, disable and explicitly re-enable the package. Disabled skills are neither advertised nor loaded. Built-in startup suppression also excludes plugin guidance while allowing inspection and repair.
- Retained interrupted development, explicit discard, and no automatic agent restart. Closing the presentation does not stop work; closing its workspace or quitting does.

### Explicitly excluded

Executable services and new chat tools; Vue views; plugin dependencies and grouped activation; changes to data formats; accounts and external connectors; schedules, events and native shortcuts; marketplace; synchronization; development-mode skills; general repair entry points; mobile/store qualification.

Do not implement empty abstractions for these capabilities. Unsupported requests must explain the current limit without generating an unusable package and calling it complete. Existing privacy, task-scope, versioned-write and workspace-lifecycle rules still apply to built-in tools used by skills.

### Acceptance gate

1. Through the actual product interface, create a weekly review skill without editing application source or manually registering a fixture.
2. Inspect its full instructions, exercise synthetic checks, adopt it and use it in a normal chat with attributable skill selection.
3. Edit it while another chat uses the old instructions; only subsequent requests see the adopted revision.
4. Failed checks, a changed candidate and changed originals prevent stale adoption. Interrupted adoption has an inspectable outcome and is not replayed automatically.
5. Disable and restart: no plugin guidance loads; source remains inspectable. A retained development resumes only on user instruction.
6. Verify the selected workshop states at narrow and wide container sizes, including creation, working, failure, success, files and disabled state. Use product browser flows and the locked visual-test image; explicitly review the resulting images.
7. Pass a bounded native journey on the first selected platform. Proposed starting target: macOS. Other platform support remains unqualified, not implied by browser tests.

### Reviewable implementation increments

Each change carries its relevant tests and is integrated before the next expansion:

1. Package validation, source inspection and built-in enablement/suppression, with no active contributions yet.
2. Normal-chat skill discovery/loading for a synthetic package, including request consistency and disable behavior.
3. Development conversation, retained copy and the scoped workshop interface, without publication yet.
4. Checks, compatible publication, post-adoption verification and cleanup; then the complete native and visual acceptance gate.

Intermediate increments are infrastructure or partial coverage, not a usable plugin-development release. Do not combine them into another branch that waits for future services or views before integration.

## Subsequent capability slices

Order after the first iteration is proposed, not committed:

- **Local views:** one ordinary Vue view using real shared Situate components, app-local authoring/preview and focused interaction checks. No service runtime as an automatic prerequisite. Plugin-free restart before any imports is mandatory before enabling view execution. Start with read-only content presentation; do not imply safe isolation from a faulty view.
- **Executable tools and connectors:** one concrete user workflow determines the smallest supervised execution and account-access surface. Qualify stop, ownership and external outcomes before expanding the SDK.
- **Dependencies and compatible grouped updates:** declared consumers, concurrent development and coordinated activation.
- **Incompatible migrations and portability:** current-original conversion, rollback preserving later edits, delayed device changes and platform qualification.
- **Automation, marketplace and general repair:** independently selected outcomes, not one combined final milestone.

## Delivery tracking inside requirements

### Keep three independent dimensions

1. **Product decision:** existing `status: approved | rejected`; priority expresses importance, not delivery order.
2. **Delivery scope:** a stable increment ID and selected acceptance-criterion IDs. `proposed`, `selected` and `deferred` describe scheduling decisions, not working code. Deferred does not mean rejected and carries no invented release date.
3. **Implementation evidence:** `not-assessed`, `not-started`, `in-progress`, `partial`, `verified` or `blocked`, attached to a defined scope and platform. `not-assessed` must not be treated as `not-started`.

Avoid a single `implemented: true` or a percentage for a requirement containing many capabilities. A verified first slice leaves the overall requirement partial while its remaining criteria are deferred.

### Start with Markdown, not a tracking subsystem

Add a `Delivery` section to each requirement being planned. Keep the complete normative description and acceptance criteria above it. Give acceptance criteria stable local IDs such as `AC-01`; preserve wording and never renumber existing IDs when inserting or removing criteria. Split genuinely compound criteria only with meaning preserved and an explicit mapping.

Use a table with these columns:

| Scope                        | Acceptance criteria | Increment           | Plan                           | Implementation | Evidence / remaining gap                   |
| ---------------------------- | ------------------- | ------------------- | ------------------------------ | -------------- | ------------------------------------------ |
| A precisely bounded behavior | Stable AC IDs       | Stable increment ID | proposed / selected / deferred | State          | Revision, platform, checks and limitations |

Example for REQ-0001 before approval of this proposal:

| Scope                                                           | Acceptance criteria                                                  | Increment   | Plan     | Implementation | Evidence / remaining gap                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------- | ----------- | -------- | -------------- | --------------------------------------------------------------------------- |
| Local normal-chat skills, no executable contributions           | Assign IDs to the existing matching criteria during catalog transfer | PLUGIN-01   | proposed | not-assessed   | Existing branch work is not evidence of acceptance on the receiving branch. |
| Development-mode skills, interfaces and executable integrations | Remaining applicable criteria                                        | Unscheduled | deferred | not-assessed   | Target remains approved; no delivery date selected.                         |

This example is a format proposal, not a completed criterion mapping. Before selecting PLUGIN-01, every criterion in its affected requirements must be assigned to the increment or explicitly left deferred. Shared requirements such as conversation lifecycle and versioned writes retain their existing obligations; they are not globally marked deferred because plugins use only part of them.

Evidence records identify the tested commit and any working-tree delta, platform/build, test or manual scenario, observed result and unverified remainder. Test-source paths alone are not passing evidence. `verified` applies only to the named scope; relevant behavior changes require revalidation. A blocked native test must not be hidden by a passing mocked browser test.

### Catalog compatibility and ownership

The existing viewer already renders and searches requirement body Markdown. A Delivery table needs no new UI or schema. Catalog-local links currently target only requirements, goals and foundations; use public repository path text for evidence outside that collection until link support is deliberately extended.

The requirement's Delivery section is authoritative for its scope and coverage. A development plan records order and engineering detail, linking back rather than maintaining a competing completion table. Pull requests update evidence for affected criteria. Do not bulk-label all untouched requirements as unimplemented.

After this lightweight convention is useful, optional filters and machine validation can read structured coverage. Do not begin with a new milestone database, report generator or automatic completion inference.

## Decisions before implementation

- Confirm whether instruction plugins are a useful first delivery, or whether a view must be part of the first user outcome.
- Confirm the initial platform and temporary single-development restriction.
- Approve the Delivery convention, then transfer the reviewed target catalog and add stable criterion mappings in a separate change.
- Resolve automatic versus explicitly requested copy cleanup consistently with REQ-0033.
- Select the synthetic behavior checks and workshop states before building PLUGIN-01.
