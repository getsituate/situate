# Linux CI image: third-party components

This inventory does not replace or change any component's license. Preserve the upstream
notices and complete tool distributions described below.

| Component                                                                                          | Source                                                                                                                                 | Terms and retained notices                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Debian packages, including Bash, Git, Python, GTK/WebKit libraries and browser system dependencies | https://snapshot.debian.org/archive/debian/20260919T000000Z/ and https://snapshot.debian.org/archive/debian-security/20260919T000000Z/ | Individual package terms, including GPL/LGPL, under `/usr/share/doc/*/copyright`; exact binary/source package names and versions in `/opt/ci-tools/debian-packages.tsv`                                                                                      |
| Node.js 24.21.0                                                                                    | https://github.com/nodejs/node/tree/v24.21.0                                                                                           | MIT and bundled dependency notices in `/opt/volta/tools/image/node/24.21.0/LICENSE`                                                                                                                                                                          |
| npm 11.19.1                                                                                        | https://github.com/npm/cli/tree/v11.19.1                                                                                               | Artistic-2.0 and bundled notices in `/opt/volta/tools/image/npm/11.19.1`                                                                                                                                                                                     |
| Volta 2.0.2                                                                                        | https://github.com/volta-cli/volta/tree/v2.0.2                                                                                         | BSD-2-Clause; checksum-verified upstream LICENSE under `/opt/volta/LICENSE`                                                                                                                                                                                  |
| Rust 1.98.1, Cargo, Clippy, rustfmt, LLVM tools                                                    | https://github.com/rust-lang/rust/tree/1.98.1                                                                                          | MIT/Apache-2.0 and LLVM exceptions; distribution notices under `/usr/local/rustup/toolchains`                                                                                                                                                                |
| Eclipse Temurin OpenJDK 21.0.12.1+1                                                                | https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.12.1%2B1 and https://github.com/adoptium/jdk21u                   | GPL-2.0 with Classpath Exception and dependency notices; complete JDK `legal` directory, `NOTICE` and exact build metadata in `/opt/java/openjdk/release`                                                                                                    |
| cargo-deny 0.20.2                                                                                  | https://github.com/EmbarkStudios/cargo-deny/tree/0.20.2                                                                                | MIT OR Apache-2.0; release licenses under `/opt/ci-tools/cargo-deny`; locked dependency archives and notices under `/opt/ci-tools/tool-notices`                                                                                                              |
| cargo-llvm-cov 0.9.1                                                                               | https://static.crates.io/crates/cargo-llvm-cov/cargo-llvm-cov-0.9.1.crate                                                              | MIT OR Apache-2.0; verified license texts under `/opt/ci-tools/cargo-llvm-cov`; locked build sources under `/opt/ci-tools/tool-notices`; build receipt in `/opt/ci-tools/cargo-llvm-cov/source-build.json`                                                   |
| GitHub CLI 2.104.0                                                                                 | https://github.com/cli/cli/tree/v2.104.0                                                                                               | MIT; complete release LICENSE under `/opt/ci-tools/gh`, pinned Go module/runtime sources and notices under `/opt/ci-tools/tool-notices`                                                                                                                      |
| swift-format 600.0.0 and SwiftLint 0.65.1                                                          | https://github.com/swiftlang/swift-format and https://github.com/realm/SwiftLint                                                       | Apache-2.0 with Swift exceptions (swift-format), MIT (SwiftLint), and individual dependency terms; complete pinned source archives, SwiftPM locks and notice texts under `/opt/ci-tools/swift-sources` and `/opt/ci-tools/ci-*.resolved.json`                |
| Swift 6.2.4 runtime, SourceKit and compiler support libraries                                      | https://github.com/swiftlang/swift-docker/tree/ef2c1e72ea88715a5b8c632b26bbf835a0c7bf4b/6.2/debian/12                                  | Swift/LLVM Apache-2.0 exceptions and component-specific terms, including Foundation, libdispatch and ICU; distribution LICENSE under `/opt/ci-tools/swift-runtime`, complete pinned upstream source archives and notices under `/opt/ci-tools/swift-sources` |
| Gitleaks 8.24.3                                                                                    | https://github.com/gitleaks/gitleaks/tree/v8.24.3                                                                                      | MIT; complete release archive under `/opt/ci-tools/gitleaks`; module and Go runtime notices, including pflag's BSD copyright and terms, under `/opt/ci-tools/tool-notices`                                                                                   |
| ktlint 1.7.1                                                                                       | https://github.com/pinterest/ktlint/tree/1.7.1                                                                                         | MIT; LICENSE and unmodified executable under `/opt/ci-tools/ktlint`; transitive Maven distributions and supplemental source notices under `/opt/ci-tools/tool-notices`                                                                                       |
| Playwright core                                                                                    | https://github.com/microsoft/playwright/tree/v1.63.0                                                                                   | Apache-2.0; complete pinned npm distributions, including LICENSE and NOTICE, under `/opt/ci-tools/playwright-*`; exact package URLs and integrity in `/opt/ci-tools/ci-browsers.json`                                                                        |

## Tool dependency notices

`/opt/ci-tools/tool-notices/manifest.json` records authoritative archive URLs, SHA-256
hashes, selected notice paths and hashes, supplemental notice sources, dependency edges
and prebuilt tool hashes for both architectures. cargo-llvm-cov records its source-build
method and toolchain instead of an upstream binary hash. Complete archives are retained as
`<sha256>.archive`; readable notice texts are retained as `texts/<sha256>`. The manifest
maps those content-addressed files back to their component and upstream paths. Maven
POMs and their parent POMs are retained as `<sha256>.pom`.

The inventory includes:

- cargo-deny's release `Cargo.lock` and every registry crate it records, including
  development and other-platform dependencies. Crate hashes must match the lock.
- cargo-llvm-cov's checksum-pinned published crate and `Cargo.lock`, plus the release
  repository. Image construction builds that crate using `cargo install --path . --locked`
  with the pinned Rust toolchain and a temporary Cargo home. Archive and lock hashes are
  checked before and after compilation. The retained build receipt binds the source and
  lock hashes, architecture, compiler identity, command and resulting binary hash.
  Source-free verification checks those bindings and the installed binary. It does not
  assert byte-for-byte reproducibility or reuse upstream prebuilt provenance.
- GitHub CLI's and Gitleaks' complete `go.mod` module sets, checked against the module versions and Go
  content checksums embedded in each binary, plus the matching Go runtime source distribution. This includes go-re2's
  WebAssembly dependency notices. Go replacements and unknown Cargo sources require
  explicit collector changes; they are not silently omitted.
- ktlint's recursive published compile/runtime Maven dependency graph before version
  conflict resolution. This is a conservative superset, not an exact shaded-jar SBOM.
  Individual unshaded JARs preserve notices lost through shaded filename collisions.
  Same-version source archives supplement distributions without notice files. Kotlin
  sources retain the compiler's copied IntelliJ code and third-party license directory;
  annotation source JARs retain their copyright/license headers.

Notice selection includes nested LICENSE, COPYING, COPYRIGHT, NOTICE, AUTHORS and legal
files. If an archive has none, source files with copyright and license headers are
selected. Complete archives also preserve inline notices, copied code, test data and
assets outside that selection. Missing notice files, changed hashes, missing locked
crates or missing recorded Maven edges fail collection and verification. A separate
retained-file inventory checks existing Debian, Volta, Node, npm, Rust, JDK and Playwright
notices without deleting or replacing their terms.

The inventory is generated by `ci-tool-notices-update.py`; see [image inputs](ci-README.md#inputs-and-distribution)
for the update command. Review source supplements and build provenance when upgrading
prebuilt tools. Archive retention and hash verification are not legal clearance or a
reconstruction of the upstream builds.

## Swift source tools

`ci-swift-tools.json` binds a digest-pinned official Debian 12 Swift compiler image,
source revisions and archive hashes, every locked SwiftPM dependency, and retained
notice paths/hashes. SwiftLint and swift-format are built from those sources with
automatic resolution and experimental prebuilt SwiftSyntax libraries disabled.
Source trees and lock bytes are checked before and after compilation. The build
receipt records compiler identity, arguments, architecture and hashes of the tools,
retained sources, notices and the copied runtime closure. It does not claim
byte-for-byte reproducibility.

Only the tools, SourceKit and shared libraries required by their ELF dependency
closure are copied from the Swift build stage. No foreign root filesystem, libc,
Swift compiler executable, project source or project dependencies are imported.
System libraries come from the final Debian image and retain the existing Debian
source inventory. Swift, LLVM, Foundation, libdispatch, ICU and compiler SwiftSyntax
source archives supplement the copied upstream runtime's distribution license;
individual dependency terms remain applicable.

Source-free verification checks the retained archives, notices and installed file
hashes and executes a SourceKit-dependent lint rule. A static SwiftLint binary that
skips SourceKit rules is not an equivalent verification tool. These source checks
do not qualify native AppKit or macOS product behavior.

## Distribution boundaries

No browser archives are installed in the image. In particular, it contains neither
Playwright's WebKit bundle nor the full Chrome for Testing archive and its proprietary
Widevine component. Playwright's installer remains available for direct runtime downloads
into an external writable cache. Runtime downloads do not become part of the
distributable image; do not add the populated browser cache to published image layers.

No project's license overrides the terms of its dependencies.

The image still contains Debian GPL/LGPL binaries (including native WebKitGTK) and the
GPL-2.0-with-Classpath-Exception JDK. Their corresponding-source obligations apply when
redistributing the image. The Classpath Exception is not an exemption from distributing
OpenJDK's own corresponding source.

`/opt/ci-tools/sources/debian` retains compressed source archives, upstream signatures,
and Debian `.dsc` and patch archives for every installed source package at its exact
`dpkg-query` source version. Sources are resolved using authenticated `deb-src` indexes
from the same dated snapshots; a missing version fails the build. Binary-to-source
inventory, exact requests, download URLs and SHA-256 hashes accompany the archives.
No source package is unpacked or rebuilt.

`/opt/ci-tools/sources/temurin` retains the official full OpenJDK source archive and its
release metadata, plus the complete Temurin build repository at commit
`e6ba7dec3d07654074559310376a3ae89da5f4ac`. That repository includes build scripts and
certificate-generation inputs. Binary release metadata records the architecture's
configure arguments, build environment and OpenJDK commit
`1c417fbfc2f70ab03a565b0af0a5a3c6f5e15ad6`; both commits are checked against the installed
JDK's `release` file. The source archive is from the patched `_adopt` release, not the
unpatched upstream OpenJDK tag. Downloads are checksum-pinned in `ci-sources.json`.

Retain these source archives and existing notices for recipients when redistributing
the image. Verify source coverage and checksums with `ci-verify.mjs`. That verification
does not rebuild the binaries or perform a legal compliance audit.

The image retains distribution notices rather than deleting documentation to reduce size.
Keep this inventory, the digest, package inventory and source materials associated with any
published image. No Windows SDK or proprietary codec redistribution rights are assumed.
