# Direct macOS release publication

The publisher serves signed universal macOS direct releases independently of website deployment. It never builds, notarizes, changes DNS, submits to Apple or rolls back an app. It uses no analytics or download counter.

## Prerequisites

- Use Volta shims first on `PATH`, the repository-pinned Node/npm, macOS, Python 3.12 or newer, and the Apple verification tools.
- Complete [release-note preparation](../../docs/development/release-preparation.md) and commit the finalized localized files before building. The installed version and prior published history are bundled; no newer-version notes are served through the update feed.
- Build with `cd client && npm run release:apple -- --distribution direct` from a clean reviewed revision. Configure the intended `APPLE_TEAM_ID` in the environment or private root `.env` (or retain the optional legacy `client/.apple-release.local.json`), and keep the tracked application identifier unchanged. Complete the required release and native two-version qualification for those exact bytes.
- Set `SITUATE_UPDATER_PUBLIC_KEY`, `WEBSITE_DEPLOY_HOST` and optional absolute `WEBSITE_SSH_IDENTITY` in the environment or private root `.env` (`0600`). Explicit environment values win, including empty values. CI never reads `.env`. The publisher reads no private updater or Apple signing keys. Configure and independently verify the SSH host key in `known_hosts`; host-key acceptance is never automatic.
- Provision `/opt/situate` for the release operator with mode `0755` so the read-only web-server user can traverse it. The host needs Python 3, POSIX filesystem locking and sufficient disk space for an incoming and immutable copy. Restrict write access to release operators; the web server only needs read access. Website deployment must not write here.

Apple release versions must be strict numeric `major.minor.patch` without leading zeroes, prerelease identifiers or build metadata, matching the public artifact routes. The publisher accepts only a complete manifest for a build made from the exact `--reviewed-revision` without uncommitted source changes, the configured Apple team/application identity, the production HTTPS endpoint, a universal direct app and matching public updater key. The reviewed revision must be a full commit SHA available in the local Git object database. The publication checkout may be on another commit or branch and may contain local or staged edits; publication does not rebuild, check out source, reset files or fetch missing history. It checks hashes, sizes, version-bound signatures and final DMG/archive bundle equality, signed identity, architecture, tickets and Gatekeeper checks on macOS. Synthetic fixtures cannot pass production Apple verification.

## Migration history

Direct macOS builds automatically read publication history over verified SSH using the same destination settings as publication. Each immutable `releases/<version>/manifest.json` supplies its exact source commit; the current download pointer is not the history authority. The local checker compares every stored release against the candidate commit using local Git objects. Published migration files must remain byte-identical, including comments and formatting, and registry/module entries must preserve their published prefixes. New migrations may be appended. The build manifest and signed build configuration retain the comparison records.

Publication reads history again and checks the artifact's reviewed source commit, not the publication checkout's `HEAD`. Under the host-wide publication lock, the server requires that the version, source commit and manifest digest of every stored release still match the checked history before it receives or activates a release. A publication added after the local check rejects the stale request; inspect the retained journal and explicitly reconcile after reviewing the new history. Identical artifacts already stored by an interrupted publication are excluded only from that operation's prior baseline.

No migration hash needs manual configuration for direct macOS distribution. Server access and all referenced local Git commits are required; neither a failed read nor malformed or missing stored manifests becomes an empty history. A provisioned root with no releases bootstraps the first publication automatically. The history read does not activate releases or change pending operations; it uses the host lock. iOS and TestFlight are not recorded by this publisher and retain their separate qualification process.

## Local checks and staging

`node infrastructure/releases/publish.mjs destination` returns JSON containing only the effective SSH host. It reads `WEBSITE_DEPLOY_HOST` from the environment or private root `.env` using the same precedence and file-privacy rules as publication; CI uses the environment only. It needs no release directory, makes no network requests, writes no files and does not load signing credentials. The development console uses it to display the destination before explicit publication approval.

Run from the repository root. Replace placeholders with the reviewed full Git commit SHA and actual build directory. Keep staging under a Git-ignored artifact directory, outside the build directory itself.

```sh
node infrastructure/releases/publish.mjs check --release client/artifacts/apple-RUN --reviewed-revision FULL_SHA
node infrastructure/releases/publish.mjs stage --release client/artifacts/apple-RUN --reviewed-revision FULL_SHA --stage client/artifacts/publication-RUN
```

`check` makes no network requests or remote writes. `stage` creates local copies and coherent metadata only. Both require real Apple verification; neither makes incomplete or external builds publishable.

## Explicit publication

Publication is an external effect requiring separate operator approval. Review the exact artifacts, revision, SSH destination and version first. `publish` accepts an existing verified stage or creates a new one. It requires `--confirm` to equal the configured SSH destination followed by `:` and the exact app version.

```sh
node infrastructure/releases/publish.mjs publish --release client/artifacts/apple-RUN --reviewed-revision FULL_SHA --stage client/artifacts/publication-RUN --confirm SSH_HOST:VERSION
```

The transport archive is saved beside the stage as `publication-RUN.tar`. A private `publication-journal.json` in the build directory records the SSH target, immutable file hashes, operation token and outcome before SSH starts. SSH has verified host keys and one connection attempt; no uncertain request is automatically retried.

Under a host-wide `flock`, the remote transaction records `/opt/situate/release-pending.json`, receives only the declared regular files into an operation-specific incoming directory, verifies every size/hash, and renames the complete directory to `/opt/situate/releases/<version>`. It refuses to replace differing bytes under an existing version and rejects versions older than any stored release, including SemVer-equivalent version aliases with different build metadata. Public release/metadata directories are set to `0755` and public files to `0644`, even with operator umask `077`; incoming directories remain private until verified, and journals/locks use `0600`. Only after verification does it atomically replace `/opt/situate/current-release` with a relative symlink to `releases/<version>/metadata`.

Each immutable release contains the DMG, updater archive, signature, complete build manifest and `metadata/{update.json,download.json,descriptor.json}`. Both public metadata documents come from one descriptor and one pointer:

- `/releases/<version>/<artifact>`: immutable artifact URL.
- `/releases/current/update.json`: static Tauri feed, `distribution: "direct"`, both `darwin-aarch64` and `darwin-x86_64` referencing the same universal archive and version-bound signature.
- `/releases/current/download.json`: `{version,url,sha256,size,minimumSystemVersion,architecture,distribution}`, with `architecture: "universal"` and `distribution: "direct"`.

All URLs are restricted to `https://getsituate.com/releases/`. Metadata must be revalidated and versioned payloads cached immutably. Host routing, TLS, GET/HEAD/Range behavior and log-retention policy belong to the production service configuration, not this publisher.

The app's version history is compiled from finalized, committed changelogs during the build. Publication does not require a separate changelog record.

## Interrupted publication

Do not repeat `publish`, remove pending markers or assume a disconnected SSH client cancelled the host operation. Preserve the local journal, stage, transport archive and remote incoming directory.

```sh
node infrastructure/releases/publish.mjs inspect --release client/artifacts/apple-RUN
```

`inspect` reads the remote pending operation, active pointer and whether the immutable directory exactly matches the journal; it records the observation locally. Confirm no original SSH process or host operation remains active. Investigate mismatches before proceeding. An in-progress inspection is not a cancellation request.

For the same reviewed version and byte-identical stage only, inspect and remove the local transport archive after confirming it is no longer in use, then explicitly reconcile:

```sh
node infrastructure/releases/publish.mjs reconcile --release client/artifacts/apple-RUN --reviewed-revision FULL_SHA --stage client/artifacts/publication-RUN --confirm SSH_HOST:VERSION
```

Reconciliation reacquires the host lock, accepts only the exact pending request, recreates that operation's partial incoming directory, verifies all uploaded bytes and either completes the immutable rename or verifies an already completed version. It may finish pointer activation for the identical release. Older pending requests without migration comparison records can be upgraded during explicit reconciliation only when all original identity and file fields still agree; the new history is checked before continuing. It never overwrites an immutable file or activates an older release. A complete local journal remains as evidence and prevents accidental repeat publication. Preserve it with release records.

Correct faulty app releases with a higher-version fix. Pausing availability does not revoke previously downloaded signed packages and must not advertise an older release. Website rollback must not change the app-release pointer. There is no app rollback command.

## Signing-key recovery

Keep the private signing key and its secure backup outside release artifacts. Verify that an authorized maintainer can recover account access and read an independent secure backup. Rehearse recovery in an isolated signing environment without publishing or replacing the production key; these exercises remain unqualified. Loss without recovery can strand installed clients; manual installation of a new trusted build may be required. On suspected compromise, stop publication, protect the signing environment and assess affected artifacts. Removing a feed does not revoke downloaded signatures. Do not promise transparent key replacement: changing the embedded public key requires a separately reviewed trust-transition or manual reinstall procedure. Keep key values, backups and incident records outside public artifacts.

## Tests

```sh
node --test client/scripts/updater-signing.test.mjs client/scripts/apple-release.test.mjs client/scripts/apple-release.integration.test.mjs client/scripts/apple-credentials.test.mjs infrastructure/releases/publish.test.mjs
```

Publisher transaction tests use disposable directories and synthetic transport archives; they never access SSH or `/opt/situate`. They do not qualify real signatures from Apple, native app replacement, HTTPS hosting or production reconciliation.
