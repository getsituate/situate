#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
: "${ANDROID_HOME:?Set ANDROID_HOME to the existing SDK}"
: "${JAVA_HOME:?Set JAVA_HOME to the existing JDK}"
: "${GRADLE_BIN:?Set GRADLE_BIN to the existing Gradle 8.14.3 executable}"
NDK="$ANDROID_HOME/ndk/28.2.13676358/toolchains/llvm/prebuilt/darwin-x86_64/bin"
AAPT="$ANDROID_HOME/build-tools/36.0.0/aapt2"
test -x "$NDK/aarch64-linux-android24-clang"
test -x "$AAPT"
SIGNING=$(mktemp -d /tmp/situate-android-signing.XXXXXX)
trap 'rm -rf -- "$SIGNING"' EXIT
export SITUATE_TEST_KEYSTORE="$SIGNING/debug.keystore"
"$JAVA_HOME/bin/keytool" -genkeypair -keystore "$SITUATE_TEST_KEYSTORE" -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 2 -dname 'CN=Synthetic Android Tests'
RUSTC=$(rustup which --toolchain 1.98.1 rustc)
export RUSTC CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK/aarch64-linux-android24-clang"
rustup run 1.98.1 cargo build --offline --manifest-path "$HERE/rust/Cargo.toml" --target aarch64-linux-android
mkdir -p "$HERE/src/main/jniLibs/arm64-v8a"
cp "$HERE/rust/target/aarch64-linux-android/debug/libandroid_provider_lifecycle.so" "$HERE/src/main/jniLibs/arm64-v8a/"
node "$HERE/../../../../scripts/generate-mobile-permissions.mjs" --android
"$GRADLE_BIN" -p "$HERE" --offline --no-daemon -Pandroid.aapt2FromMavenOverride="$AAPT" assembleDebug
