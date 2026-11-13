# Replace CI and automate macOS releases

## Outcome and authority

Replace the existing GitHub Actions workflows and DevTUI release flow with script-defined verification, release creation and publication workflows. CI, CLI and DevTUI use the same commands, prerequisites, mandatory gates and recovery rules. Reuse suitable tested primitives, not the old job graph or parallel Rust orchestration.

The governing design is the [release workflow](../architecture/07-deployment-view/release-workflow.adoc), [ADR-0017: CalVer](../architecture/09-architecture-decisions/ADR-0017-calendar-versioned-app-releases.adoc), [ADR-0018: PR declarations](../architecture/09-architecture-decisions/ADR-0018-pull-request-changelog-fragments.adoc) and [foundations](../../requirements/data/foundations.md). Selected policies below are distinct from implementation proposals and outstanding qualification. This plan does not establish deployed behavior.

Completion means an app-affecting protected merge can create a qualified GitHub Release and a separate publication workflow can promote its exact artifacts to the website/update host. Local operators can execute both workflows without Actions. Until the transition is qualified, existing operator approvals remain in force.

## Selected scope and decisions

- macOS is the only product target. Produce a universal direct application for Apple Silicon and Intel, a Developer-ID-signed/notarized/stapled DMG and a signed updater archive containing the same final app.
- Use GitHub's `macos-latest` runner for macOS jobs. Record the resolved runner image, architecture and toolchain versions. Additional OS/architecture qualification matrices, dedicated Mac provisioning and runner-variant comparisons are outside this increment. Universal bundle verification is not native Intel qualification or proof of minimum-OS compatibility; report those evidence limits rather than silently expanding the matrix or claiming coverage.
- Remove iOS, Android, Windows and Linux desktop CI jobs, target packaging, store submissions and target-specific prerequisites without replacement, including disabled mobile workflow files. Preserve useful product code and historical compatibility readers. Linux may host shared tooling, not Linux product qualification.
- Select individually reported macOS/relevant-shared suites, not a generic MVP mode. Workshop/design sweeps, visual comparisons, coverage and paid live-provider journeys remain opt-in.
- Determine relevance before scheduling work on PRs, main and local runs. Pure developer-tool changes do not start client tests/builds, qualification or version reservation without a concrete consumer dependency. Actual app candidates require complete macOS qualification on their integrated inputs.
- Implement one initial dependency-based parallel layout. Benchmark campaigns, alternative layouts and measured-speedup claims are outside this increment.
- Allow one bootstrap exception to script-only Actions: a commit-pinned checkout action. After checkout, executable steps directly invoke repository scripts. Do not implement logic in YAML or hide it in composite Actions.
- Every PR adds a new versionless changelog declaration, including documentation and bot PRs. An explicit empty entry list with an internal reason is valid; absence is not. Public content is English and German, using the locale inventory rather than hard-coded language counts.
- Allocate the version during release creation. Do not create a release/version/changelog commit. Use existing reviewed source plus immutable generated inputs. Derive source/release membership from Git where possible; keep website/update publication outcomes on the existing host.
- Publish packages as GitHub Release assets. Release creation and host publication are separate workflows; the publisher obtains the package from the exact GitHub Release rather than an Actions artifact or build directory.
- Keep externally changing vulnerability monitoring separate from PR verification. A newly reported upstream advisory must not turn an unrelated PR red. Dependabot fix PRs remain separate; the proposed monitoring cadence is described below.
- Apply [REQ-0069](../../requirements/data/requirements/REQ-0069-preserve-workspace-version-compatibility.md) and [REQ-0070](../../requirements/data/requirements/REQ-0070-preserve-plugin-api-compatibility.md). Neither a new version scheme nor narrower runner coverage waives released-data compatibility.

## Shared scripts and trust boundaries

Repository scripts own setup, selection, tests, builds, signing setup/cleanup, artifact transport, qualification, GitHub Release operations, host publication and recovery. Each operation is locally runnable/testable on a suitably provisioned host. YAML only declares orchestration, runner placement, permissions and input/credential mapping, apart from the checkout exception.

Core commands accept explicit source, candidate, release ID, operation identity, destination and artifact inputs. They do not require fabricated `GITHUB_*` variables, an Actions event file/token or a successful Actions run. Provider adapters translate event/reporting details at the boundary. A proposed entry point such as `tools/pipeline.mjs` is an implementation interface, not an existing command.

Provide complete local commands for release creation and publication, not just disconnected stage commands. DevTUI presents those same two workflows and consumes script-produced plans/events/results. A convenience sequence may run creation followed by publication, but publication remains independently executable and cannot call the builder.

Protected merge supplies routine CI authorization; explicit operator confirmation supplies local authorization for the exact source/candidate/destination. Both use the same validation and gates, including inspect-first recovery. Existing source/translation approval commands evolve to fragment scope and remain responsible for approval/hash bindings; shared execution alone does not constitute human content review. Do not introduce a separate approval service merely to support DevTUI.

Use CI environment-only credentials, scoped to their operations; dependency installation and ordinary tests receive no production credentials. Local scripts retain supported environment/private `.env` handling without sourcing it or fetching secrets. Qualification environments receive no signing/publication keys. Publisher GitHub access is read-only; it needs no GitHub Release creation credentials or updater private key.

Local independence is from Actions, not all GitHub services or the network. Creating release tags/assets and obtaining uncached release assets require Git/GitHub access and appropriate credentials. Apple notarization, isolated production-endpoint qualification and publication-host access remain necessary. Explicitly supplied cached assets must still be verified against the exact recorded release identity and hashes; they are not an arbitrary-build-directory bypass.

## Current implementation to replace

| Existing area                                                                                      | Required disposition                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/quality.yml`                                                                    | Replace affected selection, its monolithic host command list and generic scope aggregate with the platform/relevance planner and independent lanes.                                                                         |
| `.github/workflows/dependency-audit.yml`                                                           | Keep complementary Rust monitoring, outside PR/release prerequisites; consider scheduled npm monitoring only under the independent policy below.                                                                            |
| `.github/workflows/ci-image.yml`                                                                   | Replace orchestration; preserve digest-pinned inputs, trusted build/publisher separation, anonymous pulls and license/corresponding-source obligations.                                                                     |
| `.github/workflows/{coverage,agent-live}.yml`                                                      | Replace with explicit diagnostics, separate credentials and bounded paid-provider authorization; never substitute for required macOS qualification.                                                                         |
| `.github/disabled-workflows/{mobile,coverage-comment}.yml`                                         | Delete without moving them to another archive. Remove orphaned CI-only helpers, not useful product/platform readers.                                                                                                        |
| `.github/actions/`, `tools/ci-*.mjs`                                                               | Extract executable logic into local scripts; preserve suitable cache/image primitives and replace graph-specific validators/tests.                                                                                          |
| `tools/test.mjs`, `tools/test-inputs.mjs`, `tools/test-scope.mjs`                                  | Preserve suite registry/input concepts; replace generic milestone scope and execution-OS coupling. Narrow broad manifest/unknown-tool rules.                                                                                |
| `tools/release*.mjs`, Apple builder and `infrastructure/releases/`                                 | Evolve strict committed-input validation to supported immutable generated inputs, GitHub Release assets and separate host publication. Keep migration/checkpoint, artifact and recovery verification.                       |
| `tools/dev-tui/src/{actions,app,release,publication,process,report,ui,text}.rs` and terminal tests | Replace version prompts, release-level preparation continuation, optional test overrides and build/publication orchestration with the shared workflow client. Preserve logs, retained drafts/artifacts and recovery access. |

There are no active dedicated mobile jobs today, but broad Node test-file discovery and host-script globs still include platform-specific tooling tests. Removing workflow names alone is insufficient.

## Workflow topology

Names and triggering details are implementation proposals; they do not describe existing configured checks.

| Workflow                    | Trigger/trust                                                                       | Responsibility                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify.yml`                | Unprivileged PR events, including becoming ready                                    | Declaration/content bindings, commit/policy checks and affected macOS/shared suites; one required `PR verification` aggregate                                                                                  |
| `release-macos.yml`         | Protected main push in the exact project repository                                 | Relevance planning and affected integrated checks; app candidates additionally receive complete macOS verification, tag/input preparation, packaging, exact-artifact qualification and GitHub Release creation |
| `publish-macos.yml`         | Successful trusted release workflow completion, or explicit exact-release selection | Read the exact completed GitHub Release, verify identity/assets/receipts and publish to the host; never build or create a replacement release                                                                  |
| `dependency-monitoring.yml` | Schedule against main and explicit dispatch                                         | Independent vulnerability/maintenance reports; no dependency edge into PR/release aggregates                                                                                                                   |
| `ci-tool-image.yml`         | Reviewed trusted image-input changes or maintenance dispatch                        | Tool-image build/inspection/publication; never app publication or automatic consumer-lock updates                                                                                                              |
| `diagnostics.yml`           | Explicit dispatch, protected authorization for paid work                            | Selected design/visual/coverage/provider diagnostics                                                                                                                                                           |
| `release-recovery.yml`      | Explicit authorized selection of an existing operation                              | Inspect, then separately authorize reconciliation of the exact tag/release/notary/publication operation                                                                                                        |

Do not rely blindly on a `release: published` event: operations performed with the default workflow token may not trigger another workflow. The proposed automatic connection is a successful trusted `workflow_run`, with the producer identity bound to the completed GitHub Release. Validate repository, workflow identity, protected ref, source revision and exact release ID; never select the mutable `latest` release. Test the triggering path before enabling it. Local scripts accept the same release ID directly without Actions lookup. Prefer this over adding a separate GitHub App/PAT solely for event chaining.

Draft PRs may receive reduced feedback but cannot merge without the ready-PR plan. Avoid workflow-level path filters that leave the required check absent. Support `merge_group` before requiring the check for an enabled merge queue.

## Versionless fragments and release identity

### Changelog assembly without a release commit

Use one independently identified fragment file per PR rather than a contended shared list. A proposed `changes/<unique-id>.json` contains public entries or an explicit empty list/internal reason; nonempty entries contain reviewed English/German content and existing categories/platform applicability. This path/schema is not yet an implemented contract.

For a source commit selected on main:

1. Identify the preceding completed GitHub Release and its trusted source tag; a reserved/failed tag or incomplete draft is not a completed release baseline.
2. Select new declarations reachable in the candidate source but not assigned to that baseline/history. Use committed fragment identities and Git membership, not commit subjects or timestamps. Validate collisions, amendments and ancestry.
3. Allocate the public version and build identity, then compile the approved entries and prior finalized history into immutable build inputs outside the tracked source. Empty public release notes remain valid. Internal reasons never enter public notes.
4. Build and qualify using that source and the generated inputs. Attach the input manifest, finalized localized catalogs, package inventory and qualification evidence to the GitHub Release; publish only intended public files.
5. Retain fragment files in Git; do not delete them or update version pins through a release commit. Future assembly derives assignment from completed release evidence.

Distinguish content assignment, public compatibility and host-channel availability. The previous completed GitHub Release determines already assigned release notes and bundled history. Public GitHub Releases are published app versions even before host promotion, so migration/workspace/plugin compatibility qualification must cover their verified source/manifests as well as legacy host publications. The host's publication inventory remains authoritative for website/update availability, host race checks and the installed predecessor used for host-channel update qualification. If GitHub Release A exists but host publication failed, release B retains A's finalized history while host publication may skip A. Failed builds/drafts do not consume fragments; successful GitHub release assignment must not erase entries merely because host promotion remains pending.

Preserve historical numeric versions/catalogs/routes/signatures and hash-bound bytes. No historical import or retroactive notes. The installed bundle contains finalized history at or below its installed version, including skipped versions, without automatic display or a release-note service.

### Bundled version history in the app

Generate the complete app-facing release catalog during the build, not in a release commit or at application startup. Tags identify source/version boundaries, committed fragments provide reviewed localized text, and completed release evidence distinguishes finalized history from reserved/failed candidates. Add the current candidate using its reserved version and selected fragments before packaging.

Reuse the current app contract where possible: `installedVersion`, numerically ordered version records, optional dates and locale-specific text/entries. `client/app/src/updates/release-history.ts` and `ReleaseHistory.vue` already render that catalog rather than reading repository files. The frontend build plugin in `client/scripts/release-history.mjs` already accepts an explicit catalog file and SHA-256 through `SITUATE_RELEASE_HISTORY_FILE` and `SITUATE_RELEASE_HISTORY_SHA256`, embeds it for the UI and emits `situate-release-history.json`. Extend the compiler/input validation, not the app into a Git client.

The build compiler must:

- Resolve trusted release tags/source objects and finalized historical inputs before bundling; shallow/incomplete history or missing required assets fails rather than silently truncating the catalog.
- Retain finalized historical text/catalog inputs and digests, including the existing committed release history. Tags/fragments explain membership, but a newer compiler must not rewrite previously finalized prose or invent old metadata. Retained sealed inputs also support deterministic reconstruction with the recorded compiler/input identity.
- Produce English and German entries with the assigned version, include the current candidate even when its public entry list is empty, and retain skipped earlier versions. Exclude drafts, unassigned future fragments, newer uninstalled versions and internal empty-declaration reasons.
- Bind installed/native/public version, generated catalog and signed resource/manifest digests. Generate the catalog once for the candidate; frontend and native packaging consume the same bytes before signing. Publisher execution does not regenerate history.
- Keep the app offline and independent of Git/GitHub APIs. About/history access, language fallback, numeric ordering, search and installed-version filtering remain product behavior, not CI-specific features. No workspace migration, history preference or automatic post-update announcement is introduced.

A tag timestamp is not a reliable publication date: reservation, successful GitHub Release creation and host activation can occur on different days. For the first implementation, propose omitting the optional display date for newly assembled releases rather than inventing a future publication time. Preserve existing historical dates. Actual GitHub/host availability timestamps remain external evidence; do not modify or re-sign an app to insert them later.

### Proposed tag and build-number contract

Use immutable annotated release tags pointing to the original reviewed main commit, not a generated release commit. Suggested public names are `vYYYY.M.N`. The tag and sealed release manifest bind source, version, build identity, fragment set/digest and generated inputs. Final tag metadata/schema and the Apple representation still require implementation design and historical-value inventory.

Allocate using the maximum valid reservation in the namespace plus one, not the number of tags returned by a query. Public CalVer allocation uses the UTC month; build allocation uses the maximum recorded build sequence. Account for old numeric-version tags, gaps, reserved/failed candidates, month/year transitions and clock regression. Do not use Actions run numbers or count unrelated tags.

Reserve tags without force under one short, shared allocator lock for CI and local callers; an existing controlled host lock can serialize this without storing a second release-membership database. A per-tag creation race alone cannot guarantee global build-sequence uniqueness across different tag names or month boundaries. Concurrent creators must detect rejected or stale allocation, inspect the actual refs and either resume the matching reservation or allocate a successor. An uncertain push is inspected before another attempt. Never delete, move or reuse a reservation to fill a gap. Enforce tag protections for both CI and local operators.

A tag proves source/identity, not successful notarization, complete assets or host availability. Draft/complete GitHub Release state and sealed receipts record package completion; the host retains publication state. Private durable notary/recovery journals are still needed for external attempts. Deriving membership from Git does not reconstruct an unknown Apple or SSH outcome.

## Execution paths and concurrency

### Release creation

Plan affected integrated checks and app impact before fan-out. Non-app changes finish after their relevant checks without client work, a tag or a GitHub Release. Existing app candidates continue under their own operations.

For app candidates, add all mandatory macOS source suites to the plan before scheduling and execute the union once. Verify exact integrated inputs, the union of publicly available GitHub Release and legacy host compatibility baselines, host-channel publication history and generated release inputs; preliminary source-only results cannot qualify altered build inputs. Build/sign/notarize the final universal app, seal DMG/updater equality and qualify installation/update without advertising the candidate publicly. Complete the exact GitHub Release only after required package/qualification evidence exists. Uncertain creation/upload/finalization requires inspection; never overwrite differing assets under an existing completed release.

Use a private draft for incomplete asset assembly where appropriate. GitHub Release notes are mechanically assembled from reviewed fragments, not generated from commits or rewritten by an agent. Record GitHub release/tag/asset identities and hashes. Configure GitHub immutability where available and supported; publisher-side hash/identity verification remains mandatory independently of that setting.

### Host publication

The separate publisher downloads assets from an explicit GitHub Release ID/tag in the exact repository. Verify a complete non-draft release, tag-to-source binding, manifest/input/content digests, package hashes/signatures/identity and final-artifact receipts. Do not trust an event, filename, `latest` alias or successful asset download alone.

Re-read trusted host history and reject stale baselines or an older completed candidate overtaking a successor. Qualification/evidence may need renewal without changing bytes. Preserve verified SSH host keys, host-wide locking, immutable uploads and atomic common download/feed activation. Website deployment must not own that pointer.

Record request identity before SSH effects, then verify public HTTPS feed/download identity after activation. Storage presence is not proof of public availability. Unknown outcomes block blind retries; inspect before explicit matching reconciliation. Correct a faulty app with a higher version; pausing availability must not advertise an older app.

### Initial parallel layout

Assume compilation/native journeys dominate the critical path and planning is comparatively small. This is not a measured result. Use one job per selected family, except a required tooling-host split, without per-test/crate/locale/architecture matrices. Available runner capacity may queue jobs; no new paid capacity is authorized by this plan.

| Family                     | Host and scheduling                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Plan                       | Suitable Linux/local host, no product SDKs; emits exact suite/host/app-impact selection                      |
| Repository policy          | Linux tools; declaration/commit/review, applicable formatting/docs and secret scanning                       |
| Developer/delivery tooling | Host required by selected suites; DevTUI native/toolchain checks on `macos-latest`                           |
| Client frontend            | Linux tools; applicable units/types/builds, not product browser/native flows                                 |
| macOS Rust/Swift           | Isolated `macos-latest` job; serialize commands sharing Cargo/Swift outputs                                  |
| macOS product browser      | Separate `macos-latest` job alongside code/native checks                                                     |
| macOS native fixtures      | Separate `macos-latest` job; one journey per owned desktop at a time                                         |
| Aggregate                  | Requires every selected suite receipt; deliberate unselection differs from missing, failed or cancelled work |

Selected lanes depend directly on planning, not an unrelated global quick-check barrier. Only app candidates continue to serialized final build/qualification and GitHub Release completion. Host publication is a different workflow but shares external-operation coordination where a concurrent publication could invalidate a release baseline. Do not hold an abandoned distributed lock indefinitely across workflow boundaries; unresolved operations retain explicit recovery state rather than being treated as a free slot.

Locally, run the same logical graph with safe resource scheduling: one writer per build directory, no dependency installation alongside readers, one native journey per desktop. Use existing command coordination or isolated worktrees, not several uncoordinated supervisors. Cancellation never establishes that a remote operation did not happen.

## Platform and relevance selection

Target platform, execution host, profile, changed-input selection and optional diagnostics are separate dimensions. Only `macos` is an active product target. A Linux shared result contributes to its plan but cannot stand in for missing macOS-native work. Profiles select subsets; actual app candidates still need the complete source and final-artifact gates. Optional diagnostics cannot activate deferred platforms.

The current `mvpSuiteEnabled`, `scope/profile: mvp`, CI validators, CLI help and DevTUI labels need coordinated replacement. Preserve saved-report readers where needed; do not rewrite historical reports or unrelated product milestone terminology.

| Inputs                                                                                          | Select                                                                | Do not select solely for this input                                             |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| DevTUI source/private Cargo manifest, lock or toolchain                                         | DevTUI tests/lint/format and relevant command/report/policy contracts | Client Vue/Rust/Swift/browser/native suites, client builds, release reservation |
| Developer launcher/Pi roles/developer-only tools                                                | Owning/consuming tooling tests and applicable policy                  | Full-client fallback just because a path begins with `tools/` or `.pi/`         |
| Ordinary docs/security policy                                                                   | Format/document/link/policy checks                                    | Client runtime/builds                                                           |
| The required new versionless fragment, including an empty declaration beside a tool/docs change | Declaration/content-binding and assembly contracts                    | Client fan-out or an app release merely because every PR must add a fragment    |
| Requirement records                                                                             | Catalog validation/units and docs/policy                              | Viewer builds/browser or client qualification without a dependency              |
| App/shared UI/localization/native code                                                          | Explicit frontend/Rust/Swift/browser/native/build consumers           | Deferred-platform jobs or unrelated tools                                       |
| Native harness or release/signing/publisher scripts                                             | Own contracts and product/qualification consumers actually affected   | Blanket tool-only classification or all-client fan-out without a reason         |
| Config/dependency lock                                                                          | Actual consumers and transitive verification dependencies             | Global fan-out for every nested manifest/lockfile                               |
| Genuinely unknown dependencies                                                                  | Visible conservative supported-scope selection                        | Silent omission or unknown-path fallback for known developer-only files         |

Reuse explicit suite input rules and a small consumer map rather than invent a dependency-analysis framework. Report selection reasons. Handle deletions and both sides of renames, valid exact SHAs, PR merge bases, preceding main revisions, multi-commit pushes and squash merges. Missing history is a planning failure, not an empty passing selection. Track cumulative undelivered app changes separately from the latest verification diff.

Group existing suites into shared/delivery tooling, frontend, macOS Rust, Swift, browser and native groups with individual outcomes. Final package/signature/install/update checks are additional release gates. Audit broad Node discovery/globs and split mixed platform-only tooling fixtures only where needed. Retain historical catalog readers even when fixtures mention iOS. Scope source lint/format where safe; repository security controls remain explicit. Unknown suites/host assignments fail planning rather than disappearing.

## Independent dependency monitoring

Dependabot remains configured for grouped npm/Cargo security fixes and SHA-pinned Actions updates. Verify dependency graph/alert/security-update settings independently of the configuration file. Security fixes are separate PRs; vulnerability monitoring must not be a required PR status or a prerequisite of either release workflow. Exclude network advisory scans from complete macOS release verification too, otherwise an unrelated PR would still be blocked indirectly after merge.

The proposed first schedule is weekly plus explicit dispatch against main, running npm audit and the complementary Rust advisory/maintenance scan through local scripts. Restoring a scheduled npm scan is a proposal following the separation decision, not an implemented replacement of Dependabot; its exact cadence remains to be confirmed. Findings/service failures are visible in that independent workflow and handled separately, not converted into unrelated PR failures. Source-bound secret, license, ban and allowed-source checks remain mandatory; changing advisory databases must not leak back into those supposedly deterministic checks.

Do not automatically rewrite dependencies or commit fixes in ordinary PR/release jobs. Restrict Cargo policy to supported Darwin targets while preserving shared findings and reviewed exceptions. Test that a newly announced advisory does not alter required PR/release aggregation and that monitoring failures remain observable.

## Remaining design and qualification work

| Item                                       | Selected direction and remaining proof                                                                                                                                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap                                  | Pinned checkout exception accepted; subsequent setup/runtime must be repository scripts, with local equivalents.                                                                                                                                                                                   |
| Fragment/tag/input schema                  | Versionless per-PR files, Git-derived membership, no release commit and immutable generated assets selected. Final schemas, atomic reservation metadata and strict old/new readers need implementation and tests.                                                                                  |
| Build numbering                            | Tag-derived monotonic sequence proposed, not raw tag counting. Inventory published values and qualify an Apple-valid representation before enabling automatic allocation.                                                                                                                          |
| Source/content authorization               | Reuse script-level source/translation review and explicit local authorization; preserve hash bindings without a separate approval service.                                                                                                                                                         |
| Native execution                           | `macos-latest` selected; image/toolchain observations go into evidence. No extra matrix/provisioning in this increment. Missing desktop/routing prerequisites still fail; broader OS/Intel runtime evidence remains an explicit limitation.                                                        |
| Isolated production-endpoint qualification | Private HTTPS test listener with restricted tunnel/routing in the test environment; unchanged production URL/TLS and no public pointer activation. Prefer keeping certificate keys on the existing TLS host. Implement and verify isolation before relying on it.                                  |
| GitHub Release handoff                     | Separate creator/publisher, exact release/asset identities, hash-bound evidence and token-compatible workflow chaining; test normal, local and interrupted paths.                                                                                                                                  |
| Repository protection                      | Required PR status, protected main/tags, no force-push/deletion, trusted release refs/events, least-privilege credentials and no production-capable persistent runners for fork PRs. No mandatory second maintainer or routine post-merge release approval. Settings need authorized provisioning. |
| Retention/recovery                         | Apply the start rules below, independent encrypted backup and verified signing/access recovery. No extra service or spending is selected automatically.                                                                                                                                            |

### Retention start rules

- Ordinary logs/screenshots: 7 days.
- Resolved unpublished candidates: 30 days. Reserved tags/identity records are not deleted to reuse numbers; finalized GitHub Releases are not unpublished candidates merely because host promotion has not happened.
- Unresolved operations: no automatic deletion.
- Published packages, source/generated inputs, finalized catalogs, symbols and release evidence: no automatic deletion initially.
- Keep private journals, diagnostics and keys out of public GitHub Release assets. Use an encrypted independent backup, not only another directory on the same host. Rehearse restoration and independent signing-key/account recovery before unattended publication.

## Implementation sequence and acceptance

### 0. Inventory and finalize contracts

Inventory released source/manifests/catalogs/build values and required synthetic compatibility fixtures. Settle fragment/tag/input schemas, reservation races, content/compatibility/host-channel baseline semantics and creator/publisher identity transfer. Verify permissions/capacity and the private HTTPS test-listener design. No secret values or private diagnostic data enter public fixtures. This is contract/provisioning verification, not an OS-matrix or performance-variant study.

### 1. Shared script runner and adapters

Implement explicit plan/run/stage/status/inspect/reconcile interfaces for both workflows with structured progress/results and predecessor evidence bound to source/input/candidate hashes. Reuse registry/builder/publisher primitives. Add YAML contracts allowing only the pinned checkout bootstrap and direct script execution. Test local fixture runs with GitHub event variables absent and Actions APIs unavailable; GitHub service adapters use explicit credentials/IDs, not an Actions dependency.

### 2. Platform/relevance planner and parallel lanes

Implement the tables above, replace generic scope/profile coupling and constrain extended diagnostics. Keep quick feedback's five-second budget. Prove coverage without duplicate selected suites. Assert negative selection for developer-only source and nested locks together with their required new fragments on PR/main/local plans, as well as positive transitive-consumer selection. Test graph prerequisites, native/output ownership, missing-host failure and fail-closed aggregation. Monitoring is deliberately outside required plans.

### 3. Fragment review and automatic assembly

Add author/validate/source-approve/translation-accept commands, unique IDs available before PR creation, empty reasons and complete English/German bindings. Every PR/bot participates; no bypass label. Preserve content review before translation and invalidate bindings after source/relevant behavior changes. Protect immutable finalized content. Integrate the generated catalog with the existing frontend build plugin, native signed resource and release-history UI contract. Test parallel PRs, reused IDs, amendments, missing declarations/locales, all-empty releases, failed drafts, historical-version ceilings, missing Git/tag history and byte-identical reuse of sealed historical inputs. Add focused product/build contracts for version labels, English/German content, offline rendering, skipped versions and empty current entries; no Git access is allowed at app runtime.

### 4. Git identity and immutable inputs

Implement the qualified tag reservation/input contract without bot commits, dirty-source exceptions or relaxed migration ancestry. Test competing creators, uncertain ref creation, failed reservations, retry across UTC/month/year changes, clock regression, gaps and old tags/build values. Two successive automated releases must retain source ancestry and pass strict migration/checkpoint verification. Extend compatibility readers to include verified public GitHub Releases, including a release never promoted to the host; a failed history read cannot become an empty baseline. Keep existing host checkpoint proofs/race inventory and distinguish GitHub Release publication dates from host availability.

### 5. Packaging and final-artifact qualification

On `macos-latest`, prepare dependencies without signing keys, import Developer ID into an isolated temporary keychain only for signing, and use operation-scoped notary/updater inputs. Explicitly build macOS/direct/universal. Preserve signature/identity/version/architecture checks, stapling, Gatekeeper and DMG/archive bundle equality. Set public and Apple build fields explicitly.

Durably record notary intent before submission and IDs before waiting; runner-loss cleanup cannot rely on an `always()` upload. Inspect unknown submissions rather than retry. Qualify quarantined download/installation/first launch and signed predecessor-to-candidate updates with synthetic released-data fixtures, multiwindow/unsaved-edit preparation, cancellation/replacement/relaunch/recovery and verified cleanup. Use the production URL with isolated routing and normal TLS. Instrumented smoke builds do not replace final artifacts. Record actual host coverage and unavailable native evidence accurately.

### 6. GitHub Release creation and separate host publisher

Create/complete the release only with qualified packages and sealed public manifests/catalogs/receipts. Require the pre-existing exact reserved tag and its source SHA; never let GitHub implicitly create a tag from the moving default branch. Inspect uncertain API outcomes, reject differing existing assets and retain immutable identities. Then implement the separate read-only GitHub asset consumer and existing host transaction/recovery primitives. Verify baseline freshness again before promotion; never rebuild/re-sign as publication recovery. Test wrong repository/release/asset, stale source/baselines, failed or modified assets, token-suppressed trigger assumptions, duplicate dispatch, partial upload, host activation and public-availability uncertainty.

### 7. DevTUI replacement

Replace old release orchestration, per-release manual version selection, release-level note-agent continuation, iOS/combined actions and test bypasses. Present the same release-creation and publish-existing-GitHub-Release commands as CLI/CI, with exact source/tag/release/destination and per-stage progress. No Rust duplicate gate graph. Shared scripts enforce authorization/qualification. Preserve logs, drafts and old artifact/journal readers; schema migration must be recoverable. Test keyboard/mouse, reopening, malformed/partial reports, Actions outage and inspect-first cross-host recovery.

### 8. Cutover

Temporarily compare correctness of old/new verification, not performance variants. Test draft/ready/fork/bot/main events and provision required statuses/main/tag protections through authorized operations. Exercise local/CI races, restore and signing recovery. Pilot creation and publication as separate workflows, including local execution without Actions. Verify one app merge can create a GitHub Release and independently promote its exact assets, while a tool-only merge schedules no client work. Delete superseded active/disabled workflows, orphaned actions and legacy DevTUI orchestration; update durable guides to actual commands. Enable unattended operation only after the evidence review.

Use the [test guide](testing.md): focused contracts, quick/feedback checks for code changes, changed verification against up-to-date origin/main before implementation PRs, and full macOS/final-artifact gates for app releases. Report failed, unavailable, unselected and not-run checks distinctly. No actual GitHub publication, tag creation, environment modification or paid capacity is authorized merely by this plan.
