# iOS provider platform tests

Requires Xcode with an installed iOS simulator runtime, XcodeGen, XcodeBuildMCP, and the repository Rust toolchain with `aarch64-apple-ios-sim`. No developer account or provisioning profile is used. The simulator app is ad-hoc signed with identity `-` and an isolated `dev.situate.tests.auth-lifecycle` Keychain access group.

From this directory:

```sh
cd rust
RUSTC="$(rustup which --toolchain 1.98.1 rustc)" \
  rustup run 1.98.1 cargo build --target aarch64-apple-ios-sim
cd ..
xcodegen generate
xcodebuildmcp simulator list
# Set SIMULATOR_ID to an installed iOS simulator UUID.
xcodebuildmcp simulator test \
  --project-path "$PWD/AuthLifecycle.xcodeproj" \
  --scheme AuthLifecycle \
  --simulator-id "$SIMULATOR_ID" \
  --derived-data-path "$PWD/derived"
```

The tests include:

- Injected Keychain policy and browser ownership/error tests.
- A system authentication session using the production coordinator and a Rust loopback server. A synthetic page redirects after 40 seconds; the app checks continued foreground execution, prompt startup, and explicit session dismissal after Rust receives the callback.
- User cancellation through the system browser UI.
- A real simulator Keychain roundtrip using a fresh UUID account and random 32-byte synthetic value, followed by deletion and a missing-item check. Cleanup targets only that account. The harness never probes availability or enumerates existing accounts.

The [Apple authentication guide](https://developer.apple.com/documentation/authenticationservices/authenticating-a-user-through-a-web-service) describes system authentication UI and scheme-based callbacks. The SDK permits a nil callback scheme; it does not promise HTTP-loopback completion or indefinite foreground execution. This harness exercises nil-scheme behavior while Rust alone owns completion and explicitly closes the session.

No provider is contacted. The harness does not establish real provider authentication, production signing/access-group behavior, physical-device backup protection, or execution while the app is backgrounded or the device is locked. An unsigned harness may fail the Keychain test with `-34018` (missing entitlement); do not substitute production signing credentials or access groups.
