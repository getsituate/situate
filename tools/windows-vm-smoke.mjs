import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isIPv4 } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { windowsJob } from "./test-windows-host.mjs";

const execute = promisify(execFile);
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const shell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function loadSmokeArtifact(directory) {
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  assert.equal(
    manifest.kind,
    "situate-windows-smoke",
    "Use an isolated smoke build, not the ordinary CI executable",
  );
  assert.equal(manifest.target, "x86_64-pc-windows-msvc");
  assert.equal(manifest.profile, "profile");
  assert.match(manifest.source, /^[a-f0-9]{40}$/);
  const bytes = await readFile(join(directory, "situate-client.exe"));
  assert.equal(hash(bytes), manifest.sha256, "Smoke executable hash mismatch");
  return { bytes, manifest };
}

export async function reserveGuest(directory, run, signal, timeout = 180_000) {
  await mkdir(join(directory, ".."), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeout;
  for (;;) {
    signal.throwIfAborted();
    try {
      await mkdir(directory, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(`Guest lease is still held: ${directory}`, {
          cause: error,
        });
      await delay(250, undefined, { signal });
    }
  }
  const owner = join(directory, run);
  await writeFile(owner, "", { flag: "wx", mode: 0o600 });
  return async () => {
    await unlink(owner);
    await rmdir(directory);
  };
}

async function run([vm, bind, user, mode, input, ...extra], signal) {
  assert(
    uuid.test(vm ?? "") &&
      isIPv4(bind) &&
      user &&
      !/[\0\r\n]/.test(user) &&
      !extra.length,
    "Usage: node tools/windows-vm-smoke.mjs VM_UUID VM_BRIDGE_IP WINDOWS_TEST_USER (--artifact DIR | --fixture SECONDS|timeout)",
  );
  const fixture = mode === "--fixture";
  assert(
    fixture
      ? /^(0|[1-9]|[1-3][0-9]|40|timeout)$/.test(input ?? "")
      : mode === "--artifact" && input,
    "Choose a smoke artifact or a fixture (0–40 seconds or timeout)",
  );
  const timeoutFixture = fixture && input === "timeout";
  const jobSeconds = timeoutFixture ? 12 : 65;
  const fixtureSeconds = timeoutFixture ? "60" : input;
  const artifact = fixture ? null : await loadSmokeArtifact(input);
  const smoke = await readFile(
    new URL("./windows-vm-smoke.ps1", import.meta.url),
  );
  const utm = (...args) =>
    execute("utmctl", args, { timeout: 10_000, maxBuffer: 64 * 1024 });
  const id = randomUUID();
  const name = `Situate-Smoke-${id}`;
  const directory = `C:\\Users\\Public\\${name}`;
  const lease = join(
    homedir(),
    ".config",
    "situate",
    "windows-vm-queue",
    `${vm.toLowerCase()}.lease`,
  );
  const release = await reserveGuest(lease, name, signal);
  console.log(`${name}: acquired`);
  let active = false;
  let prepareRequested = false;
  let certain = true;
  let server;
  async function control(body) {
    const nonce = randomUUID();
    const response = `C:\\Windows\\Temp\\Situate-Control-${nonce}.json`;
    const script = String.raw`
$ErrorActionPreference='Stop'
$d=${quote(directory)}
$t=${quote(name)}
$r=@{nonce=${quote(nonce)}}
try { ${body} } catch { $r.error=$_.Exception.Message }
[IO.File]::WriteAllText('${response}.tmp',($r | ConvertTo-Json -Compress))
[IO.File]::Move('${response}.tmp','${response}')
`;
    const exec = (source) =>
      utm(
        "exec",
        vm,
        "--cmd",
        shell,
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(source, "utf16le").toString("base64"),
      );
    await exec(script).catch(() => {}); // A guest result, not the Apple event, acknowledges an operation.
    for (let i = 0; i < 18; i++) {
      const { stdout } = await utm("file", "pull", vm, response);
      if (stdout) {
        const data = JSON.parse(stdout);
        assert.equal(data.nonce, nonce);
        await exec(`[IO.File]::Delete('${response}')`).catch(() => {});
        if (data.error) throw new Error(data.error);
        return data;
      }
      await delay(300);
    }
    throw new Error(`No guest acknowledgment for ${name}`);
  }
  try {
    signal.throwIfAborted();
    const addresses = (await utm("ip-address", vm)).stdout
      .trim()
      .split(/\s+/)
      .filter(isIPv4);
    assert.equal(
      addresses.length,
      1,
      "Expected one guest IPv4 address on the private VM network",
    );
    const [guest] = addresses;
    assert(
      bind !== guest &&
        bind.split(".").slice(0, 3).join() ===
          guest.split(".").slice(0, 3).join(),
      "Use the private UTM bridge address on the guest subnet",
    );
    signal.throwIfAborted();
    prepareRequested = true;
    certain = false;
    await control(String.raw`
$console=(Get-CimInstance Win32_ComputerSystem).UserName
if ($console -ne ${quote(user)}) { throw 'Sign in to the configured Windows test account.' }
if (Test-Path -LiteralPath $d) { throw 'Run directory already exists.' }
New-Item -ItemType Directory -Path $d | Out-Null
$acl=Get-Acl -LiteralPath $d
$acl.SetAccessRuleProtection($true,$false)
$sid=([Security.Principal.NTAccount]$console).Translate([Security.Principal.SecurityIdentifier])
foreach ($who in @($sid, [Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($who,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $d -AclObject $acl
New-Item -ItemType Directory -Path (Join-Path $d 'state') | Out-Null
`);
    certain = true;
    const files = new Map([
      ["job.ps1", Buffer.from(windowsJob)],
      ["smoke.ps1", smoke],
    ]);
    if (fixture) files.set("fixture.txt", Buffer.from(fixtureSeconds));
    else files.set("situate-client.exe", artifact.bytes);
    const secret = randomUUID();
    server = createServer((req, res) => {
      const prefix = `/${secret}/`;
      const bytes =
        req.method === "GET" &&
        req.socket.remoteAddress === guest &&
        req.url?.startsWith(prefix) &&
        files.get(req.url.slice(prefix.length));
      if (!bytes) {
        res.writeHead(404).end();
        return;
      }
      res
        .writeHead(200, {
          "Content-Length": bytes.length,
          "Content-Type": "application/octet-stream",
        })
        .end(bytes);
    });
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(0, bind, done);
    });
    for (const [file, bytes] of files) {
      signal.throwIfAborted();
      certain = false;
      await control(String.raw`
$p=Join-Path $d '${file}'
Invoke-WebRequest -UseBasicParsing -Uri 'http://${bind}:${server.address().port}/${secret}/${file}' -TimeoutSec 25 -OutFile $p
if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -ne '${hash(bytes)}') { throw 'Guest file checksum mismatch.' }
`);
      certain = true;
    }
    signal.throwIfAborted();
    certain = false;
    await control(String.raw`
if ((Get-CimInstance Win32_ComputerSystem).UserName -ne ${quote(user)}) { throw 'The interactive account changed.' }
$principal=New-ScheduledTaskPrincipal -UserId ${quote(user)} -LogonType Interactive -RunLevel Limited
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}\job.ps1" -Node "${shell}" -Script "{0}\smoke.ps1" -Seconds ${jobSeconds} -Workspace "{0}" -CancelFile "{0}\state\cancel"' -f $d
$action=New-ScheduledTaskAction -Execute '${shell}' -Argument $arguments
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds ${jobSeconds + 35}) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $t -Principal $principal -Action $action -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $t
`);
    active = true;
    certain = true;
    console.log(`${name}: started`);
  } finally {
    server?.closeAllConnections();
    server?.close();
    if (!certain)
      console.error(`Guest operation unconfirmed; keep lease ${lease}`);
    else if (!active) {
      if (prepareRequested) {
        const result = await control(RemoveRun);
        assert(result.clean, `Guest cleanup not confirmed; keep ${lease}`);
      }
      await release();
    }
  }

  let status;
  let cancelled = false;
  let fixtureStarted = false;
  try {
    const deadline = Date.now() + (jobSeconds + 40) * 1000;
    while (Date.now() < deadline) {
      const cancel = signal.aborted && !cancelled;
      const state = await control(String.raw`
$s=Join-Path $d 'state'
${cancel ? "[IO.File]::WriteAllText((Join-Path $s 'cancel'),'cancel')" : ""}
$receipt=Join-Path $s 'exit-code'
$r.fixtureStarted=Test-Path -LiteralPath (Join-Path $s 'child')
if ((Test-Path -LiteralPath $receipt) -and (Get-ScheduledTask -TaskName $t).State -eq 'Ready') {
    $code=[IO.File]::ReadAllText($receipt)
    if ($code -match '^-?\d+$') { $r.status=[int]$code }
    $failure=Join-Path $s 'failure'
    if (Test-Path -LiteralPath $failure) { $r.failure=[IO.File]::ReadAllText($failure) }
    if ($r.fixtureStarted) {
        $childId=[int][IO.File]::ReadAllText((Join-Path $s 'child'))
        if (Get-Process -Id $childId -ErrorAction SilentlyContinue) { throw 'The fixture child is still running.' }
    }
}
`);
      cancelled ||= cancel;
      if (fixture && state.fixtureStarted && !fixtureStarted) {
        fixtureStarted = true;
        console.log(`${name}: fixture child started`);
      }
      if (Number.isInteger(state.status)) {
        status = state.status;
        if (state.failure) console.error(state.failure);
        break;
      }
      await delay(750);
    }
  } finally {
    if (!Number.isInteger(status))
      console.error(`Guest job drain unconfirmed; keep lease ${lease}`);
    else {
      const result = await control(String.raw`
if ((Get-ScheduledTask -TaskName $t).State -ne 'Ready') { throw 'The guest task is still running.' }
Unregister-ScheduledTask -TaskName $t -Confirm:$false
if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { throw 'The guest task still exists.' }
${RemoveRun}
`);
      assert(result.clean, `Guest cleanup not confirmed; keep ${lease}`);
      await release();
      console.log(`${name}: cleaned`);
    }
  }
  assert(Number.isInteger(status), "The guest did not acknowledge job drain");
  if (cancelled && status === 124) {
    console.log(`${name}: cancelled`);
    return 130;
  }
  if (status === 0 && artifact)
    console.log(`Visible workspace chooser (${artifact.manifest.source})`);
  return status === 0 || status === 124 ? status : 1;
}

const RemoveRun = String.raw`
function Remove-RunTree([string]$p) {
    $item=Get-Item -LiteralPath $p -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point in test run; inspect before cleanup.' }
    if ($item.PSIsContainer) {
        foreach ($child in Get-ChildItem -LiteralPath $p -Force) { Remove-RunTree $child.FullName }
        [IO.Directory]::Delete($p)
    } else { Remove-Item -LiteralPath $p -Force }
}
if (Test-Path -LiteralPath $d) { Remove-RunTree $d }
$r.clean=-not (Test-Path -LiteralPath $d)
`;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  process.on("SIGTERM", () => controller.abort());
  try {
    process.exitCode = await run(process.argv.slice(2), controller.signal);
  } catch (error) {
    console.error(error.message);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  }
}
