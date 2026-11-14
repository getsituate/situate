# Container tooling

Containers host shared CI tools, advisory monitoring and locked visual checks. They do not package supported Linux or Windows applications. macOS release packaging, signing and native qualification require macOS and Xcode; see the [release guide](../README.md#build-and-verify).

## CI tool image

Use [Volta](../../docs/development/README.md#install-volta) for repository Node/npm commands and a Docker Linux engine with Buildx. The [CI image guide](ci-README.md) documents installed tools, arbitrary-UID execution, writable caches, browser downloads and source-free verification.

For a local tool-image build, run from the repository root:

```sh
docker buildx build --platform linux/amd64 --target ci \
  -f client/docker/Dockerfile -t situate-ci-local:amd64 --load .
```

Use `linux/arm64` and a distinct local tag for native ARM64 tooling. The locked visual suite uses Linux/amd64 regardless of the host architecture; do not change that image or generate host-native references to bypass a mismatch. These builds do not publish an image, update the consumer lock or establish macOS product qualification.

`tools/ci-image.lock.json` binds the distributed image digest, platform and input fingerprint. Validate it from the root:

```sh
node tools/ci-image.mjs
node tools/ci-image.mjs --inputs
```

The [CI tool image workflow](../../.github/workflows/ci-tool-image.yml) separates image construction from publication. Registry publication, package visibility and repository linkage need explicit authorization and provisioning. Verify anonymous access to the exact public digest before using it for untrusted PRs; do not provide personal registry credentials to fix a private-image failure.

## Source and credential boundaries

The Docker context is the repository root. The [Dockerfile allowlist](Dockerfile.dockerignore) restricts inputs; it excludes host dependencies, Cargo output, artifacts, generated mobile projects, Git/Pi configuration and common credential files. Filename filtering cannot identify every secret: keep credentials and private records outside source inputs.

Run the context contract with synthetic fixtures from the repository root:

```sh
node tools/run-coordinated.mjs -- node client/scripts/test-docker-context.mjs
```

Use unprivileged containers without a Docker socket, host home, production credentials or privileged mode. Give arbitrary numeric users only the writable home/cache directories required by the [runtime contract](ci-README.md#runtime-contract). Do not share writable caches between trusted publication and untrusted PR work. A cache hit is not evidence that tests ran.

## Redistribution obligations

Review [image notices and corresponding-source obligations](ci-NOTICES.md) before distributing an image. Retain license texts, attributions, tool dependency archives, binary/source hashes and corresponding-source material required by their terms. The source-free verifier checks the retained inventories and hashes; passing it does not replace legal review of new dependencies or grant redistribution rights.

Review pinned base images, Debian snapshots, tool versions and download integrity when changing inputs. A controlled tool environment is not a claim of hermetic or byte-for-byte reproducible application builds. Update published digests deliberately through a reviewed consumer-lock change.

Historical Windows cross-build caches may contain Microsoft SDK/CRT components. Preserve their redistribution restrictions; do not publish them with tool images or artifacts. Relevant starting points include [cargo-xwin's terms link](https://go.microsoft.com/fwlink/?LinkId=2086102) and [Visual Studio 2022 Build Tools terms](https://go.microsoft.com/fwlink/?LinkId=2179911). Those links are not a grant of rights or an exhaustive legal review.

## Retained artifacts and interrupted containers

Older local package runs may retain `container.json`, release manifests, exported packages and named cache volumes. Preserve them for investigation; they are not inputs to current release publication. A complete historical build manifest does not qualify a deferred product platform.

Before removing an abandoned container or volume, inspect the recorded container and every container using that volume:

```sh
docker ps -a --filter volume=VOLUME_NAME
```

Confirm that the owning build has stopped. Historical release locks can record a container PID, not a host PID. Remove only the identified abandoned resources after checking ownership; never run a global prune to recover one build. Removing a target volume discards its compiled output and any SDK cache. Exported host artifacts are separate and must not be deleted to clear a lock or uncertain operation.
