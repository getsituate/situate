import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/disabled-workflows/mobile.yml", import.meta.url),
  "utf8",
);
test("mobile CI is retained outside the active workflow directory", () => {
  assert.equal(
    existsSync(new URL("../.github/workflows/mobile.yml", import.meta.url)),
    false,
  );
  assert.match(
    workflow,
    /Android and iOS builds and device verification are not a current development focus/,
  );
});

function program(step) {
  const section = workflow.split(`- name: ${step}\n`)[1];
  assert.ok(section, `Missing workflow step: ${step}`);
  const match = section.match(/python3 - <<'PY'\n([\s\S]*?)\n {10}PY/);
  assert.ok(match, `Missing Python program: ${step}`);
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}
function run(step, fixture, after = "") {
  return spawnSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-c",
      `${fixture}\nexec(json.loads(sys.argv[1]))\n${after}`,
      JSON.stringify(program(step)),
    ],
    { encoding: "utf8", timeout: 10000 },
  );
}
const common = `
import json, os, pathlib, plistlib, subprocess, sys, tempfile
scratch = tempfile.TemporaryDirectory()
os.chdir(scratch.name)
launches = 0
bundle = 'dev.situate.client.smoke'
`;
const apple = `${common}
os.environ['SIMULATOR_ID'] = 'owned-simulator'
output = pathlib.Path('client/app/src-tauri/gen/apple/build/arm64-sim')
def app(name, identifier):
    path = output / name
    path.mkdir(parents=True)
    (path / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': identifier}, fmt=plistlib.FMT_BINARY))
app('Other.app', 'dev.situate.client')
app('Unexpected build name.app', bundle)
container = pathlib.Path(scratch.name) / 'sandbox'
container.mkdir()
report = container / 'smoke-result.json'
fail_second = False
def fake_sim(args, **kwargs):
    global launches
    assert args[:2] == ['xcrun', 'simctl']
    action = args[2]
    assert args[3] == 'owned-simulator'
    if action == 'install':
        assert args[4].endswith('Unexpected build name.app')
    elif action == 'get_app_container':
        return str(container)
    elif action == 'launch':
        assert not report.exists(), 'A stale report survived into the next launch'
        launches += 1
        report.write_text(json.dumps({'passed': not (fail_second and launches == 2)}))
    elif action != 'terminate':
        raise AssertionError(args)
    return ''
subprocess.check_output = fake_sim
`;
const android = `${common}
os.environ.update(ANDROID_SERIAL='emulator-5554', AVD_NAME='owned-avd', ANDROID_HOME='/sdk')
apk = pathlib.Path('client/app/src-tauri/gen/android/app/build/outputs/apk/x86_64/debug/smoke.apk')
apk.parent.mkdir(parents=True)
apk.touch()
report_exists, installs, removals = False, 0, 0
foreign, fail_second = False, False
def fake_android(args, **kwargs):
    global launches, report_exists, installs, removals
    if args[0].endswith('/aapt2'):
        return "package: name='dev.situate.client.smoke'\\nlaunchable-activity: name='dev.situate.client.smoke.MainActivity'\\napplication-debuggable"
    assert args[:3] == ('adb', '-s', 'emulator-5554')
    action = args[3:]
    if action == ('emu', 'avd', 'name'):
        return ('foreign-avd' if foreign else 'owned-avd') + '\\nOK'
    if action[0] == 'install':
        installs += 1
        return 'Success'
    if action[:3] == ('shell', 'pm', 'clear'):
        report_exists = False
        return 'Success'
    if action[:3] == ('shell', 'am', 'force-stop'):
        return ''
    if action[:3] == ('shell', 'am', 'start'):
        assert not report_exists, 'A stale report survived into the next launch'
        launches += 1
        report_exists = True
        return 'Status: ok'
    assert action[:3] == ('shell', 'run-as', bundle)
    if action[3] == 'find':
        return './files/smoke-result.json' if report_exists else ''
    if action[3] == 'rm':
        report_exists = False
        removals += 1
        return ''
    if action[3] == 'cat':
        return json.dumps({'passed': not (fail_second and launches == 2)})
    raise AssertionError(args)
subprocess.check_output = fake_android
`;

for (const occupied of ["device", "port"]) {
  test(`emulator startup refuses an occupied ${occupied} before starting a process`, () => {
    const fixture = `${common}
import socket
os.environ.update(ANDROID_SERIAL='emulator-5554', AVD_NAME='owned-avd')
subprocess.check_output = lambda *args, **kwargs: ${occupied === "device" ? "'List of devices attached\\nemulator-5554\\tdevice'" : "'List of devices attached'"}
def unexpected(*args, **kwargs):
    raise AssertionError('Must not start an emulator')
subprocess.Popen = unexpected
class OccupiedSocket:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def bind(self, address): raise OSError('Emulator port already in use')
socket.socket = OccupiedSocket
`;
    const result = run("Start isolated emulator", fixture);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      occupied === "device"
        ? /Refusing to reuse existing emulator/
        : /Emulator port already in use/,
    );
  });
}

test("emulator cleanup rejects foreign ownership without killing or deleting it", () => {
  const section = workflow
    .split("- name: Stop owned emulator\n")[1]
    .split("\n\n")[0];
  assert.match(section, /if: always\(\) && env\.EMULATOR_STARTED == 'true'/);
  const script = section
    .split("run: |\n")[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
  const fixture = `
    adb() { if [ "$5" = name ]; then printf 'foreign-avd\\nOK\\n'; else echo UNEXPECTED_KILL; fi; }
    avdmanager() { echo UNEXPECTED_DELETE; }
    export ANDROID_SERIAL=emulator-5554 AVD_NAME=owned-avd
  `;
  const result = spawnSync("bash", ["-e", "-c", `${fixture}\n${script}`], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /UNEXPECTED/);
});

const androidStep = "Require fresh Android smoke reports on both launches";
const appleStep = "Require fresh passing reports on both launches";

test("Android smoke installs its verified APK and requires two fresh passing reports", () => {
  const result = run(
    androidStep,
    android,
    "assert launches == 2 and installs == 1 and removals == 1",
  );
  assert.equal(result.status, 0, result.stderr);
});

test("Android smoke refuses a foreign emulator before installation", () => {
  const result = run(androidStep, `${android}\nforeign = True`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not owned by this job/);
});

for (const [platform, step, fixture] of [
  ["Android", androidStep, android],
  ["iOS", appleStep, apple],
]) {
  test(`${platform} smoke rejects a failing second launch`, () => {
    const result = run(step, `${fixture}\nfail_second = True`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /smoke launch failed/i);
  });
}

test("iOS discovers the smoke bundle by binary plist identity, not filename", () => {
  const result = run(appleStep, apple, "assert launches == 2");
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, change, count] of [
  [
    "missing",
    "(output / 'Unexpected build name.app' / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'wrong.bundle'}))",
    0,
  ],
  ["ambiguous", "app('Duplicate.app', bundle)", 2],
]) {
  test(`iOS rejects ${name} smoke bundles before installing`, () => {
    const result = run(appleStep, `${apple}\n${change}`);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      new RegExp(`exactly one smoke app bundle, found ${count}`),
    );
  });
}
