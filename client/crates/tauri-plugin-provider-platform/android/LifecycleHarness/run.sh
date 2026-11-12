#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
: "${ANDROID_HOME:?Set ANDROID_HOME to the existing SDK}"
: "${JAVA_HOME:?Set JAVA_HOME to the existing JDK}"
ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
ADB_PORT=${ADB_PORT:-5049}
EMULATOR_PORT=${EMULATOR_PORT:-5584}
NETWORK_PORT=${NETWORK_PORT:-5599}
APK="$HERE/build/outputs/apk/debug/provider-platform-lifecycle-debug.apk"
test -f "$APK"
for port in "$ADB_PORT" "$EMULATOR_PORT" "$((EMULATOR_PORT + 1))" "$NETWORK_PORT"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "Port $port is already in use" >&2
        exit 1
    fi
done
ROOT=$(mktemp -d /tmp/situate-android-lifecycle.XXXXXX)
export ROOT ADB ADB_PORT EMULATOR_PORT APK
export HOME="$ROOT/home" ANDROID_USER_HOME="$ROOT/home/.android"
export ANDROID_EMULATOR_HOME="$ANDROID_USER_HOME" ANDROID_AVD_HOME="$ROOT/avd"
export TMPDIR="$ROOT/tmp/" ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_TOOL_OPTIONS="-Duser.home=$HOME -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=9 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=9"
export ADB_SERVER_SOCKET="tcp:localhost:$ADB_PORT" ANDROID_ADB_SERVER_PORT="$ADB_PORT" ADB_SERVER_PORT="$ADB_PORT"
export ADB_USB=0 ADB_MDNS=0 ADB_MDNS_AUTO_CONNECT=0 ADB_LOCAL_TRANSPORT_MAX_PORT=1
export http_proxy=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 no_proxy=127.0.0.1,localhost
mkdir -p "$ANDROID_USER_HOME" "$ANDROID_AVD_HOME" "$TMPDIR"
ADB_PID='' EMULATOR_PID=''
cleanup() {
    local result=$?
    trap - EXIT
    for pid in "$EMULATOR_PID" "$ADB_PID"; do
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            for _ in {1..40}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
            if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
            wait "$pid" 2>/dev/null || true
        fi
    done
    {
        echo "Owned emulator PID: $EMULATOR_PID; owned ADB PID: $ADB_PID"
        for pid in "$EMULATOR_PID" "$ADB_PID"; do
            if [[ -n "$pid" ]]; then ps -p "$pid" -o pid=,command= || true; fi
        done
        echo "Private port listeners after teardown (expected empty):"
        lsof -nP -iTCP:"$ADB_PORT" -iTCP:"$EMULATOR_PORT" -iTCP:"$((EMULATOR_PORT + 1))" -iTCP:"$NETWORK_PORT" -sTCP:LISTEN || true
        echo "Global ADB listener after teardown:"
        lsof -nP -iTCP:5037 -sTCP:LISTEN || true
    } > "$ROOT/cleanup.txt"
    rm -rf -- "${ROOT:?}/avd" "${ROOT:?}/home" "${ROOT:?}/tmp"
    echo "Disposable AVD, authentication keys and emulator home removed" >> "$ROOT/cleanup.txt"
    echo "Artifacts: $ROOT (exit $result)"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
lsof -nP -iTCP:5037 -sTCP:LISTEN > "$ROOT/global-adb-before.txt" 2>/dev/null || true
NAME="situate-synthetic-$$"
printf 'no\n' | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n "$NAME" -p "$ANDROID_AVD_HOME/$NAME.avd" -k 'system-images;android-36;google_apis;arm64-v8a' -d pixel_7 > "$ROOT/avd-create.log" 2>&1
"$ADB" -L "$ADB_SERVER_SOCKET" --one-device "synthetic-no-usb-$$" server nodaemon > "$ROOT/adb.log" 2>&1 &
ADB_PID=$!
for _ in {1..100}; do
    kill -0 "$ADB_PID"
    if lsof -nP -iTCP:"$ADB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then break; fi
    sleep 0.1
done
lsof -nP -iTCP:"$ADB_PORT" -sTCP:LISTEN > "$ROOT/private-adb-listener.txt"
"$EMULATOR" -avd "$NAME" -port "$EMULATOR_PORT" -no-window -no-snapshot -no-metrics -no-direct-adb -no-audio -no-boot-anim -gpu swiftshader -memory 2048 -cores 2 -net-socket "listen=127.0.0.1:$NETWORK_PORT" -feature -WiFiPacketStream,-Uwb,-Nfc,-NetsimWebUi,-NetsimCliUi -packet-streamer-endpoint localhost:9 > "$ROOT/emulator.log" 2>&1 &
EMULATOR_PID=$!
printf 'emulator PID=%s; adb PID=%s; home=%s; adb port=%s; emulator port=%s; isolated network socket=%s\n' "$EMULATOR_PID" "$ADB_PID" "$HOME" "$ADB_PORT" "$EMULATOR_PORT" "$NETWORK_PORT" > "$ROOT/launch.txt"
python3 "$HERE/qualify.py" "$@"
