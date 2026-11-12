# Container builds

These Linux build images produce local test packages using the same [release script](../scripts/release.mjs) as native hosts. They are not runtime images and do not publish packages or images.

## Linux

The host needs [Volta](../../docs/development/README.md#install-volta) for the pinned Node.js/npm versions, and Docker with a Linux engine and Buildx. Rust, npm dependencies and native libraries are installed inside the image; host-side `npm ci` is not required for these commands. Run from `client/`:

```sh
npm run release:docker
npm run release:docker -- --arch x64
npm run release:docker -- --arch arm64 --check
```

The default Linux architecture follows the **Docker engine**, which may differ from the machine running the CLI. `--arch x64` selects a `linux/amd64` build environment; `--arch arm64` selects `linux/arm64`. Building the other architecture requires Docker emulation support and can be substantially slower. Docker Desktop normally includes this support. The wrapper does not install emulators or change daemon settings.

Emulation must also support the static-PIE executables used by AppImage helper tools. If a helper fails with `Exec format error` despite successful compilation and native smoke tests, use a Docker engine running natively on the target architecture. An earlier `.deb` output does not make a failed AppImage packaging run a complete release.

Linux outputs are `.deb` and `.AppImage` packages. Debian 12 is the build baseline, not a promise that every Linux distribution can run them. In particular, AppImages do not remove the minimum glibc requirement. Validate packages in the distributions and desktop sessions you intend to support. See [Tauri's Linux compatibility guidance](https://v2.tauri.app/distribute/appimage/).

`--check` runs static checks and unit tests before packaging. For Linux it also runs the real WebView/filesystem smoke test under Xvfb with a session D-Bus. This is a headless container check, not a replacement for installation and GUI testing in a VM.

## Windows cross-builds

The separate `windows` image target adds LLVM/Clang, NSIS 3.11, the Rust MSVC target and `cargo-xwin` 0.23.1. Its toolchain runs natively on Linux ARM64 or x64 and targets **Windows x64**. No Windows container or Wine is involved. Only NSIS `.exe` installers are produced; MSI packaging and native Windows tests are outside this path. Tauri describes cross-builds as less tested than native Windows builds: see [Windows cross-compilation](https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos).

NSIS 3.11 supplies the `Win/RestartManager.nsh` header required by Tauri's installer template. The image builds its native compiler from the official source archive and installs matching Windows stubs/plugins from the official ZIP. Both downloads are SHA-256 verified; the bundled notices remain at `/opt/nsis/share/nsis/COPYING`.

### Microsoft component terms

`cargo-xwin` downloads Microsoft SDK and CRT/build-tools components and treats its use as acceptance of Microsoft's terms. It does not provide an interactive licence prompt. Review the applicable terms before running a Windows cross-build:

- [cargo-xwin's stated licence link](https://go.microsoft.com/fwlink/?LinkId=2086102), linked from its [README](https://github.com/rust-cross/cargo-xwin/tree/v0.23.1).
- [Visual Studio 2022 Build Tools terms](https://go.microsoft.com/fwlink/?LinkId=2179911), referenced by the VS17 package metadata.

These links are starting points, not an exhaustive legal review of all downloaded components or a grant of redistribution rights. If you are authorised to accept the applicable Microsoft SDK and CRT/build-tools terms, acknowledge them explicitly:

```sh
npm run release:docker -- --platform windows --accept-windows-sdk-license
```

Without that flag, the wrapper fails before contacting Docker. The release script also guards direct cross-build invocations. Building the Windows image alone installs the open-source cross-toolchain and Rust target, but does not fetch the Microsoft SDK/CRT. Linux-only builds do not install the Windows tooling.

Windows always targets x64; `--arch arm64` is rejected for this target. `--check` adds Linux-hosted static checks and unit tests, **not** Windows runtime tests. Install and exercise the resulting installer in a Windows VM. WebView2 installation may require internet access when the runtime is absent. Cross-built packages are not distribution-signed.

## Inputs and reproducibility

[The Dockerfile](Dockerfile) pins the Node and Rust base images by multi-architecture digest and uses a dated Debian package snapshot. Volta selects Node and npm from the root `package.json`; Node is also checked against `.node-version`. The verified Node distribution and npm archive populate the pinned Volta installation under `/opt/volta`. The Rust toolchain file and both dependency lockfiles are copied into the image. Update image tags/digests together with toolchain version changes. Refresh the Debian snapshot deliberately to incorporate security fixes, then rebuild and verify the packages.

The Docker context is the repository root because the frontend imports `design/brand/tokens.css`. The [Dockerfile-specific allowlist](Dockerfile.dockerignore) includes client build inputs, the root toolchain manifest, and that stylesheet. It excludes host dependencies, Cargo output, artifacts, generated mobile projects, Git/Pi configuration and common credential files. Keep credentials out of source directories as well; filename filtering cannot identify every secret. Verify the filter with synthetic fixtures using Docker itself:

```sh
npm run test:docker-context
```

The containers run as an unprivileged user, without privileged mode, a mounted Docker socket or host bind mounts. Host signing credentials and build environment variables are not forwarded. Docker's automatic proxy injection is explicitly cleared for builds and runtime containers, including uppercase and lowercase proxy variables. Networks that require proxy settings inside builds need a separately reviewed configuration; the wrapper does not forward authenticated proxy URLs. AppImage helper tools use extract-and-run mode instead of requiring FUSE mounts inside the container.

This is a controlled build environment, not a hermetic or byte-for-byte reproducible release process. Package timestamps and Tauri helper downloads can still vary. Windows selects VS17 SDK `10.0.26100` and CRT `14.44.17.14`; those identify component families in Microsoft's moving manifest, not immutable payload revisions. The selectors and cargo-xwin version are included in the SDK cache path. Do not distribute cached Microsoft components or publish build images without reviewing third-party terms.

A future Linux CI runner can invoke the same `npm run release:docker` command with an explicit architecture. The wrapper loads the image into the local Docker engine; it does not need a registry push or a separate CI packaging implementation.

## Artifacts, caches and interrupted builds

Each run exports to a fresh `client/artifacts/docker-*/` directory:

- `container.json`: status, target architecture, Docker platform, exact image ID, container name, target-volume name, cache prefix and release subdirectory.
- `release-*/manifest.json`: the release script's platform result and relative artifact paths.
- `release-*/linux-*/` or `release-*/windows-x64/`: packages.

Require both manifests to report `status: "complete"`. Build errors retain a failed container report and attempt to recover any release output. Exported packages belong to the user invoking Docker, rather than requiring host-root permissions. Copying artifacts does not overwrite earlier runs.

Source files and npm dependencies live in the image. Rust registry and Git caches use named Docker volumes scoped to the checkout path, build target and container architecture. Compiled-target volumes are additionally scoped to the exact source image ID: restoring an older Docker source layer must not reuse a newer binary just because Cargo sees older file timestamps. Source changes therefore create another target cache. Build attestations are disabled for these local images so repeated cached builds do not get different image IDs solely from attestation timestamps. They never share `client/target/` or host `node_modules/`. Windows SDK/CRT files stay in its target volume and are not copied into the artifact directory. Local image tags and caches are retained for subsequent builds; no automatic pruning occurs. Do not share writable caches between trusted builds and untrusted pull requests.

The wrapper removes its runtime container after completion or handled failure. SIGINT/SIGTERM trigger cleanup; a hard kill or daemon failure can leave a container or release lock behind. The release lock records a **container PID**, not a host PID. Before recovery, inspect the recorded container and all containers using the target volume:

```sh
docker ps -a --filter volume=<targetVolume>
```

Stop and remove only the abandoned build containers after confirming they are not active. To discard that build cache and any stale lock, remove its target volume with `docker volume rm <targetVolume>` once no containers use it. This also discards any Windows SDK cache in that volume. Never use a global Docker prune command to recover one build. Exported artifacts remain on the host.
