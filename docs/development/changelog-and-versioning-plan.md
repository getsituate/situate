# App versioning and release history implementation plan

## Outcome and scope

This plan describes the retained release-level preparation workflow. The selected successor design is [CalVer](../architecture/09-architecture-decisions/ADR-0017-calendar-versioned-app-releases.adoc) with [PR changelog fragments](../architecture/09-architecture-decisions/ADR-0018-pull-request-changelog-fragments.adoc). Current delivery is macOS-only; iOS tooling below is deferred reference material, not a release gate.

Add an optional, localized release history to Situate and an agent-assisted release-preparation workflow to the development terminal. Maintainers choose the product version, review and approve the source text, and then generate translations. Distribution builds reuse the approved texts; building never invokes a model.

The release history starts with the first release prepared through this workflow. The installed app includes all finalized, committed release notes at or below its installed version from that point onward. Opening the history requires a user action, including after updates. The Updates page links to this installed history, not to notes for an available update. About Situate provides the same history on every distribution channel. The app makes no requests for release notes and does not need a record of which intermediate versions the user installed.

This plan proposes implementation details. It does not establish implementation progress or authorize commits, tags, uploads, publication, deployment or paid model use.

### Product and design basis

- [REQ-0068](../../requirements/data/requirements/REQ-0068-update-direct-desktop-installations.md): optional user-oriented history and distribution-specific update authority. Extend the entry to record the installed-version ceiling and release-preparation approval before implementation.
- [Foundations](../../requirements/data/foundations.md#app-version-numbers-and-release-communication): the selected `YYYY.M.N` CalVer policy supersedes this plan's scope-based product numbering; automatic feature announcements remain deferred.
- [REQ-0047](../../requirements/data/requirements/REQ-0047-choose-interface-language.md) and [REQ-0053](../../requirements/data/requirements/REQ-0053-enforce-interface-translation-completeness.md): German and English, completeness checks and English runtime fallback.
- [REQ-0069](../../requirements/data/requirements/REQ-0069-preserve-workspace-version-compatibility.md) and [REQ-0070](../../requirements/data/requirements/REQ-0070-preserve-plugin-api-compatibility.md): data and plugin compatibility remain independent of version-number increments.
- [ADR-0011](../architecture/09-architecture-decisions/ADR-0011-build-time-distribution-variants.adoc): store-managed apps do not acquire an app-owned updater through the history feature.
- Workshop design commit `7bae99dafc5c03a26baf071b94aa5969d4508ac0`, particularly `client/workshop/src/updates/` and its browser tests. It provides optional history, search, list/detail navigation, About access and focus restoration. Review the selected design before product adoption under the [workshop procedure](design-workshop.md).

The workshop design still needs the installed-version ceiling: its example catalog must not expose newer releases when an older installed version is selected. This is a scoped design correction, not approval of every workshop experiment.

### Exclusions

- Automatic feature promotion, post-update dialogs and notes for newer uninstalled versions.
- A release-note service, remote history refresh, analytics or per-user read tracking.
- Backfilling changelogs, importing release records or collecting publication evidence for releases that predate this workflow.
- Automatic version selection from commit types, rewriting old Git history or generating public notes during ordinary commits.
- New distribution channels, deferred product platforms or automatic App Store publication.
- Workspace migrations, new plugin contracts or changes to existing update installation/recovery rules.

## Existing integration points

| Area                 | Existing boundary                                                                                                                                                        | Planned change                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development terminal | `tools/dev-tui/src/{actions,app,process,text,ui}.rs` runs release commands and owns confirmation, cancellation and output.                                               | Add release preparation and content approval without embedding model or Git analysis logic in Rust.                                                             |
| Apple builds         | `client/scripts/apple-release.mjs` reads the Tauri app version, records a source revision and builds signed packages. Direct builds require a clean, unchanged revision. | Validate and embed the approved release catalog before packaging; preserve signing and revision checks.                                                         |
| Publication          | `infrastructure/releases/publish.mjs` checks exact reviewed revisions and immutable artifacts; its private journal records publication outcomes.                         | Validate the release-content identity; derive subsequent release baselines from finalized, committed changelogs. Do not publish standalone changelog endpoints. |
| Product UI           | `client/app/src/settings/SettingsView.vue` and `client/app/src/updates/UpdateSettings.vue`.                                                                              | Add About and a shared optional history reader, independent of updater availability.                                                                            |
| Localization         | `client/packages/localization/src/` owns German and English catalogs and fallback.                                                                                       | Store translated release prose in locale catalogs and add completeness checks for release entries.                                                              |
| Commit guidance      | `.pi/role-mode/skill-library/commit-work/SKILL.md` already requests Conventional Commits; recent history contains mixed styles.                                          | Add one repository-wide convention and validate new commits without rejecting existing history.                                                                 |

## 1. Establish release identity and the comparison baseline

For the first release prepared through this workflow, the maintainer explicitly chooses an existing Git revision as the comparison baseline. Verify that it is an ancestor of the analysis revision and retain both revisions in the preparation record. No changelog, imported release record or publication evidence for an older release is required.

Use finalized release metadata and locale files under `releases/` and the localization catalogs as the release inventory. No publication index or public-availability evidence is required for changelog inclusion.

For subsequent product versions, use the analysis revision of the highest earlier version with finalized, committed release notes as the comparison baseline. Retain existing platform metadata without scheduling iOS delivery; current releases are macOS-only. A divergent hotfix/release branch requires explicit baseline review rather than silently comparing against the newest tag.

**Completion:** a maintainer can inspect the exact comparison baseline and distinguish finalized notes, drafts and another build of the same product version.

## 2. Define release files, approval and build binding

### Proposed storage

- `releases/<version>/release.json`: versioned metadata, comparison revisions, supported locales, entry IDs, platform applicability, source approval and final content hashes.
- `client/packages/localization/src/catalogs/releases/`: localized titles and entry text, grouped by product version and locale. Non-English prose remains in translation-catalog values rather than English developer documentation.
- Git-ignored preparation data: incomplete drafts, generation progress and commit-to-entry evidence. Do not bundle raw agent conversations or internal evidence into the app.

Use a small structured catalog with stable entry IDs and plain-text paragraphs or lists. Optional categories cover capabilities, workflow changes, fixes and required actions. Do not require empty sections or turn a one-line correction into an article. The renderer does not accept model-generated HTML, executable content or remote assets. Avoid adding Markdown unless the approved design needs formatting that the structured entries cannot express.

Derive required locales from the application's supported-language definition, with one shared declarative locale list if needed. Do not maintain a second independent language list inside the TUI. English is the proposed source language; confirm this before implementing generation. German and English remain required for the initial catalog.

### Binding without a self-referential Git hash

1. Set the selected version in all existing version-bearing files, update required lockfiles and commit the application source. This creates the immutable analysis revision.
2. Generate notes against that revision and the selected comparison baseline.
3. Record explicit approval of the source-text hash, target version, baseline and analysis revision. Translation starts only after this action.
4. Translate, validate and record hashes of the completed locale files. Preserve the source approval separately from the final complete-content check.
5. Commit only the release metadata and locale files as a separate release-content commit when authorized.
6. At build time, verify that changes after the analysis revision are confined to those exact release-content paths. Record the final build revision and release-content digest in the build manifest.

The metadata refers to the earlier analysis revision, not the commit containing itself. A source-code, tool, version or baseline change requires renewed analysis and approval. A source-text edit invalidates its approval and translations. A translation edit invalidates the final content digest but need not invalidate an unchanged source approval. Changing only the external iOS build-number argument does not regenerate notes.

Approval is a workflow record of an operator action, not a cryptographic claim about a person's identity. Never accept an agent response as source approval. Finalization writes complete validated files atomically; interruption must not leave an incomplete draft that passes build validation. Conflicting preparation/finalization for the same version is rejected without replacing existing work.

Published artifact bytes remain immutable. Rebuilds use the recorded locale files without a model call, and publication retains the existing prohibition on replacing differing bytes under the same version.

**Completion:** a stale approval, edited translation, changed source revision or version mismatch prevents a distribution build with an actionable explanation.

## 3. Implement agent-assisted preparation outside the TUI

Add a Node entry point under `tools/` with reusable operations for preparing, reading status, approving source, translating and validating. These are proposed operations, not existing commands. Use the repository-pinned Pi dependency through a narrowly configured development-agent adapter; confirm its supported API before implementation. Do not route this through the installed app's AI connections or plugin runtime.

### Generation

- Resolve baseline and target to immutable Git objects before collecting data. Read committed content, not arbitrary current working-tree files.
- Supply commit subjects/bodies, changed-path summaries and relevant diffs. Include legacy non-conventional commits. Merge commits do not create duplicate entries; reverts and follow-up corrections must be evaluated against the final target behavior.
- Distinguish product implementation from requirements, workshop experiments, tests, website work and internal refactoring. A `feat` commit is evidence to inspect, not proof of a shipped capability.
- Give the agent bounded, inspectable source access. Preserve an internal mapping from each proposed entry to supporting commits/diffs. When context is too large, process bounded groups and consolidate; never silently truncate evidence and claim a complete draft.
- Produce user-oriented entries with concrete effects, relevant limitations and platform differences. Surface uncertain statements to the maintainer instead of inventing benefits, completion claims or performance measurements.

### Approval and translation

The maintainer can inspect evidence, edit the source text, request a revised draft or approve it. Failed or repeated generation must not overwrite an approved record silently. Translation consumes the approved source and the supplied voice/localization guidance, preserving entry IDs, facts, numbers, negation and applicability. It cannot add features or weaken warnings. Offer all language files for inspection and editing before finalization.

Validate structure, locale coverage, matching entry IDs and required fields. Automated checks establish completeness, not translation accuracy; the human source review and available translation preview remain explicit. Missing access, model errors, malformed output or cancellation leave preparation incomplete and existing approved files intact. Retry is a user action, not an automatic paid request.

### Access and process lifetime

Treat Git messages and file contents as untrusted input, not agent instructions. Provide no signing, SSH, publication, application-data or secret-manager tools. Restrict the adapter to the selected source material and schema output; the preparation command owns file writes. Do not inherit arbitrary project extensions or a general-purpose shell tool into the generation session.

The agent receives only explicitly configured provider access, not the root `.env` or Apple/SSH credentials inherited from release builds. Keep raw prompts and provider responses out of normal logs and public artifacts. Provider/model selection and spending authorization use the approved development configuration; never silently switch models or providers. Tests use a deterministic stub and no paid service.

Cancellation terminates owned work and preserves drafts without approving, building or publishing anything. Resuming from a valid saved stage must not repeat completed model calls automatically.

**Completion:** the command can generate, stop, resume, approve and translate with a fake agent independently of the TUI or Apple toolchain.

## 4. Extend the DevTUI release flow

Add a preparation path to the existing release menu:

```text
Choose product version and comparison baseline
  -> Generate draft
  -> Review/edit source
  -> Approve source
  -> Translate and validate
  -> Inspect language files and finalize
  -> Commit reviewed release files when authorized
  -> Build signed packages
```

Show target version, baseline revision, analysis revision, required languages and preparation state. Source approval must be a named action available only for the displayed text hash. A successful process exit, closing a preview or pressing a general build confirmation does not approve content.

Reuse existing process ownership, output, cancellation and conflict handling. Add distinct states for generation, awaiting source review, translation, incomplete/failed preparation, stale content and ready-to-build. The next action follows validated files, not a TUI-only boolean, so reopening the console restores the workflow.

Use the existing editor configured by the maintainer for text changes rather than implementing a rich terminal editor. Suspend and restore terminal handling around an interactive editor and reread/revalidate files on return. The console must not deadlock a child that is waiting for input. Give users the exact file paths if no editor is configured.

Keep preparation and artifact builds in separate invocations so no build lock or signing environment remains held during human review or model work. Coordinate artifact-writing operations through the existing per-worktree queue and reject overlapping preparation/build operations. Do not kill unrelated development processes to make a release proceed.

Existing macOS build actions require valid prepared content. Retained iOS and combined actions are deferred. The iOS build-number prompt and TestFlight-upload confirmation remain separate from the product version and editorial approval. Neither preparing nor approving notes starts a build, upload or deployment. Reusing approved content during a rerun must not regenerate it.

**Completion:** keyboard and mouse flows cover approval, editing, stale approval, cancellation, process failure, reopening and rebuilding without changing existing upload authorization.

## 5. Integrate deterministic catalog builds and publication checks

Add a shared release validator and catalog compiler. It selects all finalized, committed release entries at or below the installed product version, sorted numerically by version. It excludes drafts without finalization metadata and all higher versions even if their files exist in the checkout. Versions skipped by the user remain browsable.

Embed the selected localized catalog in the frontend bundle using an explicit build input. Production must not import files from the workshop or scan arbitrary repository paths at runtime. About reads the installed product version independently of update-support state, including retained external variants. Cross-check this identity with the native/build version and fail distribution builds on disagreement.

Inventory and align `client/package.json`, its lockfile, `client/Cargo.toml`, relevant Cargo lock entries and `client/app/src-tauri/tauri.conf.json` before adding version-setting tooling. Preserve their existing consumers; do not replace version ownership through an unrelated toolchain refactor. Product versions stay strict numeric `major.minor.patch`, with no automatic bump from commit type. Apple build numbers remain independent.

Wire validation before macOS signing/packaging; retained iOS integration is deferred. Extend build provenance with the selected release-content digest and locale inventory. Inventory manifest readers and verifiers before an additive change; update strict validators and fixtures together rather than weakening reviewed-revision checks or breaking retained build records. Existing published bundles do not require modification.

Have the publisher verify that the manifest describes the embedded catalog used by the signed payload, not merely the current checkout's files. Reuse existing immutable artifacts, hashes and remote-operation journals. Publication confirmation and interrupted-operation reconciliation stay unchanged. No note-generation agent runs in CI build, signing or publication paths.

The catalog is app-owned, read-only bundle content. Do not add workspace files, migrations, synchronized preferences or a persistent "last seen release" field. Missing locale data in an exceptional runtime failure uses the existing English fallback; missing required translations fail distribution validation. An invalid catalog must not prevent normal workspace use or produce raw internal errors.

**Completion:** the same finalized inputs yield the same release-content digest; signed macOS artifacts contain the expected current-and-past catalog without future notes or generation credentials.

## 6. Adopt the history design in the product

First correct and verify the workshop's installed-version filtering, then copy/adapt the selected reader and About flow into product code. Reconcile with `@situate/ui`, canonical tokens and `@situate/localization`; do not introduce cross-imports or synchronization between workshop and product.

- Provide one shared history dialog from Updates and About. Access is optional and never part of startup, download completion or restart handling.
- Keep About available on direct and store-managed builds; keep Updates limited to supported direct installations.
- Show localized version entries, details and platform notes. Preserve search, scroll position, back/adjacent navigation and focus restoration from the selected design.
- The installed-version ceiling applies before display, searching and adjacent navigation. An available downloaded update never changes that ceiling.
- Keep navigation and close controls reachable in narrow macOS windows, with keyboard navigation, focus containment and Escape behavior where applicable.
- Localize supplied controls/errors in central catalogs. Use the active interface language and regional date presentation, with no change to personal content or workspace settings.
- Use synthetic release fixtures, including a short patch note, a longer minor release, skipped releases, an empty search and missing-locale fallback. Do not use synthetic feature claims as actual release history.

**Completion:** history is usable offline on macOS, leaves running work alone, and exposes no updater controls or update promotions on external builds.

## 7. Introduce repository-wide commit conventions

Document these rules in `AGENTS.md` and the existing contribution/development guidance. Align the commit skill with that single rule set; add a commit-message template only if it reduces repeated explanation.

### Proposed convention

```text
fix(chat): Preserve drafts when switching workspaces

Switching workspaces could discard an unsent message.
Keep each draft with its original conversation.
```

- Require an English Conventional Commit subject: `type: summary` or `type(scope): summary`.
- Allow `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore` and `revert`. Scopes are useful, optional and not a closed taxonomy.
- Keep one coherent change per commit, together with its relevant tests and documentation. Describe what changes; add a body explaining why or the prior failure when the subject is insufficient.
- Describe observable behavior for product changes. Identify relevant platform limits or incompatible public-interface changes. Use `!` or `BREAKING CHANGE:` when applicable; the marker does not authorize a compatibility break.
- Do not require finished release prose or a custom changelog trailer in every commit. Internal changes need no invented user benefit.
- Do not include credentials, private observations, personal paths, generated tool signatures or process narration.

Implement a small validator with no dependency on model output. Test message parsing, accepted types, optional scopes, breaking markers and multiline bodies. Handle ordinary Git-generated merge/revert messages explicitly, and document squash-merge subject expectations. Do not prescribe a merge strategy solely for changelog generation.

Provide an opt-in local `commit-msg` hook and a CI check for commits introduced by the branch using the actual Git range, excluding synthetic CI merge commits. Do not silently install hooks or overwrite shared worktree hooks. Existing history is grandfathered; CI must not require rebasing or rewriting old published commits. Define the adoption boundary so already-existing branch commits are handled deliberately. Register the check with the existing test/CI selection rather than creating an unrelated release pipeline.

Commit syntax is a consistency check, not a classifier of what shipped. Generation still inspects legacy messages, final diffs and product evidence. Version selection remains manual.

**Completion:** new malformed subjects are caught locally when opted in and in CI, while existing history and normal merges remain usable.

## 8. Verification and delivery order

Implement in dependency order: catalog/baseline and version validation; preparation command and agent stub; DevTUI review flow; deterministic build integration; corrected workshop and product reader; commit checks and release qualification. Commit guidance can proceed independently once its proposed convention is approved.

| Boundary           | Required cases                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git analysis       | Legacy and conventional messages, merges without duplicates, reverted features, workshop-only changes, first preparation without earlier notes and with an explicit comparison revision, divergent branches and bounded large histories. |
| Content            | Numeric ordering such as `1.9.0`/`1.10.0`, duplicates, unknown locales, missing translations, mismatched entry IDs, invalid structure and exact approval hashes.                                                                         |
| Preparation        | Source edits, stale revisions, translation edits, malformed model output, no provider, cancellation, interrupted finalization, resume and repeat build without model calls.                                                              |
| TUI                | Named source approval, editor handoff, process errors, persisted state on reopening, conflict handling, keyboard/mouse input, narrow terminal and separate upload confirmation.                                                          |
| Bundle/publication | Final revision binding, tampered content, future/draft exclusion, current candidate inclusion, installed/native version mismatch, same content across variants and unchanged immutable-publication rules.                                |
| Product UI         | Both entry points, external builds, offline operation, no automatic opening, current-and-past-only search/navigation, localization/fallback, empty search, focus and narrow-layout scrolling.                                            |
| Safety             | No signing/SSH secrets in agent environment, no model calls in build/CI, no publication from approval, untrusted source text and no private evidence in bundled output.                                                                  |

Register new tests and release/catalog inputs in `tools/test.mjs`, `tools/test-inputs.mjs` and CI selection as appropriate. Release catalogs are runtime inputs, not ordinary prose that can skip consuming tests. Keep dependency-free checks within the five-second quick budget; use feedback or focused suites for longer tests.

Use [repository test guidance](testing.md), Volta and coordinated artifact-writing commands. The expected implementation gates are:

- Requirements validation for catalog edits.
- `node tools/test.mjs --quick --changed` and `node tools/test.mjs --feedback --changed`.
- Focused Node tests for Git analysis, content validation, fake-agent operation, packaging and publisher contracts; DevTUI Rust tests from its own toolchain directory.
- Focused workshop and product Chromium/WebKit flows. Add product visual checkpoints to existing flows; update and inspect intentional references in the locked visual container.
- Product build and native macOS checks for bundled resources, installed-version identity, About access and responsive interaction. Browser profiles alone do not qualify native behavior.
- Before a PR, `node tools/test.mjs --changed --base origin/main` against an up-to-date base. Before an Apple release, the unfiltered MVP suite and applicable native release qualification.

Update durable usage in `docs/development/README.md`, the client release guide and publication runbook when their commands actually change. Keep this plan distinct from executable command documentation. Integrate reviewed workshop changes deliberately; do not assume a separate design commit is present in the implementation branch.

## Decisions and evidence needed before implementation

1. Confirm English as the source language and the proposed commit convention/CI enforcement. These are implementation proposals, not yet repository rules.
2. Choose the explicit Git comparison revision for the first release prepared through this workflow. Older release records and changelogs are not prerequisites.
3. Select the development-agent provider/model through existing authorization and verify the pinned Pi API supports the restricted adapter. Do not assume a subscription, paid API or automatic model fallback.
