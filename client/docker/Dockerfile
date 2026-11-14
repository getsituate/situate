FROM scratch AS context-audit
COPY . /

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node
FROM rust:1.98.1-slim-bookworm@sha256:ff521445a372125ed4f76e1453a1f8098f2d05332d1601d30db1c1f62757e730 AS toolchain

COPY --from=node /usr/local/ /opt/node/
ENV VOLTA_HOME=/opt/volta \
    PATH=/opt/volta/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# A dated package archive prevents apt updates from silently changing the build base.
RUN rm /etc/apt/sources.list.d/debian.sources \
    && printf '%s\n' \
      'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260919T000000Z bookworm main' \
      'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20260919T000000Z bookworm-security main' \
      > /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential pkg-config libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
      librsvg2-dev libxdo-dev libssl-dev patchelf xdg-utils file curl ca-certificates squashfs-tools libfuse2 \
      xvfb xauth dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/client
COPY client/rust-toolchain.toml client/.node-version ./
COPY package.json /workspace/package.json
COPY client/docker/ci-volta-install.mjs client/docker/ci-volta.json client/docker/ci-npm.json /tmp/volta-input/
RUN /opt/node/bin/node /tmp/volta-input/ci-volta-install.mjs && rm -rf /tmp/volta-input
RUN rustup show active-toolchain && rustup component add clippy rustfmt llvm-tools \
    && test "$(node --version)" = "v$(cat .node-version)"
RUN useradd --create-home --uid 1000 builder \
    && mkdir -p /workspace/client/target /usr/local/cargo/registry /usr/local/cargo/git \
    && chown -R builder:builder /workspace /usr/local/cargo
ENV APPIMAGE_EXTRACT_AND_RUN=1
USER builder

FROM eclipse-temurin:21-jdk-jammy@sha256:e0c60c487345d1dc9d0fc7b6f0496f3cc941e5132e09296cc17a6decc71b902b AS ci-java

FROM swift:6.2.4-bookworm@sha256:87947bfd51a61c86f487986ccf6390fc9cd4035cf98d74f7b8c9a7cb92d9282a AS ci-swift
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*
COPY client/docker/ci-swift-tools.py client/docker/ci-swift-tools.json client/docker/ci-swift-format.resolved.json client/docker/ci-swiftlint.resolved.json /swift-input/
COPY tools/toolchain.quality.json /swift-input/
RUN --mount=type=cache,id=situate-ci-swift-sources,target=/var/cache/ci-swift-sources,sharing=locked \
    python3 /swift-input/ci-swift-tools.py build

FROM scratch AS ci-inputs
COPY LICENSE /LICENSE
COPY client/docker/ci-install.mjs client/docker/ci-assets.json client/docker/ci-npm.json client/docker/ci-browsers.json client/docker/ci-NOTICES.md /client/docker/
COPY client/docker/ci-sources.mjs client/docker/ci-sources.json client/docker/ci-user.sh /client/docker/
COPY client/docker/ci-tool-notices.py client/docker/ci-tool-notices-update.py client/docker/ci-tool-notices.json /client/docker/
COPY client/docker/ci-swift-tools.py client/docker/ci-swift-tools.json client/docker/ci-swift-format.resolved.json client/docker/ci-swiftlint.resolved.json /client/docker/
COPY tools/toolchain.quality.json /tools/

FROM toolchain AS ci
USER root
COPY --from=ci-java /opt/java/openjdk /opt/java/openjdk
COPY --from=ci-swift /export/opt/ci-tools/ /opt/ci-tools/
RUN printf '%s\n' \
      /opt/ci-tools/swift-runtime/usr/lib/swift/linux \
      /opt/ci-tools/swift-runtime/usr/lib/swift/host/compiler \
      /opt/ci-tools/swift-runtime/usr/lib \
      > /etc/ld.so.conf.d/situate-ci-swift.conf \
    && ldconfig \
    && ln -s /opt/ci-tools/swift-runtime/usr/lib/libsourcekitdInProc.so /usr/lib/libsourcekitdInProc.so \
    && ln -s /opt/ci-tools/swiftlint/swiftlint /usr/local/bin/swiftlint \
    && ln -s /opt/ci-tools/swift-format/swift-format /usr/local/bin/swift-format
ENV JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/volta/bin:/opt/java/openjdk/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PLAYWRIGHT_BROWSERS_PATH=/ci-cache/browsers
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 bash git libnss-wrapper \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=bind,from=ci-inputs,target=/ci-input,readonly \
    node /ci-input/client/docker/ci-install.mjs \
    && ln -s "/usr/lib/$(gcc -dumpmachine)/libnss_wrapper.so" /opt/ci-tools/libnss_wrapper.so \
    && test -r /opt/ci-tools/libnss_wrapper.so \
    && cp /ci-input/client/docker/ci-user.sh /opt/ci-tools/ci-user.sh \
    && cp /ci-input/client/docker/ci-swift-tools.py /opt/ci-tools/ci-swift-tools.py \
    && cp /ci-input/client/docker/ci-NOTICES.md /opt/ci-tools/NOTICES.md \
    && cp /ci-input/LICENSE /opt/ci-tools/LICENSE-Situate.txt \
    && chmod -R a+rX /usr/local/rustup /usr/local/cargo /opt/ci-tools /opt/java/openjdk \
    && rm -rf /var/lib/apt/lists/* /root/.cache /root/.npm /workspace/client /workspace/package.json
WORKDIR /workspace
RUN --mount=type=bind,from=ci-inputs,target=/ci-input,readonly \
    --mount=type=cache,id=situate-ci-debian-sources,target=/var/cache/situate-ci-sources,sharing=locked \
    --mount=type=cache,id=situate-ci-tool-notices,target=/var/cache/situate-ci-tool-notices,sharing=locked \
    node /ci-input/client/docker/ci-sources.mjs \
    && cp /ci-input/client/docker/ci-tool-notices.py /opt/ci-tools/ci-tool-notices.py \
    && python3 -B /opt/ci-tools/ci-tool-notices.py collect --manifest /ci-input/client/docker/ci-tool-notices.json \
    && chmod -R a+rX /opt/ci-tools/sources /opt/ci-tools/tool-notices \
    && rm -rf /var/lib/apt/lists/*
USER builder
CMD ["bash"]

FROM toolchain AS dependencies
COPY --chown=builder:builder client/package.json client/package-lock.json ./
COPY --chown=builder:builder client/app/package.json ./app/
COPY --chown=builder:builder client/workshop/package.json ./workshop/
COPY --chown=builder:builder client/packages/ui/package.json ./packages/ui/
COPY --chown=builder:builder client/packages/localization/package.json ./packages/localization/
RUN npm ci

FROM dependencies AS windows-toolchain
USER root
ENV PATH=/opt/volta/bin:/opt/nsis/bin:/usr/lib/llvm-14/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang-14 lld-14 llvm-14 cmake ninja-build scons unzip zlib1g-dev \
    && rm -rf /var/lib/apt/lists/* \
    && cargo install --locked cargo-xwin --version '=0.23.1' \
    && rustup target add x86_64-pc-windows-msvc \
    && chown -R builder:builder /usr/local/cargo
# Debian does not install the clang-cl driver alias; clang selects CL mode from argv[0].
RUN ln -s /usr/lib/llvm-14/bin/clang /usr/local/bin/clang-cl \
    && for tool in clang-cl lld-link llvm-lib llvm-rc; do \
      command -v "$tool" || { echo "Missing build tool: $tool" >&2; exit 1; }; \
    done
# Tauri's installer needs newer NSIS headers than Debian 12 provides. Build the native
# compiler and use the matching official Windows stubs/plugins, retaining their notices.
RUN curl --fail --location --retry 3 -o /tmp/nsis.zip \
      'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11.zip' \
    && curl --fail --location --retry 3 -o /tmp/nsis-src.tar.bz2 \
      'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11-src.tar.bz2' \
    && printf '%s\n' \
      'c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1  /tmp/nsis.zip' \
      '19e72062676ebdc67c11dc032ba80b979cdbffd3886c60b04bb442cdd401ff4b  /tmp/nsis-src.tar.bz2' \
      | sha256sum --check --strict \
    && unzip -q /tmp/nsis.zip -d /tmp/nsis-data \
    && tar -xjf /tmp/nsis-src.tar.bz2 -C /tmp \
    && mkdir -p /opt/nsis/share \
    && mv /tmp/nsis-data/nsis-3.11 /opt/nsis/share/nsis \
    && scons -C /tmp/nsis-3.11-src -j "$(nproc)" \
      SKIPSTUBS=all SKIPPLUGINS=all SKIPUTILS=all SKIPMISC=all \
      VERSION=3.11 PREFIX=/opt/nsis NSIS_CONFIG_CONST_DATA_PATH=yes install-compiler \
    && test "$(makensis -VERSION)" = 'v3.11' \
    && test -f /opt/nsis/share/nsis/Include/Win/RestartManager.nsh \
    && rm -rf /tmp/nsis.zip /tmp/nsis-src.tar.bz2 /tmp/nsis-data /tmp/nsis-3.11-src
ENV XWIN_VERSION=17 \
    XWIN_SDK_VERSION=10.0.26100 \
    XWIN_CRT_VERSION=14.44.17.14 \
    XWIN_ARCH=x86_64 \
    XWIN_CACHE_DIR=/workspace/client/target/xwin-0.23.1-vs17-sdk-10.0.26100-crt-14.44.17.14
USER builder

FROM windows-toolchain AS windows
COPY --chown=builder:builder client/ ./
COPY --chown=builder:builder design/brand/ /workspace/design/brand/
# Direct runs also require an explicit licence acknowledgement at the release entry point.
CMD ["npm", "run", "release", "--", "--platform", "windows", "--windows-cross"]

FROM dependencies AS linux
COPY --chown=builder:builder client/ ./
COPY --chown=builder:builder design/brand/ /workspace/design/brand/
CMD ["npm", "run", "release", "--", "--platform", "linux"]
