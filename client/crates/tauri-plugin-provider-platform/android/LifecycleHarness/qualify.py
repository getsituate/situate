#!/usr/bin/env python3
"""Exercise only the disposable emulator selected by run.sh."""
import argparse
import json
import os
import re
from pathlib import Path
import subprocess
import time
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

from browser_state import browser_state

parser = argparse.ArgumentParser()
parser.add_argument("--consent-liveness", action="store_true", help="Observe background liveness without accepting browser terms")
parser.add_argument("--fgs", action="store_true", help="Exercise the production foreground service with denied, granted and blocked notifications")
parser.add_argument("--fgs-case", choices=["denied", "granted", "blocked", "destroyed"], action="append")
OPTIONS = parser.parse_args()

ROOT = Path(os.environ["ROOT"])
SERIAL = f"emulator-{os.environ['EMULATOR_PORT']}"
APP = "dev.situate.tests.providerplatform"
COMPONENT = f"{APP}/dev.situate.providers.harness.HarnessActivity"
PREFIX = [os.environ["ADB"], "-H", "127.0.0.1", "-P", os.environ["ADB_PORT"], "-s", SERIAL]


def adb(*args, check=True, binary=False):
    result = subprocess.run(PREFIX + list(args), capture_output=True, timeout=35)
    if check and result.returncode:
        raise RuntimeError(f"ADB exited {result.returncode}: {(result.stdout + result.stderr).decode(errors='replace')}")
    return result.stdout if binary else result.stdout.decode(errors="replace").strip()


def private(name):
    return adb("shell", "run-as", APP, "cat", f"files/{name}", check=False)


def launch(action):
    return adb("shell", "am", "start", "-W", "--activity-single-top", "-n", COMPONENT, "--es", "action", action)


def wait_event(text, timeout=15):
    deadline = time.monotonic() + timeout
    pid = int(adb("shell", "pidof", APP))
    while time.monotonic() < deadline:
        content = private("activity-events.jsonl")
        current = [json.loads(line) for line in content.splitlines() if line.startswith("{")]
        current = [event for event in current if event["pid"] == pid]
        if any(text in event["kind"] for event in current):
            return content
        if any(event["kind"].startswith("failed:") for event in current):
            raise RuntimeError(content)
        time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for {text}: {content}")


def ui():
    adb("shell", "uiautomator", "dump", "/sdcard/synthetic-window.xml", check=False)
    data = adb("shell", "cat", "/sdcard/synthetic-window.xml")
    return data, ET.fromstring(data)


def snapshot(label):
    (ROOT / f"{label}-processes.txt").write_text(adb("shell", "dumpsys", "activity", "processes"))
    (ROOT / f"{label}-services.txt").write_text(adb("shell", "dumpsys", "activity", "services", APP))
    (ROOT / f"{label}-activities.txt").write_text(adb("shell", "dumpsys", "activity", "activities"))
    (ROOT / f"{label}-rust.jsonl").write_text(private("rust-events.jsonl"))
    (ROOT / f"{label}-activity.jsonl").write_text(private("activity-events.jsonl"))
    (ROOT / f"{label}.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))


def consent_liveness(action="browser", label="consent"):
    launch(action)
    time.sleep(1)
    port = urlsplit(private("fixture-url.txt")).port
    if port is None:
        raise RuntimeError("Missing fixture loopback port")
    time.sleep(43)
    snapshot(f"{label}-active-before-shell-probe")
    (ROOT / f"{label}-shell-probe-command.txt").write_text(f"guest-shell HTTP GET /shell-callback?state=synthetic to 127.0.0.1:{port}\n")
    (ROOT / "netcat-help.txt").write_text(adb("shell", "toybox", "nc", "--help", check=False))
    command = f"printf 'GET /shell-callback?state=synthetic HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\n\\r\\n' | toybox nc -w 5 -W 5 127.0.0.1 {port}"
    started = time.time()
    probe = subprocess.run(PREFIX + ["shell", command], capture_output=True, timeout=15)
    (ROOT / f"{label}-shell-probe-response.txt").write_bytes(probe.stdout + probe.stderr)
    snapshot(f"{label}-active-after-shell-probe")
    active_events = [json.loads(line) for line in private("rust-events.jsonl").splitlines() if line.startswith("{")]
    observation = {
        "callbackOrigin": "guest shell, not browser",
        "probeStartTimeMs": int(started * 1000),
        "probeExitCode": probe.returncode,
        "probeResponseReceived": b"HTTP/1.1 200 OK" in probe.stdout,
        "shellCallbackWhileConsentVisible": any(event["kind"] == "shell_callback" for event in active_events),
        "browserPageRequested": any(event["kind"] == "page" for event in active_events),
    }
    if action == "fgs-destroy-browser":
        wait_event("activity destroyed", timeout=20)
        snapshot(f"{label}-destroy-draining")
        observation["foregroundAfterDestruction"] = "isForeground=true" in (ROOT / f"{label}-destroy-draining-services.txt").read_text()
        wait_event("native finish after activity destruction acknowledged", timeout=20)
        snapshot(f"{label}-finished")
        observation["nativeFinishAcknowledged"] = '"kind":"finish_ack"' in private("rust-events.jsonl")
        observation["serviceGoneAfterFinish"] = "ServiceRecord" not in (ROOT / f"{label}-finished-services.txt").read_text()
        report[label] = observation
        print(json.dumps(observation, indent=2), flush=True)
        return
    if action.startswith("fgs"):
        wait_event("foreground exit cancelled", timeout=20)
        time.sleep(2)
        snapshot(f"{label}-cancel-draining")
        observation["foregroundAfterCancellation"] = "isForeground=true" in (ROOT / f"{label}-cancel-draining-services.txt").read_text()
        observation["nativeCancellationReceived"] = '"kind":"native_cancel"' in private("rust-events.jsonl")
    adb("shell", "input", "keyevent", "KEYCODE_BACK")
    time.sleep(3)
    snapshot(f"{label}-returned")
    returned = [json.loads(line) for line in private("rust-events.jsonl").splitlines() if line.startswith("{")]
    observation["shellCallbackAfterReturn"] = any(event["kind"] == "shell_callback" for event in returned)
    launch("finish")
    time.sleep(1)
    snapshot(f"{label}-finished")
    observation["serviceGoneAfterFinish"] = "ServiceRecord" not in (ROOT / f"{label}-finished-services.txt").read_text()
    report[label] = observation
    print(json.dumps(observation, indent=2), flush=True)


def block_channel():
    launch("prepare-channel")
    wait_event("channel prepared")
    adb("shell", "am", "start", "-W", "-a", "android.settings.CHANNEL_NOTIFICATION_SETTINGS", "--es", "android.provider.extra.APP_PACKAGE", APP, "--es", "android.provider.extra.CHANNEL_ID", "situate-provider-auth")
    time.sleep(2)
    document, nodes = ui()
    (ROOT / "channel-settings-before.xml").write_text(document)
    if "Sign-in activity" not in document:
        raise RuntimeError("Expected fixture channel settings are not visible")
    switches = [node for node in nodes.iter("node") if node.get("resource-id", "").endswith("/switch_widget") and node.get("checked") == "true"]
    if len(switches) != 1:
        raise RuntimeError("Fixture channel block switch is not uniquely identifiable")
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", switches[0].get("bounds")))
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
    time.sleep(1)
    (ROOT / "channel-settings-after.xml").write_text(ui()[0])
    adb("shell", "input", "keyevent", "KEYCODE_BACK")


def main():
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        if adb("shell", "getprop", "sys.boot_completed", check=False) == "1":
            time.sleep(10)
            if adb("shell", "getprop", "sys.boot_completed", check=False) == "1":
                break
        time.sleep(2)
    else:
        raise RuntimeError("Disposable emulator failed to boot")
    global logcat
    logcat = subprocess.Popen(PREFIX + ["logcat", "-v", "threadtime"], stdout=(ROOT / "guest-logcat.txt").open("wb"), stderr=subprocess.STDOUT)
    (ROOT / "guest-network.txt").write_text(adb("shell", "ip", "route") + "\n" + adb("shell", "ip", "-6", "route"))
    (ROOT / "browser-resolver.txt").write_text(adb("shell", "cmd", "package", "query-activities", "--brief", "-a", "android.intent.action.VIEW", "-d", "http://127.0.0.1:9"))
    (ROOT / "freezer-setting.txt").write_text(adb("shell", "settings", "get", "global", "cached_apps_freezer"))
    adb("install", "--streaming", os.environ["APK"])
    launch("create")
    wait_event("passed: created random32")
    adb("shell", "am", "force-stop", APP)
    launch("verify")
    wait_event("passed: restart read equality delete missing and alias cleanup")
    report["keystoreRestartRoundtrip"] = True
    (ROOT / "storage-events.jsonl").write_text(private("activity-events.jsonl"))
    print("PASS real Keystore random32 roundtrip, process restart and cleanup", flush=True)

    adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "http://127.0.0.1:9")
    deadline = time.monotonic() + 45
    state = "loading"
    while time.monotonic() < deadline:
        document, nodes = ui()
        state = browser_state(nodes)
        if state != "loading":
            break
        time.sleep(1)
    (ROOT / "browser-initial.xml").write_text(document)
    (ROOT / "browser-initial.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))
    if state == "loading":
        report["browserBlocker"] = "Browser first-run or toolbar did not become visible"
        return
    if state == "terms":
        report["browserBlocker"] = "Browser first-run terms require consent; no agreement accepted"
        print(report["browserBlocker"], flush=True)
        if OPTIONS.fgs:
            for scenario in OPTIONS.fgs_case or ["denied", "granted", "blocked", "destroyed"]:
                adb("uninstall", APP)
                adb("install", "--streaming", os.environ["APK"])
                if scenario != "denied":
                    adb("shell", "pm", "grant", APP, "android.permission.POST_NOTIFICATIONS")
                label = f"fgs-{scenario}"
                if scenario == "blocked":
                    block_channel()
                action = "fgs-destroy-browser" if scenario == "destroyed" else "fgs-blocked-browser" if scenario == "blocked" else "fgs-browser"
                consent_liveness(action, label)
                observed = report[label]
                required = ["probeResponseReceived", "shellCallbackWhileConsentVisible", "serviceGoneAfterFinish"]
                required += ["foregroundAfterDestruction", "nativeFinishAcknowledged"] if scenario == "destroyed" else ["foregroundAfterCancellation", "nativeCancellationReceived"]
                if not all(observed[key] for key in required):
                    raise RuntimeError(f"Foreground service scenario failed: {label}")
                if scenario == "destroyed":
                    continue
                activity = (ROOT / f"{label}-cancel-draining-activity.jsonl").read_text()
                expected = "notifications enabled=false" if scenario == "denied" else "channel=0" if scenario == "blocked" else "notification PendingIntent cancel"
                if expected not in activity:
                    raise RuntimeError(f"Notification scenario not established: {label}")
        elif OPTIONS.consent_liveness:
            consent_liveness()
        return

    launch("browser")
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if '"kind":"page"' in private("rust-events.jsonl"):
            break
        time.sleep(0.5)
    else:
        snapshot("page-not-loaded")
        raise RuntimeError("External browser did not load the loopback fixture")
    time.sleep(52)
    snapshot("browser-active")
    events = [json.loads(line) for line in private("rust-events.jsonl").splitlines() if line.startswith("{")]
    report["callbackWhileBrowserActive"] = any(event["kind"] == "callback" for event in events)
    print(f"Callback while browser active: {report['callbackWhileBrowserActive']}", flush=True)
    adb("shell", "input", "keyevent", "KEYCODE_BACK")
    time.sleep(5)
    launch("finish")
    time.sleep(2)
    snapshot("returned")
    report["callbackAfterReturn"] = "passed: delayed callback observed on return" in private("activity-events.jsonl")

    adb("shell", "am", "force-stop", APP)
    launch("browser")
    time.sleep(5)
    adb("shell", "input", "keyevent", "KEYCODE_BACK")
    time.sleep(1)
    launch("cancel")
    wait_event("passed: cancelled without callback")
    time.sleep(42)
    snapshot("cancelled")
    report["cancellation"] = '"kind":"callback"' not in private("rust-events.jsonl")
    print(f"Cancellation without callback: {report['cancellation']}", flush=True)


report = {}
logcat = None
try:
    main()
except Exception as error:
    report["error"] = str(error)
    raise
finally:
    if logcat is not None:
        logcat.terminate()
        logcat.wait(timeout=5)
    (ROOT / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)

if report.get("browserBlocker"):
    raise SystemExit(2)
if not all(report.get(key) is True for key in ["keystoreRestartRoundtrip", "callbackWhileBrowserActive", "callbackAfterReturn", "cancellation"]):
    raise SystemExit(1)
