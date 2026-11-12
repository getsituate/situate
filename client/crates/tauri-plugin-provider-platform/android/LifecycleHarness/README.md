# Android provider platform tests

A standalone synthetic app compiles the production key store, foreground service, coordinator and Rust/JNI finish bridge directly. Its application ID is `dev.situate.tests.providerplatform`. It declares `INTERNET`, the foreground-service permissions and optional `POST_NOTIFICATIONS`; it never requests notification permission through a prompt. The Rust loopback server and local browser URLs belong exclusively to this fixture. Production provider URL validation is unchanged.

## Prerequisites and commands

On macOS ARM64, use an existing JDK 21, Gradle 8.14.3, Rust 1.98.1 with `aarch64-linux-android`, and Android SDK containing:

- API36 Google APIs ARM64 emulator image and emulator tools;
- platform 37, build tools 36.0.0 and NDK 28.2.13676358;
- cached AGP 8.11.1 and Kotlin 2.2.20 dependencies.

Set `ANDROID_HOME`, `JAVA_HOME` and `GRADLE_BIN` to those installed tools. From this directory:

```sh
python3 -B -m unittest test_browser_state.py
bash build.sh
bash run.sh --fgs
```

The build uses offline Gradle and Cargo, the installed SDK AAPT2 binary, and a temporary synthetic debug signing key deleted on exit. Missing prerequisites fail without installing tools, downloading SDK packages or accepting licenses.

## Isolation and cleanup

`run.sh` creates a new AVD under a unique temporary directory; it never opens an existing AVD. `HOME`, `ANDROID_USER_HOME`, `ANDROID_EMULATOR_HOME`, `ANDROID_AVD_HOME` and `TMPDIR` are isolated. Its private ADB server disables USB, mDNS discovery and automatic emulator scanning. Every device command selects the owned emulator serial. The emulator uses its external ADB bridge; no second TCP transport is attached.

Default private ports are ADB server 5049, emulator console/transport 5584/5585, and network socket 5599. Occupied ports fail before launch. `ADB_PORT`, `EMULATOR_PORT` and `NETWORK_PORT` can select other unused ports.

Guest networking uses an unconnected socket backend rather than host NAT. Wi-Fi packet streaming is disabled; the radio packet endpoint is a closed loopback port. No host firewall or guest freezer/global settings are changed. Foreground-service scenarios change only the disposable app's notification permission and channel preference. The runner records guest routes and stops rather than accepting or bypassing browser first-run terms.

Exit cleanup terminates the owned emulator and ADB processes, checks their private listeners and the global ADB listener, and removes the disposable AVD, emulator home and authentication keys. The remaining temporary artifact directory contains `launch.txt`, `cleanup.txt`, route observations, synthetic app events, screenshots and `report.json`.

## Coverage and limitations

`--fgs` runs four independent cases with a fresh fixture installation for each: notification permission denied, permission granted, a user-blocked channel, and final Activity destruction. Use repeated `--fgs-case denied|granted|blocked|destroyed` arguments to select cases. The blocked-channel case first publishes the channel, ends that attempt, then disables that channel through Android Settings; Android may promote a never-published channel on its first foreground-service notification.

Each case leaves Chrome's first-run terms unaccepted, waits at least 43 seconds, and sends `/shell-callback` from the guest shell to the native Rust listener. It checks foreground protection and continued native execution. The granted case invokes the actual published Cancel PendingIntent; suppressed-notification cases signal cancellation natively without claiming a drawer action exists. Protection remains until explicit native finish. The destruction case removes the app's last Activity, retains the service through a ten-second test hold, then invokes the production Rust/JNI finish bridge from a worker and verifies acknowledgement and service cleanup.

The cancellation observer is a synthetic JNI recorder, not the full Tauri login controller. The test hold is not a real credential commit. These tests establish service and finish-bridge behavior, not provider enrollment, complete Tauri-app integration, or Play approval for `specialUse`.

The storage scenario creates a UUID account and random 32-byte value, checks immediate read equality and the exact synthetic wrapping key's non-exportability, force-stops the app, and checks persistence in a new process. It then deletes the value, verifies missing data and alias removal, and cleans up its account metadata. It does not enumerate other accounts or probe availability.

Without `--fgs`, if the installed browser is usable without a first-run agreement, the browser scenario opens a synthetic page through `ACTION_VIEW`. Its 40-second redirect targets a Rust listener in the app process. Native heartbeat and lifecycle records distinguish callback delivery while the browser is foregrounded from delivery only after return; a separate cancellation closes the listener. This is not a provider login test.

Exit code 2 means a browser consent prerequisite blocked enrollment; foreground-service diagnostic cases may still have passed individually. It is not a passing browser result. Exit code 1 means an assertion or execution failed. Inspect the per-scenario report rather than treating storage success as browser qualification.

For a separately authorized suspension diagnostic, `bash run.sh --consent-liveness` leaves Chrome's terms unaccepted and foregrounded for at least 43 seconds. It records native heartbeats and process/freezer snapshots, then sends an explicitly labelled `/shell-callback` request from the guest shell. It records whether that request completes before or only after returning to the app. This mode never claims a browser-originated redirect and still reports the browser consent blocker.

API36 emulator storage evidence does not establish physical-device hardware backing, backup behavior, API37 local-network authorization, or browser/background execution. When Chrome first-run terms block the page, the browser-originated delayed callback and cancellation remain unqualified; the optional shell probe is separate diagnostic evidence. No WebView substitute is used.
