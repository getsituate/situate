# macOS distribution and auto-updater development plan

## Outcome and scope

Deliver a complete macOS direct-distribution path: a visitor downloads a signed, notarized DMG from `getsituate.com`, installs Situate, and subsequently receives verified background updates that install and restart only after confirmation.

The same repository must own the infrastructure definitions, production service configuration, website deployment and release-publication tooling. Reuse the existing Hetzner server and the Terraform, Docker Compose, Caddy and Nginx stack. Separate infrastructure adoption, service changes, application publication and website cutover so that each can be reviewed and recovered independently.

### Product and architecture basis

- [REQ-0012 — Platform availability](../../requirements/data/requirements/REQ-0012-platform-availability.md): macOS website DMG delivery; iOS remains store-managed.
- [REQ-0068 — Direct desktop updates](../../requirements/data/requirements/REQ-0068-update-direct-desktop-installations.md): scheduling, background download, quiet notification and user-controlled restart.
- [REQ-0037 — Independent workspaces](../../requirements/data/requirements/REQ-0037-keep-workspaces-independent.md) and [REQ-0011 — Parallel work](../../requirements/data/requirements/REQ-0011-work-on-topics-in-parallel.md): closure choices, saved state and interrupted conversations.
- [REQ-0069 — Workspace compatibility](../../requirements/data/requirements/REQ-0069-preserve-workspace-version-compatibility.md) and [REQ-0070 — Plugin compatibility](../../requirements/data/requirements/REQ-0070-preserve-plugin-api-compatibility.md): compatibility is separate from update promotion.
- [ADR-0011 — Build-time distribution variants](../architecture/09-architecture-decisions/ADR-0011-build-time-distribution-variants.adoc) and the [delivery and operations view](../architecture/07-deployment-view/delivery-and-operations.adoc): native update authority comes from the signed build variant, not installation-origin heuristics.
- [Workshop update designs](../../client/workshop/src/updates/design-notes.md) and the [adoption workflow](design-workshop.md): adopt the approved update controls without importing workshop code into the product.

### Explicit exclusions

- Changelogs, release-note readers, release-history storage and post-update changelog windows. REQ-0068 retains its broader changelog requirement; completing this plan does not establish full implementation of that requirement.
- Automatic replacement of unpublished prototype installations and conversion of prototype formats verified never to have shipped publicly. This exclusion does not cover data written by any public release.
- Analytics, download counting, tracking IDs, PostHog integration and new telemetry collection.
- Homebrew, other package managers, Mac App Store delivery and Windows/Linux/Android implementation.
- A new synchronization service, universal workspace-format migration framework, application-version rollback/downgrade workflow or a new hosting platform. Required data compatibility and migrations for a published app update are not excluded.

Existing unpublished prototype services may remain during preparation, but their continued compatibility is not a product requirement. Verify that no public release depends on a service before applying this exclusion. Retiring their containers, routes and files still needs an explicit operational plan; lack of migration requirements does not authorize deleting persistent data.

## Repository capabilities and evidence limits

| Area                 | Existing implementation                                                                                                                                                                                                                                                                                                                                                                   | Remaining boundary                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud and DNS        | [`terraform/`](../../infrastructure/production/terraform/) describes the existing server, firewall, SSH key, zone and seven DNS RRSets; [`terraform.mjs`](../../infrastructure/production/terraform.mjs) binds reviewed adoption plans to the HCP workspace ID, state version and plan hash. The eleven existing resources are adopted in HCP, with a subsequent no-change plan verified. | State/account and replacement-machine recovery remain unqualified; follow the [recovery runbook](../../infrastructure/production/README.md#adoption-and-recovery).                  |
| Website hosting      | [`infrastructure/production/`](../../infrastructure/production/) contains Compose, Nginx, Caddy and separate service/feed/apex activation commands; [`infrastructure/releases/`](../../infrastructure/releases/) provides immutable publication and reconciliation.                                                                                                                       | Approved host preparation, release publication, accurate privacy disclosures and public cutover.                                                                                    |
| Apple packaging      | [`apple-release.mjs`](../../client/scripts/apple-release.mjs) embeds distribution identity and creates matching DMG/updater payloads, version-bound signatures and verified manifests.                                                                                                                                                                                                    | Apple validation and native qualification of the exact release candidate; [signing-key recovery](../../infrastructure/releases/README.md#signing-key-recovery) remains unqualified. |
| Application shutdown | [`updates/lifecycle.rs`](../../client/app/src-tauri/src/updates/lifecycle.rs) and [`lifecycle.ts`](../../client/app/src/lifecycle.ts) coordinate reversible all-window preparation and installation recovery.                                                                                                                                                                             | Native save/abort, permission failure, replacement and relaunch journeys with disposable workspaces.                                                                                |
| Update interface     | [`app/src/updates/`](../../client/app/src/updates/) consumes native state, with centralized English/German copy and product browser checkpoints.                                                                                                                                                                                                                                          | Native end-to-end verification; browser fixtures do not establish installation safety.                                                                                              |

The native Rust Tauri updater handles artifact transport, version-bound signature verification and installation for explicit macOS direct builds. Feed metadata uses a bounded native HTTPS reader before the plugin's version/target validation. Situate implements application-lifetime scheduling, independent check/download retries, a reverified device-local package cache, product update controls and reversible all-window preparation. Confirmation is artifact-bound; closure is committed only after successful bundle replacement, with unchanged and uncertain failures handled separately. The workspace-only **Close anyway…** option is not available during update preparation.

The pinned macOS installer replaces the bundle separately from relaunch. Downloads can be buffered in memory, and a transport-complete callback alone does not establish signature verification. Peak memory/disk use, failure recovery, Intel-native behavior and iOS external-update authority require their own relevant native evidence; a successful macOS installation does not qualify these boundaries.

## Accepted implementation decisions

Use HCP Terraform as the authoritative production state backend, with workspace execution mode Local and one operator. [ADR-0014](../architecture/09-architecture-decisions/ADR-0014-host-production-state-in-hcp-terraform.adoc) records the choice. Every checkout and any future trusted CI runner must target the same organization and immutable workspace ID, retain remote locking and use reviewed plans. Keep independent encrypted state exports and protect account recovery. Use the [state/account recovery instructions](../../infrastructure/production/README.md#adoption-and-recovery), [fresh-host recovery instructions](../../infrastructure/production/README.md#edge-relocation-and-recovery) and [signing-key recovery instructions](../../infrastructure/releases/README.md#signing-key-recovery); recovery exercises remain unqualified. Preserve state, keys, certificates, backups and unresolved-operation guards. Do not live-sync local state copies or enable CI applies as part of adoption.

The eight choices below are accepted policies, not operational ownership or native qualification. Production configuration and signed native evidence remain delivery gates. Keep technical choices aligned with the architecture/deployment documentation and product behavior with the requirements catalog.

| Decision           | Recommendation or constraint                                                                                                                                                                                                                                                                                                                                                                                                               | Required before                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Terraform state    | Accepted: HCP Terraform state storage in a Local execution workspace, remote locking, exact workspace/state-version binding and independent encrypted exports. Account recovery and independent export restoration exercises remain unqualified; CI applies are not enabled.                                                                                                                                                               | Any production state handoff.                |
| Updater dependency | Accepted: native Rust Tauri updater for transport, signature verification and installation. Situate owns scheduling, state, UI and safe shutdown. Pin compatible versions; lifecycle and signed two-version qualification are release gates.                                                                                                                                                                                               | Production updater registration.             |
| Release hosting    | Accepted: static JSON feed and immutable DMG/updater artifacts on the existing Hetzner host, served by Nginx through Caddy without tracking. Upload and verify artifacts before activation; no additional backend, object storage or CDN.                                                                                                                                                                                                  | Publisher and embedded production endpoint.  |
| Signing keys       | Accepted: one dedicated updater keypair, separate from Apple signing. Keep the private key in 1Password and preserve its backup; embed only the public key. Follow the [signing-key recovery instructions](../../infrastructure/releases/README.md#signing-key-recovery); recovery exercises remain unqualified. Supply signing inputs through environment variables or a private key file, without coupling release scripts to 1Password. | The first distributed updater-enabled build. |
| Retry timing       | Accepted: check retries after 1, 5, 30 and then 60 minutes between failed attempts, a 30-second check deadline and coalesced immediate manual checks. Connectivity recovery retries offline checks without bypassing repeated server-error backoff. Download retries are independent; automatic failures open no dialogs.                                                                                                                  | Scheduler tests and UI error behavior.       |
| Download retention | Accepted: retain one verified update across app restarts in a private device-local cache outside workspaces, plus at most one in-progress download. Reverify before use; replace an older package only after verification. Delete after confirmed successful upgrade. Restart partial downloads from scratch with independent 1/5/30/60-minute retry waits.                                                                                | Production download state.                   |
| Install failure    | Accepted: release preparation and retain the verified package when the bundle is known unchanged. Do not replay aborted actions. Uncertain replacement/relaunch requires truthful recovery guidance, no automatic retry/restart, and explicit revalidated user action. Manual recovery uses a trusted same/newer installer without resetting workspaces; no custom automatic rollback.                                                     | Enabling installation.                       |
| Faulty releases    | Accepted: publish a fix with a higher version; no app rollback or downgrade and no feed/download metadata rewind to an older release. Never replace published bytes under the same version. Availability may be paused without advertising an older version; no package-revocation system.                                                                                                                                                 | Production publication.                      |

No backend provisioning, Terraform apply, Apple submission, remote upload, public deployment or GitHub publication is authorized by this document. Each external operation requires approval of its exact target and scope.

## Delivery sequence

Distribution builds, the update service/UI, reversible lifecycle, immutable publisher, website metadata validation and production deployment tooling are implemented. The sequence below retains their contracts and delivery gates. Use the [client release guide](../../client/README.md#direct-macos-releases), [publication runbook](../../infrastructure/releases/README.md) and [production runbook](../../infrastructure/production/README.md) for current commands. Infrastructure adoption, production/apex activation and native qualification remain separate operations. Marcus Held remains the operator and contracting party for existing services; no separate ticketing/support platform is introduced. Keep privacy disclosures accurate without inferring provider contracts or retention periods.

The existing public preview at `https://reboot.getsituate.com` can serve independently published test releases before production cutover. Its download validation accepts only that exact preview origin; production retains its production-origin restriction. Preview delivery needs no additional DNS record and does not establish production approval or adoption. The production publisher still requires the production embedded feed endpoint and production artifact URLs; a preview test does not qualify that final configuration.

Work packages should remain independently reviewable. Native qualification can run alongside infrastructure preparation without switching the apex website.

```text
1. State and operational baseline ──> 2. Cloud ownership ──> 5. Hosting and publisher
3. Native install spike ──> 4. Distribution builds ─────────> 5. Hosting and publisher
3. Native install spike ──> 6. Reversible lifecycle ──> 7. Update service ──> 8. Product UI
5 + 8 ──> 9. Website integration ──> 10. Native qualification and controlled cutover
```

### 1. Establish the state and operational baseline

**Primary paths:** `infrastructure/production/`, `infrastructure/website/`.

- Locate the authoritative production and preview Terraform states, backend configuration, lineage and serial. Missing local files are not evidence that resources are unowned.
- Inventory live resources and complete DNS RRSets, including Google Workspace MX, SPF, verification and DKIM. Preserve TXT quoting, split DKIM strings and record comments.
- Inventory the actual Caddy configuration, imports, Compose projects, networks, image digests, host hardening, deployment directories and persistent volumes. Reconcile local uncommitted configuration with the running host before selecting canonical files.
- Identify certificates, download storage, deployment journals, operational logs and backups. Define retention and deletion ownership, disk-capacity checks and restoration order.
- Configure the exact HCP organization and `situate-production` workspace in Local execution mode before adoption. Verify access, workspace identity, remote locking and independent encrypted exports; account recovery exercises remain unqualified. Saved plans and plaintext exports stay private outside Git. Recover old state where available; if it is unavailable, resolve ownership before reconstructing state through reviewed imports. Do not enable CI applies.
- Review current tool/provider/container versions. Keep the ownership handoff on a compatible pinned baseline; perform necessary upgrades separately, with explicit migration and service checks.
- Keep credentials independent of secret-manager tools. Parse only required root `.env` variables as data outside CI, let explicit environment values win, and pass credentials only to subprocesses that need them.

**Exit gate:** resource/state ownership is unambiguous, private backups are recoverable, backend locking works and the exact handoff procedure is reviewable.

### 2. Transfer cloud and DNS ownership

Follow the [production adoption runbook](../../infrastructure/production/README.md), rather than creating another migration mechanism.

- Freeze all old state writers. Transfer authoritative production state where recoverable; import only after resolving old ownership when state cannot be recovered.
- Retain existing resource identities and apply the supplied address moves for the former MX/SPF resource names.
- Transfer the preview `reboot` record into the production state without deleting it. Retire the superseded preview DNS root/wrapper and previous production automation in the same authorized handoff.
- Generate a fresh plan against the selected backend. Require the adoption checker and human review to agree on no cloud changes; do not reuse a plan from an empty local inspection backend.
- Apply only the approved state handoff. Verify state ownership, authoritative DNS, website/preview HTTPS and mail records afterward.
- Preserve deletion/rebuild guards. Do not combine this operation with server replacement, SSH rotation, operating-system upgrades or traffic cutover.

**Exit gate:** one active owner per resource, no unintended infrastructure changes and a new plan with no pending resource mutations.

### 3. Prove the native installer boundary early

**Primary paths:** `client/app/src-tauri/`, `client/scripts/apple-release.mjs`, native test support.

Use two uniquely identified synthetic application versions in an owned test installation, never the user's installed app or personal workspace. Qualification may require separately approved signing/notarization and test-feed publication.

- Confirm the selected updater's archive format, version-bound signature support, HTTPS behavior, download ownership, install thread requirements, privilege prompts, bundle replacement and relaunch semantics.
- Measure peak RAM, temporary disk use and disk-full behavior with representative artifacts. A disk cache does not eliminate an upstream library's full-buffer allocation.
- Verify installation into a writable location and the permission-denied/authorization-cancelled path. Test symlink preservation and Apple signature/ticket validity after extraction.
- Establish exactly where preparation can be cancelled, when bundle mutation begins, and which errors leave the original app usable. Exercise replacement failure and interrupted replacement without claiming crash-proof recovery.
- Demonstrate that a library restart cannot bypass application-owned closure checks. Serialize competing attempts to replace the same installation, including across processes if multiple app instances are possible.

**Exit gate:** an observed A-to-B native update and an actionable lifecycle design for cancellation, safe failure and uncertain replacement. Source review or mocked updater tests alone do not satisfy this gate.

### 4. Extend distribution builds and release artifacts

**Primary paths:** `client/app/src-tauri/` build/configuration, `client/scripts/apple-release.mjs`, release tests.

- Embed an explicit macOS direct-distribution identity before signing. Derive native policy from it; missing/unknown identity must not enable updates. Existing iOS App Store/TestFlight builds remain externally managed. Do not add a Homebrew variant.
- Register updater functionality only where native policy permits it. UI visibility and IPC authorization must use that same policy, including manual checks and downloads.
- Produce the DMG and updater `.app.tar.gz` from the same final Developer-ID-signed, notarized and stapled `.app`. Do not publish an archive generated before the release script's later stapling step.
- Add a version-bound updater signature using the selected compatible signer. Store the dedicated private key in 1Password and preserve its backup; follow the [signing-key recovery instructions](../../infrastructure/releases/README.md#signing-key-recovery). Supply it only to signing through supported environment inputs or a private key file; repository scripts must not invoke 1Password or automatically fetch secrets. Do not expose the key to broad frontend/native build environments, Terraform, logs or artifacts.
- Extend the completed release manifest with source provenance, version, distribution identity, architectures, artifact sizes, checksums and signature locations. Validate the embedded bundle identity/version and manifest agreement.
- For a universal macOS payload, verify that both supported feed architecture entries reference the correct artifact. Reject missing platform entries rather than selecting a different platform's payload.
- Retain the existing distinction between local test packages and publishable Apple distribution packages. Reject failed/incomplete builds, stale artifacts and changed bytes after approval.

**Exit gate:** independently verified DMG, updater archive and signature representing one immutable direct-distribution release, with no publication side effect from building.

### 5. Own production hosting and implement publication

**Primary paths:** `infrastructure/production/`, `infrastructure/website/`, publication tests.

- Bring canonical production Compose, Caddy/Nginx configuration and host bootstrap/recovery instructions into this repository. Reimplement first-party deployment configuration deliberately; do not blindly copy prototype scripts, credentials, analytics or private records.
- Preserve existing certificate volumes, network connectivity and deployment ownership during the transition. Avoid renaming the shared network or recreating the edge proxy merely to rename the stack.
- Serve website releases separately from persistent application artifacts. A website deploy/rollback must not delete downloads, rewind the app feed or recreate Terraform-managed resources.
- Define the static feed and release-manifest contract: valid SemVer, explicit direct distribution, supported target/architecture, HTTPS artifact URL, version-bound signature and unambiguous immutable artifact identity. Notes are not required.
- Require HTTPS for artifact URLs and redirects as well as the feed. Reject malformed/oversized metadata, unsupported targets and invalid signatures. Do not turn a failed request into an empty successful result.
- Implement preflight, upload/stage, validation and explicit publication. Serialize writers, reject version reuse with different bytes, upload all immutable files first and expose a release only after server-side verification. Enforce forward-only release activation; reconciliation of an interrupted publication may reuse only the same approved version and identical artifacts, not activate an older release.
- Correct faulty releases with a new, higher-version fix. Do not roll back the app or point the feed/download metadata to an older release. An operator may pause availability until the fix is ready without advertising an older version. Do not introduce a package-revocation service or imply that feed changes reliably revoke already downloaded signed packages.
- Activate website download metadata and updater metadata from one coherent release descriptor or equivalent atomic release pointer. Avoid windows where the download link advertises a different or incomplete release.
- Use revalidation/no-store policy for mutable metadata and immutable caching for versioned artifacts. Verify GET, HEAD, Range, content length/type, interrupted transfers and absent directory listings.
- Use strict SSH host-key checking and least-required subprocess environments. Keep recoverable operation markers/backups; inspect remote state after SSH interruption before retrying. Never assume a stopped SSH client proves rollback.
- Bypass the legacy download counter completely for new artifacts/feed requests. Do not introduce cookies, request IDs or analytics calls. Essential server/security logs need an explicit bounded retention policy.
- Add service health checks, bounded log rotation and disk monitoring/recovery procedures. Review all pinned images and their redistribution notices.

**Exit gate:** a coherent test release can be published, fetched and verified over HTTPS without tracking; interrupted publication cannot advertise missing payloads or overwrite an immutable release.

### 6. Make update preparation reversible

**Primary paths:** `client/app/src-tauri/src/lifecycle.rs`, file/workspace lifecycle, AI/process lifecycle and their frontend participants.

- Separate update preparation from irreversible closure. The existing `files::commit_quit()`/exit path must not run before an installation attempt that can still be cancelled or fail normally.
- Coordinate all open windows/workspaces. Block new action admission while the installation decision/preparation is pending, without losing saved state or permanently detaching sessions.
- Offer postponement without cancelling existing work or scheduling a later unsolicited restart. Explicit abort must stop affected agent/native process work and await teardown/history persistence before installation begins.
- Reuse existing saving, conflict, dictation and pending-synchronization decisions. Local-only workspaces have no synchronization prerequisite. Do not implement a fake synchronization success or a new sync service to match workshop fixtures.
- Bind confirmation to one verified artifact. Coalesce double clicks/concurrent requests and revalidate that the installation still has direct authority and that the prepared target has not changed.
- Complete all user vetoes and required durable saves before bundle replacement. Run the installer off the UI thread where required; finalize closure and relaunch only after successful replacement.
- If preparation, authorization or installation fails and the bundle is known unchanged, release preparation, leave the original installation usable and retain the verified package for a later user-requested attempt. Do not replay aborted actions.
- If replacement/finalization/relaunch has an uncertain outcome, preserve recovery evidence and explain the known state and recovery steps. Do not automatically retry installation or restart, claim the old bundle is intact or add a custom automatic rollback mechanism. A further attempt needs explicit user action and renewed validation of the package and installation state. Where manual recovery is necessary, use a trusted installer of the same or a newer version without deleting or resetting workspaces.
- Preserve remembered open workspaces through application quit and update restart. Explicit workspace closure instead persists removal from the startup-open set while retaining the known-workspace entry. On reopening, interrupted conversations remain retained and wait for a new user message.

**Exit gate:** cancellation and ordinary install failures do not strand file sessions, and successful installation cannot bypass application-wide save/activity choices.

### 7. Implement the application-owned update service

**Primary paths:** native host updater module/registration, device-local settings and frontend host adapter.

- Own updater state at application lifetime, outside workspace history and synchronization. Closing Settings or a workspace view must not terminate a background download.
- Model checking, downloading, verified-ready, preparing, installing and failures distinctly. A progress callback reaching completion is not verified-ready; publish readiness only after signature/version verification succeeds.
- Persist the last successful check atomically. With no recorded success, check in the background at startup; schedule the next due check 24 hours after success while the app stays open. Resume after sleep without waking the device.
- Keep startup and interaction nonblocking. Failed checks do not advance the successful timestamp. Implement REQ-0068's retry intervals, 30-second check deadline and connectivity recovery behavior without duplicate in-flight operations, background error dialogs or retry loops. The check deadline is not an overall artifact-download deadline.
- Manual checks are independent of the interval and coalesce with existing work. Keep download retry separate: a successful availability check followed by a failed download must not delay download recovery for another 24 hours.
- Handle unavailable/corrupt device-local state and wall-clock changes explicitly; do not interpret a bad timestamp or failed persistence as proof of a successful check.
- Apply no mobile-data/metered restriction to app updates. Do not reuse dictation-model network gating.
- Retain one verified package across app restarts in a private device-local cache outside workspaces, plus at most one in-progress candidate. Reverify cached bytes/metadata before use; replace the older package only after the newer one is verified. Delete the installed package after confirming a successful upgrade. Restart interrupted downloads from scratch rather than implementing range resumption; apply independent 1/5/30/60-minute download retry waits. Clean only owned stale/partial artifacts and preserve a still-valid ready update when an unrelated later check fails.
- Refuse application-version downgrades, invalid version/signature bindings, unsupported artifacts and externally managed builds. Do not send workspace content, provider credentials or tracking identifiers to update endpoints.

**Exit gate:** deterministic tests cover timing/retries, persistent timestamps, window-independent work, verified readiness and policy enforcement at the native boundary.

### 8. Adopt the update designs into the product

**Primary paths:** `client/app/src/`, existing Settings/app shell, `client/packages/localization/`, product browser tests.

- Inspect the workshop's approved current/checking/downloading/ready/restart/error states in the running preview before transfer.
- Copy and adapt only the needed update controls/styles, using product components and canonical brand tokens. Replace synthetic services with the native adapter; keep workshop and product source boundaries intact.
- Add the direct-only Updates settings entry, installed version, manual check, download progress, verified-ready state and appropriate retry/install-failure actions. Never render success text for unavailable or failed native operations.
- Add the quiet lower-right update-ready control with keyboard/focus labeling, reduced-motion behavior, narrow-layout placement and no automatic dialog or repeated reminder.
- Implement the restart confirmation with postponement and explicit stop-actions-and-restart behavior. Explain continuation through a new chat message without promising seamless action resumption.
- Omit release-note links, the “What's changing” section and post-update changelog dialogs entirely. Store/external variants expose neither update controls nor promotions.
- Add all supplied UI/error text to the central English and German catalogs. Verify screen-reader state announcements, focus return, modal dismissal and unknown download-size presentation.

**Exit gate:** product tests and native interaction match the selected designs without tracking, changelog UI or hidden updater requests from externally managed builds.

### 9. Connect the public website and operator workflow

**Primary paths:** `website/`, website tests, `tools/dev-tui/` release/deployment actions and relevant runbooks.

- Connect macOS download controls to the published DMG and release metadata. Show real version, system requirements and architecture availability; enable nothing before a verified artifact exists.
- Keep unsupported platforms on their existing appropriate destinations. Do not imply iOS store availability or deferred-platform support from a macOS release.
- Configure production host routing/redirects and the intended role of `reboot.getsituate.com`. Preserve unrelated site links that remain in use, including legal/contact/waitlist routes; review removal of prototype-only routes explicitly.
- Review the production copy against implemented product capabilities and distribution/license status. Workshop screenshots are not proof that advertised features ship.
- Match the [privacy disclosures](../../website/legal/review.md) to production-domain scope, app processing/update delivery and actual hosting/log behavior. Preserve truthful disclosures without inventing provider contracts or retention periods; avoid a self-referential legacy-notice link after cutover.
- Keep build, preflight, publication and website deployment separate operations. Extend the development console deliberately with exact destination/version/artifact confirmation; building must not silently upload or switch production traffic.
- Document release reconciliation, publication retry, website deployment recovery and forward-only application fixes. Recovery of website/runtime deployments must not rewind app-release metadata. Keep public runbooks free of private paths, credential values and private source references.

**Exit gate:** the fresh-install download path and operator entry points refer to one verified release, with accurate public content and explicit production confirmations.

### 10. Qualify the complete path and cut over

1. Freeze the release candidate source and artifacts. Require complete manifests, signature/ticket/Gatekeeper verification, applicable CI and native evidence for those exact bytes.
2. With explicit publication approval, publish versions A and B through an unadvertised new release namespace on the production host before changing the apex website. Use the production publisher, cache policies and final embedded feed endpoint; do not weaken TLS or modify a signed bundle to redirect its feed.
3. Install A from its DMG into an isolated test installation. Publish B, observe automatic discovery/background download and confirm installation/relaunch into B. Verify actual bundle version, direct authority and retained synthetic workspace/chat data afterward.
4. Verify a fresh B download through the website path. Test offline startup, long-running scheduling, sleep/resume, manual checks, a hidden Settings view and multiple windows.
5. Exercise postponement with work still running, explicit abort, save veto/failure, permission/authorization cancellation, invalid signatures, version mismatch, interrupted download, insufficient disk and failed relaunch. Require truthful failure/recovery behavior, not only an installed-version assertion.
6. Verify an actual externally managed build sends no app-update requests. If iOS is the external build under test, record native iOS evidence separately; browser/macOS tests do not qualify it.
7. Obtain separate approval for website cutover. Back up routing/runtime configuration, stage the new site, verify health, validate the complete proxy configuration and switch/reload under deployment locks.
8. Check apex/`www` HTTPS/redirects, preview routing, mail DNS, legal/waitlist links, artifact responses and matching website/feed metadata. Observe operational health without adding analytics.
9. Retire approved prototype containers, counter/tracking routes and obsolete writers through the [inventory-bound retirement command](../../infrastructure/production/README.md#retiring-prototype-hosting), after stable edge relocation and new-service checks. Prototype content/data are discarded without a full backup or restore exercise. Preserve HCP state recovery, signing keys, newly published artifacts, shared certificates, unknown content and unresolved operation markers throughout prototype retirement.

**Exit gate:** the public site serves the new app, a real A-to-B update has passed, the repository is the sole infrastructure/runtime source, and operational recovery instructions are available. Recovery exercises for state/accounts, signing keys and new services remain unqualified; use the recovery runbooks linked above.

## Verification strategy

Use [the repository testing guide](testing.md). Register new suites and inputs in the central runner; do not let fixture-only checks stand in for native qualification.

| Risk/boundary                                                | Smallest capable evidence                                                                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DNS/mail loss or duplicate Terraform ownership               | Complete inventory, no-change adoption plan, backend locking, independent encrypted exports and post-handoff authoritative DNS/state inspection.               |
| Credential leakage, malformed inventory or destructive plans | Synthetic inventory/CLI tests, credential-isolated subprocess tests and adoption-check rejection cases.                                                        |
| Interrupted deployment/publication or mismatched metadata    | Temporary-directory/fault-injected publisher tests, Compose integration and operational reconciliation guidance; remote recovery exercises remain unqualified. |
| Wrong variant, pre-stapled archive or altered release bytes  | Build/manifest/signing-order contracts plus inspection of real signed DMG/archive payloads.                                                                    |
| Invalid update authenticity or untrusted URLs                | Independent malformed/tampered fixtures and real rejection by the pinned native updater.                                                                       |
| Scheduling, retry and retained check time                    | Controlled-clock domain tests plus host integration for storage, connectivity and sleep/resume events.                                                         |
| Lost work, premature replacement or stranded sessions        | Lifecycle race/failure tests and real multi-window native journeys with synthetic chats, edits and processes.                                                  |
| UI/accessibility/localization regressions                    | Product component/browser tests, native WebView interaction and intentional visual-reference review.                                                           |
| Store-managed update traffic                                 | Native policy tests and observed requests from an actual externally managed artifact.                                                                          |
| End-to-end delivery                                          | Exact signed A and B artifacts, production publisher/feed, fresh DMG installation and verified native upgrade.                                                 |

Use Volta for every Node/npm command. Start with focused tests and then run:

```sh
node tools/test.mjs --quick --changed
terraform -chdir=infrastructure/production/terraform fmt -check
terraform -chdir=infrastructure/production/terraform validate
```

For affected product code, run the relevant host tests and `cd client && npm run build`, product browser tests and the native updater journey. Visual adoption follows the locked-container workflow in the testing guide; review changed images rather than updating them to silence unexplained differences.

Before a pull request, update the base reference and run `node tools/test.mjs --changed --base origin/main`. Before an Apple release, run full MVP verification with `node tools/test.mjs`, require the documented full Quality workflow for the exact candidate, and complete the relevant signing/distribution/native checks. Report unavailable prerequisites and checks not run explicitly. These commands do not qualify deferred platforms.

For edits limited to this plan, formatting and document/link contracts are sufficient; do not build or deploy the application merely to validate prose.

## Completion criteria

- [ ] The HCP production workspace and remote locking are verified, with independent encrypted exports preserved; infrastructure and DNS have one active Terraform owner. Follow the [state/account recovery instructions](../../infrastructure/production/README.md#adoption-and-recovery); recovery exercises remain unqualified.
- [ ] Canonical production runtime/proxy/deployment configuration is maintained here, without dependence on the prototype repository or a secret-manager CLI.
- [ ] Direct macOS DMG and version-bound signed updater archive contain the same final notarized/stapled application and are published coherently.
- [ ] `getsituate.com` provides a working fresh-install download without tracking.
- [ ] Background/manual checks, persisted 24-hour scheduling, retries, progress and verified-ready notification work at application lifetime.
- [ ] Update installation respects activity/save choices, can be postponed, handles failure safely and restarts only after confirmation.
- [ ] Native A-to-B qualification preserves synthetic workspaces and interrupted conversations without automatic replay.
- [ ] Externally managed builds have no built-in update UI or network operations; no package-manager variant has been added.
- [ ] Changelogs, analytics and conversion of verified unpublished prototype formats remain outside this delivery; published-version data compatibility is verified separately.
- [ ] Public copy and privacy disclosures match the enabled services and release evidence before approved cutover; operational recovery instructions are available.
