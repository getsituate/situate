# Direct macOS release publication

Release creation and host publication are separate workflows. Creation verifies reviewed source, reserves identity, generates inputs, builds and qualifies the final macOS packages, then completes a GitHub Release. Publication downloads one exact completed GitHub Release and promotes its unchanged assets to the website/update host. The publisher never builds, notarizes, re-signs, changes DNS, submits to Apple or rolls back an app.

Unattended operation is not qualified or provisioned by these scripts. Repository and tag protections, scoped credentials and isolated production-endpoint qualification must be verified before enabling automation. Operational backup, restore, signing-key and account-access recovery evidence is not a release gate. A passing synthetic test or an existing workflow file does not authorize publication.

## Prerequisites

- Use the [Volta toolchain](../../docs/development/README.md#install-volta), macOS, Python 3.12 or newer and Apple verification tools. Keep the release source and required published compatibility commits available locally; missing history fails rather than being fetched implicitly.
- Complete [declaration review](../../docs/development/release-preparation.md) and create the qualified release through the [shared workflow](../../client/README.md#build-and-verify). Do not publish from an arbitrary build directory or an Actions artifact.
- Publication selects the numeric GitHub Release ID in exactly `getsituate/situate`, not `latest`, a moving branch or a tag reservation. GitHub access for the publisher is read-only. It needs no Apple or updater signing private key.
- Keep a reviewed private release configuration with mode `0600`; see [configuration](../../client/README.md#release-workflow-configuration). Legacy `recoveryEvidence` metadata remains readable but is not required or validated. Configure and independently verify the SSH host key in `known_hosts`; acceptance is never automatic. Set `SITUATE_RELEASE_SSH_PRIVATE_KEY` and `SITUATE_RELEASE_SSH_KNOWN_HOSTS` to the key and verified host-key contents, using the same names in local `.env` and hosted environments. The shared release runner materializes private temporary files for the operation and removes them afterward. Existing `WEBSITE_SSH_IDENTITY`, `WEBSITE_SSH_KNOWN_HOSTS`, `sshIdentity` and `sshKnownHosts` file paths remain supported; do not combine them with inline credentials. Neither inline credential is available to qualification.
- Provision `/opt/situate` for the release operator with mode `0755` so the web-server user can traverse it. The host needs Python 3, POSIX locking and space for incoming and immutable copies. Restrict write access to release operators; website deployment must not write here.

New public versions use `YYYY.M.N` CalVer. Historical numeric versions, routes, signatures and finalized catalogs remain readable. The publisher requires the exact source, version, reserved tag, generated inputs, package hashes and final-artifact qualification recorded by the completed GitHub Release. It verifies universal architecture, production HTTPS configuration, updater signatures, signed bundle identity, DMG/archive equality, notarization tickets and Gatekeeper assessment on macOS. The publication checkout need not match the artifact source; publication never checks out, resets or rebuilds that source.

## Plan and run publication

Run from the repository root with the exact destination, release ID and a new operation ID. Planning reads release identity and assets from GitHub; it is not an offline operation. Execution requires the returned plan's exact `authorizationDigest`:

```sh
node tools/pipeline.mjs plan publish --repository getsituate/situate --release-id RELEASE_ID --operation publish-RELEASE_ID --destination SSH_HOST --configuration /PATH/TO/private-release-config.json --output /PATH/TO/publish-plan.json
node tools/pipeline.mjs run publish --plan /PATH/TO/publish-plan.json --confirm PLAN_AUTHORIZATION_DIGEST
```

Local and CI execution use the same gates. The publisher obtains `release-inputs.json`, `situate-release-history.json`, `manifest.json`, `release-qualification.json` and the declared package assets from that release. `github-release.json` supplies external evidence; `github-release-receipt.json` is a local download receipt binding the exact repository, release and asset IDs and hashes. Keep the local receipt and private journals out of public assets. Cached assets are valid only after the same exact-release checks; a local directory alone is not publication authority.

`manifest.json` points to the sealed release inputs and qualification evidence. File SHA-256 values identify exact bytes, including generated catalog bytes; the signed app also retains its existing canonical catalog digest. Publication copies those assets without regenerating notes or modifying the app.

## When a hosted release fails

Use a new `Release macOS` run for the current protected `main`. A reserved tag, a partial draft, or an unfinished notarization does not prevent a new attempt. Tags are immutable: a new attempt chooses new version and build numbers rather than rebuilding under a reserved tag.

If the GitHub Release already completed, dispatch `Publish macOS` with its numeric release ID instead of building again. If a publish run loses its acknowledgement, check both public manifests. Repeating publication for the same release is safe: the publisher verifies existing bytes and never moves the feed to an older version.

Only one production delivery run may own private qualification or publication at a time. Do not run the legacy local write commands against production while GitHub Actions owns delivery. Older checkpoints and journals are not consumed by hosted runs. An old claim can still matter to the separate hosting cutover runbook; do not remove records merely to retry app delivery.

## Migration history

Direct macOS builds automatically read publication history over verified SSH using the same destination settings as publication. Each immutable `releases/<version>/manifest.json` supplies its exact source commit; the current download pointer is not the history authority. The local checker reads the [published migration checkpoint](../../docs/development/release-preparation.md#published-migration-checkpoint) from the publication tool checkout's committed `HEAD`, resolved once independently of the artifact revision. The checkpoint pins an exact version, source revision and stored-manifest digest. Under the shared host lock, the history response projects qualification fields from the same immutable manifest bytes used to compute that digest. Every attested predecessor must remain present with its exact three-field tuple; only those predecessors can omit local Git objects. The checkpoint's migration count must match its source inventory. The checkpoint and all uncovered releases require local Git objects and ancestry against the candidate. Published migration files must remain byte-identical, including comments and formatting, and registry/module entries must preserve their published prefixes. New migrations may be appended. The build manifest and signed build configuration retain the comparison records.

Publication reads history again and checks the artifact's reviewed source commit, not the publication checkout's `HEAD`. Under the host-wide publication lock, the server requires that the version, source commit and manifest digest of every stored release still match the checked history before it receives or activates a release. A publication added after the local check rejects the stale request; inspect the retained journal and explicitly reconcile after reviewing the new history. Identical artifacts already stored by an interrupted publication are excluded only from that operation's prior baseline.

No migration hash needs manual configuration for direct macOS distribution. Server access, the pinned checkpoint's hash-bound qualification proof and the required local Git commits are needed; neither a failed read nor malformed or missing stored manifests becomes an empty history. Missing checkpoint proof or altered or omitted attested predecessor tuples fail qualification. The complete server inventory remains the race/reconciliation baseline, including covered predecessors. A provisioned root with no releases bootstraps the first publication only when no checkpoint is committed. The history read does not activate releases or change pending operations; it uses the host lock. Compatibility qualification also includes verified completed public GitHub Releases, including versions never promoted to this host. A failed GitHub history read is not an empty compatibility baseline.

## Local checks and staging

`node infrastructure/releases/publish.mjs destination` returns JSON containing only the effective SSH host. It reads `WEBSITE_DEPLOY_HOST` from the environment or private root `.env` using the same precedence and file-privacy rules as publication; CI uses the environment only. It needs no release directory, makes no network requests, writes no files and does not load signing credentials. The development console uses it to display the destination before explicit publication approval.

These lower-level checks diagnose an already downloaded release; they do not establish GitHub Release provenance or authorize publication. The shared workflow performs the exact-release download first. Run from the repository root, using the reviewed full source SHA and downloaded release directory. Keep stages outside the release directory.

```sh
node infrastructure/releases/publish.mjs check --release /PATH/TO/DOWNLOADED_RELEASE --reviewed-revision FULL_SHA
node infrastructure/releases/publish.mjs stage --release /PATH/TO/DOWNLOADED_RELEASE --reviewed-revision FULL_SHA --stage /PATH/TO/NEW_STAGE
```

`check` makes no network requests or remote writes. `stage` creates local copies and coherent metadata only. Both require real Apple verification; neither makes incomplete or external builds publishable.

## Publisher transaction reference

The shared `run publish` workflow invokes the publisher only after exact-release verification. For controlled diagnosis or recovery, the lower-level publisher also requires the downloaded local release receipt for generated releases. A local directory or `check` result cannot replace that receipt. The legacy `--recovery-evidence` argument remains accepted but is not read or validated. The publisher's `--confirm` value is the SSH destination followed by `:` and the exact version; the shared workflow separately requires its plan digest.

```sh
node infrastructure/releases/publish.mjs publish --release /PATH/TO/DOWNLOADED_RELEASE --reviewed-revision FULL_SHA --release-receipt /PATH/TO/DOWNLOADED_RELEASE/github-release-receipt.json --stage /PATH/TO/NEW_STAGE --confirm SSH_HOST:VERSION
```

The transport archive is saved beside the stage as `publication-RUN.tar`. A private `publication-journal.json` in the downloaded release directory records the SSH target, immutable file hashes, operation token and outcome before SSH starts. SSH has verified host keys and one connection attempt; no uncertain request is automatically retried.

The hosted publisher uses a host-wide `flock`, verifies uploaded bytes in a private staging directory, and atomically activates the verified version after installing its immutable files. Staging leftovers can be replaced under the same lock. It verifies the public manifests and package hashes without requiring a second remote write.

The legacy local publisher uses the same lock. Its remote transaction records `/opt/situate/release-pending.json`, receives only the declared regular files into an operation-specific incoming directory, verifies every size/hash, and renames the complete directory to `/opt/situate/releases/<version>`. It refuses to replace differing bytes under an existing version and rejects versions older than any stored release, including SemVer-equivalent version aliases with different build metadata. Public release/metadata directories are set to `0755` and public files to `0644`, even with operator umask `077`; incoming directories remain private until verified, and journals/locks use `0600`. Only after verification does it atomically replace `/opt/situate/current-release` with a relative symlink to `releases/<version>/metadata`.

Each immutable release contains the DMG, updater archive, signature, sealed generated inputs/catalog, qualification evidence, complete build manifest and `metadata/{update.json,download.json,descriptor.json}`. Both public metadata documents come from one descriptor and one pointer:

- `/releases/<version>/<artifact>`: immutable artifact URL.
- `/releases/current/update.json`: static Tauri feed, `distribution: "direct"`, both `darwin-aarch64` and `darwin-x86_64` referencing the same universal archive and version-bound signature.
- `/releases/current/download.json`: `{version,url,sha256,size,minimumSystemVersion,architecture,distribution}`, with `architecture: "universal"` and `distribution: "direct"`.

All URLs are restricted to `https://getsituate.com/releases/`. Metadata must be revalidated and versioned payloads cached immutably. Host routing, TLS, GET/HEAD/Range behavior and log-retention policy belong to the production service configuration, not this publisher.

The app's history was sealed before signing from approved declarations and retained finalized catalogs. Publication neither edits that history nor requires a separate note-writing step.

## Windows direct releases

Dispatch **Build Windows release candidates** on protected `main` with a reserved stable version. The `windows-release` environment supplies the Tauri signing key and password as secrets and `SITUATE_UPDATER_PUBLIC_KEY` as a variable. The build creates separate x64 and ARM64 NSIS installers and Tauri signatures. It neither signs them with Authenticode nor publishes them. Set `SITUATE_UPDATER_PUBLIC_KEY` to the same key when assembling, publishing, and activating the feed.

```sh
node client/scripts/windows-release.mjs CANDIDATE VERSION SOURCE_SHA X64_ARTIFACT ARM64_ARTIFACT
```

Before publishing, qualify the installer for each architecture on Windows: install as a standard user, exercise the update through the application with a workspace and stored draft, confirm restart and data preservation, and uninstall. Record only successful checks in the qualification JSON. Its `kind` is `windows-exact-artifact-qualification`, `manifestSha256` is the hash of the assembled `manifest.json`, and `architectures` lists x64 then ARM64, with each manifest `target` and installer `sha256` plus `install`, `update`, and `uninstall` set to `passed`. Keep the qualification evidence with the candidate; do not substitute a result from another build or an emulated x64 run for an ARM64 run.

The annotated `windows-vVERSION` tag must point to the qualified source commit. The Windows publisher uses that existing tag, stages the verified assets in a draft, verifies GitHub's copies, and makes it a stable release without changing the repository's latest-release selection. It does not replace published assets. Set `SITUATE_UPDATER_PUBLIC_KEY` in the publication environment; the private key is not needed.

```sh
node infrastructure/releases/publish-windows.mjs CANDIDATE QUALIFICATION_JSON
```

After the release is public, run the feed activator on the distribution host with its exact release ID and a verified copy of the assembled candidate. It compares the GitHub assets with the candidate before atomically replacing `windows-release/update.json`. It refuses older versions and differing bytes under the current version.

```sh
node infrastructure/releases/windows-feed.mjs CANDIDATE GITHUB_RELEASE_ID DISTRIBUTION_DIRECTORY
```

The Windows endpoint is `/releases/windows/current/update.json`. It is separate from the macOS update feed and website download metadata. The Windows release does not expose a website download link.

## Interrupted legacy local publication

For operations started with the legacy local publisher, do not repeat `publish`, remove pending markers or assume a disconnected SSH client cancelled the host operation. Preserve the local journal, stage, transport archive and remote incoming directory.

```sh
node tools/pipeline.mjs status --operation OPERATION_ID
node tools/pipeline.mjs inspect --operation OPERATION_ID
node tools/pipeline.mjs reconcile --operation OPERATION_ID --confirm RECONCILIATION_DIGEST
```

Workflow inspection binds its `reconciliationDigest` to the observed operation state. The underlying publisher reads the pending operation, active pointer and whether the immutable directory exactly matches its journal; it records that observation locally. Confirm no original SSH process or host operation remains active. Investigate mismatches before proceeding. An in-progress inspection is not a cancellation request.

For the same reviewed version and byte-identical stage only, inspect and remove the local transport archive after confirming it is no longer in use, then explicitly reconcile:

```sh
node infrastructure/releases/publish.mjs inspect --release /PATH/TO/DOWNLOADED_RELEASE
node infrastructure/releases/publish.mjs reconcile --release /PATH/TO/DOWNLOADED_RELEASE --reviewed-revision FULL_SHA --release-receipt /PATH/TO/DOWNLOADED_RELEASE/github-release-receipt.json --stage /PATH/TO/EXISTING_STAGE --confirm SSH_HOST:VERSION
```

Reconciliation reacquires the host lock, accepts only the exact pending request, recreates that operation's partial incoming directory, verifies all uploaded bytes and either completes the immutable rename or verifies an already completed version. It may finish pointer activation for the identical release. Older pending requests without migration comparison records can be upgraded during explicit reconciliation only when all original identity and file fields still agree; the new history is checked before continuing. It never overwrites an immutable file or activates an older release. A complete local journal remains as evidence and prevents accidental repeat publication. Preserve it with release records.

Correct faulty app releases with a higher-version fix. Pausing availability does not revoke previously downloaded signed packages and must not advertise an older release. Website rollback must not change the app-release pointer. There is no app rollback command.

## Signing-key recovery

Keep the private signing key and any secure backup outside release artifacts. Backup, restore and signing-key/account-access recovery exercises are deferred operational work, not prerequisites for release creation or publication. Any future rehearsal should use an isolated signing environment without publishing or replacing the production key; these exercises remain unqualified. Loss without recovery can strand installed clients; manual installation of a new trusted build may be required. On suspected compromise, stop publication, protect the signing environment and assess affected artifacts. Removing a feed does not revoke downloaded signatures. Do not promise transparent key replacement: changing the embedded public key requires a separately reviewed trust-transition or manual reinstall procedure. Keep key values, backups and incident records outside public artifacts.

## Tests

```sh
node tools/run-coordinated.mjs -- node --test tools/release-inputs.test.mjs tools/release-qualification.test.mjs client/scripts/updater-signing.test.mjs client/scripts/direct-release-verification.test.mjs infrastructure/releases/publish.test.mjs
```

Publisher transaction tests use disposable directories and synthetic transport archives; they never access SSH or `/opt/situate`. They do not qualify real signatures from Apple, native app replacement, HTTPS hosting or production reconciliation.
