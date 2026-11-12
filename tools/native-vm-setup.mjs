import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  chmodSync,
  lstatSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function setupOptions(args) {
  if (args.length === 0) return { vm: "situate-tests" };
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if (
    args.length === 2 &&
    args[0] === "--vm" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(args[1])
  )
    return { vm: args[1] };
  throw new Error("Usage: node tools/native-vm-setup.mjs [--vm NAME]");
}

export function addKnownHost(existing, alias, publicKey) {
  const key = publicKey.trim().split(/\s+/).slice(0, 2).join(" ");
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+$/.test(key))
    throw new Error("The guest did not supply an Ed25519 SSH host key.");
  const matching = existing
    .split("\n")
    .filter((line) => line.split(/\s+/)[0] === alias);
  if (matching.some((line) => line.trim() !== `${alias} ${key}`))
    throw new Error(
      "The VM host key changed. Verify the guest before replacing its known-host entry.",
    );
  return matching.length
    ? existing
    : `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${alias} ${key}\n`;
}

function command(program, args, input) {
  const result = spawnSync(program, args, {
    input,
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      HOME: homedir(),
      PATH: process.env.PATH,
      LANG: "en_US.UTF-8",
      HOMEBREW_NO_AUTO_UPDATE: "1",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${program} failed (${result.status ?? result.signal}): ${result.stderr}`,
    );
  return result.stdout.trim();
}

function existingOwnedPath(path, directory = false) {
  let info;
  try {
    info = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) ||
    (process.getuid && info.uid !== process.getuid()) ||
    (directory && (info.mode & 0o022) !== 0)
  )
    throw new Error(
      "Native VM setup paths must be owned ordinary files or directories.",
    );
}

export function setupNativeVm({ vm }, run = command, hostHome = homedir()) {
  const root = join(hostHome, ".config/situate");
  existingOwnedPath(root, true);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const identityFile = join(root, `${vm}.ed25519`);
  const knownHostsFile = join(root, `${vm}.known-hosts`);
  const configPath = join(root, "native-test-vm.json");
  for (const path of [
    identityFile,
    `${identityFile}.pub`,
    knownHostsFile,
    configPath,
  ])
    existingOwnedPath(path);
  const guest = (args, input) =>
    run(
      "tart",
      ["exec", ...(input === undefined ? [] : ["-i"]), vm, ...args],
      input,
    );
  const home = guest(["/usr/bin/printenv", "HOME"]);
  const user = guest(["/usr/bin/whoami"]);
  if (!/^[a-z_][a-z0-9_-]*$/.test(user) || home !== `/Users/${user}`)
    throw new Error(
      "Unexpected guest account. Use a dedicated macOS test account.",
    );
  const config = {
    version: 1,
    vm,
    user,
    identityFile,
    knownHostsFile,
    node: `${home}/.volta/bin/node`,
  };
  if (
    existsSync(configPath) &&
    JSON.stringify(JSON.parse(readFileSync(configPath, "utf8"))) !==
      JSON.stringify(config)
  )
    throw new Error(
      "An existing native VM configuration differs. Review it before configuring another VM.",
    );
  if (!existsSync(identityFile))
    run("ssh-keygen", [
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      "situate-native-tests",
      "-f",
      identityFile,
    ]);
  chmodSync(identityFile, 0o600);
  const publicKey = readFileSync(`${identityFile}.pub`, "utf8");
  guest(
    [
      "/usr/bin/python3",
      "-c",
      `import os,pathlib,sys
key=sys.stdin.read().strip()
if not key.startswith('ssh-ed25519 ') or '\\n' in key: raise RuntimeError('Invalid public key')
root=pathlib.Path.home()/'.ssh'
root.mkdir(mode=0o700,exist_ok=True)
if root.is_symlink(): raise RuntimeError('Unsafe SSH directory')
path=root/'authorized_keys'
if path.is_symlink(): raise RuntimeError('Unsafe authorized_keys')
existing=path.read_text() if path.exists() else ''
if key not in existing.splitlines():
    with open(path,'a') as target: target.write(('\\n' if existing and not existing.endswith('\\n') else '')+key+'\\n')
os.chmod(root,0o700)
os.chmod(path,0o600)
`,
    ],
    publicKey,
  );
  const hostKey = guest([
    "/usr/bin/python3",
    "-c",
    "from pathlib import Path; print(Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text())",
  ]);
  const hosts = addKnownHost(
    existsSync(knownHostsFile) ? readFileSync(knownHostsFile, "utf8") : "",
    `situate-native-vm-${vm}`,
    hostKey,
  );
  writeFileSync(knownHostsFile, hosts, { mode: 0o600 });
  chmodSync(knownHostsFile, 0o600);
  const pins = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../package.json", import.meta.url)),
      "utf8",
    ),
  ).volta;
  for (const value of [pins.node, pins.npm])
    if (!/^\d+\.\d+\.\d+$/.test(value))
      throw new Error("Invalid repository toolchain pin.");
  console.log("Preparing the guest Node.js toolchain…");
  guest(
    ["/bin/bash", "-s"],
    `set -euo pipefail
export HOMEBREW_NO_AUTO_UPDATE=1
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if ! /opt/homebrew/bin/brew list --versions volta >/dev/null 2>&1; then
  /opt/homebrew/bin/brew install volta
fi
/opt/homebrew/bin/volta setup
/opt/homebrew/bin/volta install node@${pins.node} npm@${pins.npm}
test "$(node --version)" = 'v${pins.node}'
test "$(npm --version)" = '${pins.npm}'
/usr/bin/defaults -currentHost write com.apple.screensaver idleTime -int 0
sudo -n /usr/bin/pmset -a displaysleep 0 sleep 0
/usr/sbin/ioreg -l -n Root -d 1 | /usr/bin/grep '"IOConsoleLocked" = No' >/dev/null
`,
  );
  const ip = run("tart", ["ip", vm]);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
    throw new Error("Could not determine the VM IPv4 address.");
  const version = run("/usr/bin/ssh", [
    "-F",
    "/dev/null",
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "ForwardAgent=no",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile="${knownHostsFile.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
    "-o",
    `HostKeyAlias=situate-native-vm-${vm}`,
    "-i",
    identityFile,
    `${user}@${ip}`,
    config.node,
    "--version",
  ]);
  if (version !== `v${pins.node}`)
    throw new Error("The guest Node.js version does not match the repository.");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(configPath, 0o600);
  console.log(`Native test VM configured: ${vm}\nConfiguration: ${configPath}`);
  return config;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const options = setupOptions(process.argv.slice(2));
    if (options.help)
      console.log(
        "Usage: node tools/native-vm-setup.mjs [--vm NAME]\nRequires a running Tart macOS guest with the Tart Guest Agent and Homebrew. Installs the repository-pinned Node.js/npm through Volta in the guest and enables VM execution for this account's native tests.",
      );
    else setupNativeVm(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
