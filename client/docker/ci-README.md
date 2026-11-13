# Linux CI tool image

Build from the repository root without registry credentials:

```sh
docker buildx build --platform linux/arm64 --target ci \
  -f client/docker/Dockerfile -t situate-ci-local:arm64 --load .
```

Use `linux/amd64` and a distinct tag for GitHub runners. The `linux` and `windows` release
targets do not inherit the CI stage.

The image contains Volta with pinned Node/npm, Rust/native build dependencies, JDK 21, Python, Bash, Git,
quality tools, and Playwright installers and system dependencies. It contains neither
browser archives, project `node_modules`, application sources, credentials, a Windows SDK,
nor Docker tooling.

## Runtime contract

Mount a checkout at `/workspace` and a writable cache at `/ci-cache`. Run with the desired
numeric UID/GID. Set `CARGO_HOME=/ci-cache/cargo`, `npm_config_cache=/ci-cache/npm`, and
`HOME` to a writable temporary directory. Set `RUSTUP_TOOLCHAIN` to the repository's
pinned Rust version to prevent directory override discovery from initiating toolchain
updates. `RUSTUP_HOME` remains `/usr/local/rustup` and installed tools are world-readable.
`PLAYWRIGHT_BROWSERS_PATH=/ci-cache/browsers` is already set. Create writable home/cache
directories before tools need them. Do not mount a host home or Docker socket. The default
user is `builder`; there is no entrypoint and any command may replace Bash.

`VOLTA_HOME=/opt/volta` and its shims lead `PATH`. The installed toolchain is root-owned and readable by arbitrary UIDs; it needs no writable Volta home for the preinstalled versions. The mounted checkout inherits the root `package.json` pins. Changing Node, npm, or Volta requires rebuilding the image rather than installing tools at runtime. npm's download cache remains writable under `/ci-cache/npm`.

D-Bus requires the numeric UID to resolve through NSS. Before launching tools, source
`/opt/ci-tools/ci-user.sh` from Bash. For absent UIDs, it creates private passwd/group
files in writable `HOME` from the image's account databases, preserves existing records,
and exports `NSS_WRAPPER_PASSWD`, `NSS_WRAPPER_GROUP`, and
`LD_PRELOAD=/opt/ci-tools/libnss_wrapper.so`. Existing image UIDs are unchanged. It never
reads host account databases or wraps the launched process. The verification script
sources this helper, checks UID/GID lookup, and runs `dbus-run-session -- true` without
root or extra capabilities.

Download browsers directly from upstream into the external cache at runtime:

```sh
node /opt/ci-tools/playwright-1.63.0/cli.js install chromium webkit
```

Use each version recorded in `ci-browsers.json` if the projects differ. The repository's
design suites select the `chromium` channel and require the full Chromium download.
`--only-shell` is sufficient only for standalone headless smoke checks, not the repository
shards. Browser downloads remain in the external runtime cache, never in image layers.

Run the source-free image smoke check without a workspace mount:

```sh
docker run --rm --platform linux/arm64 --user 12345:12345 \
  --tmpfs /ci-cache:mode=1777 \
  -e CARGO_HOME=/ci-cache/cargo -e npm_config_cache=/ci-cache/npm \
  -e HOME=/tmp/situate-ci-home -e RUSTUP_TOOLCHAIN=1.98.1 \
  -v "$PWD/client/docker/ci-verify.mjs:/ci-verify.mjs:ro" \
  situate-ci-local:arm64 node /ci-verify.mjs
```

This checks tool versions, system dependencies, absence of application sources, exact
Debian source-package coverage, bundled source hashes, tool dependency archives and
retained notice hashes as an arbitrary UID. The verifier pins the notice manifest,
collector and Situate MIT license independently of the image's retained inventory.
For an actual browser launch check, mount a populated external browser cache and append
`--browsers`. Without that flag, browser launches are explicitly not checked. Repository
checks need a mounted checkout and installed project dependencies. Docker context
validation runs on the host, not inside this image.

## Inputs and distribution

Image content depends on:

- `client/docker/Dockerfile`, `client/docker/Dockerfile.dockerignore`, and the root `LICENSE`
- The root `package.json` `volta` settings, `client/.node-version`, and `client/rust-toolchain.toml`
- `tools/toolchain.quality.json`
- `client/docker/ci-install.mjs`, `ci-volta-install.mjs`, `ci-sources.mjs`, and `ci-user.sh`
- `client/docker/ci-assets.json`, `ci-volta.json`, `ci-npm.json`, `ci-browsers.json`, and `ci-sources.json`
- `client/docker/ci-NOTICES.md`, `ci-tool-notices.json`, `ci-tool-notices.py`, and `ci-tool-notices-update.py`

The installer reads an isolated read-only input stage; project lockfiles and scripts are
not copied into the final image. The browser manifest records each project's Playwright
version, registry URL, and package integrity. Contract tests compare these fields with
both project lockfiles, so unrelated dependency changes do not require a new image.
`ci-verify.mjs` is a verification input, not installed image content. Tool downloads use
SHA-256 or npm SHA-512 integrity checks. Compressed Debian and Temurin corresponding
sources, build metadata and hashes are retained under `/opt/ci-tools/sources`, without
unpacking. A scoped BuildKit cache reuses Debian source downloads across architectures;
only archives resolved for the current image's exact installed versions are copied into
the final image. Missing source versions fail the build.

Tool dependency archives, Maven metadata and readable notice texts are retained under
`/opt/ci-tools/tool-notices`. The collector binds them to exact installed binary hashes
and checks locked dependency coverage. Existing distribution notices remain in place;
their paths and hashes are recorded in `tool-notices/retained-notices.json`. Situate's
helper-script license is retained as `/opt/ci-tools/LICENSE-Situate.txt`.

cargo-llvm-cov is built from its checksum-pinned published crate using `cargo install
--path . --locked`, not downloaded as a prebuilt binary. Construction uses a temporary
Cargo home and the existing pinned Rust toolchain. Cargo downloads dependencies using
the published lockfile; that same lockfile determines the retained notice archive set.
The crate and lock hashes are checked before and after compilation. The resulting
binary hash, command, compiler identity, architecture and input hashes are retained in
`/opt/ci-tools/cargo-llvm-cov/source-build.json` and checked without rebuilding during
source-free verification. Temporary build sources, registry downloads and build outputs
are removed; only the installed binary, receipt and retained source/notice material remain.

To regenerate the tool notice manifest, review release commits and supplemental source
repositories in `ci-tool-notices-update.py`, then run from the repository root with
Python 3.11 or newer, Volta, installed root development dependencies and an external
download cache:

```sh
node tools/run-coordinated.mjs -- python3 -B client/docker/ci-tool-notices-update.py \
  --cache /tmp/situate-ci-notice-downloads
```

The updater reads the quality tool pins and binary/source archive pins, walks upstream
Cargo/Go/Maven manifests, hashes archive notices, and updates the source-free verifier's
manifest, collector and Situate license pins. The collector itself makes no network
requests during verification. Review generated URL/hash changes and supplemental notice
sources; generation is not an upstream build attestation. cargo-llvm-cov's build receipt
is created during image construction, not precomputed by the updater. See
[tool dependency notices](ci-NOTICES.md#tool-dependency-notices).

After changing image inputs, build and verify a new Linux/amd64 image before updating `tools/ci-image.lock.json` with its published digest and the input hash from `node tools/ci-image.mjs --inputs`. The existing lock intentionally rejects changed inputs; never replace only its input hash while retaining an older image digest. The image workflow separates building, verification, and publication. Its `image.tar` artifact is gzip-compressed; Docker and tar detect compression independently of the filename. Publication limits transport archives to 8 GiB and their expanded tar streams to 12 GiB, including retained corresponding sources and notices. The workflow exports one platform with `--provenance=false` and seals its own same-run build receipt rather than a BuildKit attestation index. The receipt binds both the image ID and configuration digest, including when Docker's containerd store reports distinct values.

The build and publisher exchange sealed image data through `/opt/situate/ci-image-transfers` on an existing controlled host. Provision that directory separately with an isolated upload account, a separate read account and a shared read group; use group inheritance so uploaded `0750` directories and `0640` files remain readable by the reader. Neither account should own app publication storage. SSH host keys must be independently pinned. The scripts neither provision storage nor acquire host keys, and never execute transferred image bytes.

CI supplies upload/read destinations through `CI_IMAGE_TRANSFER_UPLOAD_HOST` and `CI_IMAGE_TRANSFER_READ_HOST`, separate `CI_IMAGE_TRANSFER_UPLOAD_SSH_PRIVATE_KEY` and `CI_IMAGE_TRANSFER_READ_SSH_PRIVATE_KEY` secrets, and pinned host data in `CI_IMAGE_TRANSFER_KNOWN_HOSTS`. Credentials appear only in their transfer step and are removed afterward; the registry token appears only in the final publisher step. Local `tools/ci-image-transport.mjs upload|download DIR` accepts explicit `--provenance FILE --repository-id ID --run-id ID --attempt N --workflow-sha SHA --source SHA --host USER@HOST --identity FILE --known-hosts FILE`, without Actions event variables. The immutable transfer identity binds that exact provenance and image hash; a missing or modified transfer cannot substitute another run.

The distribution target is `ghcr.io/getsituate/situate-ci-linux`, intentionally public so contributors and permitted fork workflows can pull without a GitHub account or registry credentials. Normal publication requires public visibility and linkage to exactly `getsituate/situate`, including its numeric repository ID. Review [third-party notices and source obligations](ci-NOTICES.md) before authorizing distribution.

For an absent package, an authorized maintainer can manually dispatch the trusted `main` workflow with `bootstrap: true`. This uses the same restricted verification and provenance checks, creates a linked private package, and does not emit a pinnable result. Explicitly review and make that package public, then run normal publication and verify anonymous access to its exact digest. See [image updates and bootstrap](../../docs/development/testing.md#updating-the-image) for permissions, empty-repository setup and failure recovery. Never reuse an old digest with a new input hash or pin a local Docker image ID.

No registry login, publishing, visibility change or SDK-license acceptance is part of the local build.
