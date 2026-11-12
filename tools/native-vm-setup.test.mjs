import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  addKnownHost,
  setupNativeVm,
  setupOptions,
} from "./native-vm-setup.mjs";

const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISyntheticKey";

test("setup accepts a VM name, not shell commands", () => {
  assert.deepEqual(setupOptions([]), { vm: "situate-tests" });
  assert.deepEqual(setupOptions(["--vm", "test-2"]), { vm: "test-2" });
  assert.deepEqual(setupOptions(["--help"]), { help: true });
  for (const args of [
    ["--vm"],
    ["--vm", "--bad"],
    ["--vm", "test; id"],
    ["--other"],
  ])
    assert.throws(() => setupOptions(args), /Usage/);
});

test("known-host bootstrap preserves other entries and refuses changed VM identities", () => {
  const alias = "situate-native-vm-test";
  const original = "another-host ssh-ed25519 AAAA\n";
  const result = addKnownHost(original, alias, `${key} comment`);
  assert.equal(result, `${original}${alias} ${key}\n`);
  assert.equal(addKnownHost(result, alias, key), result);
  assert.throws(
    () => addKnownHost(result, alias, "ssh-ed25519 AAAADifferent"),
    /host key changed/,
  );
  assert.throws(
    () => addKnownHost(original, alias, "not a public key"),
    /Ed25519/,
  );
});

function fixture(t, { failSsh = false, guestUser = "admin" } = {}) {
  const home = mkdtempSync(join(tmpdir(), "situate vm setup-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const calls = [];
  const pins = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url)),
  ).volta;
  const run = (program, args, input) => {
    calls.push({ program, args, input });
    if (program === "ssh-keygen") {
      const file = args.at(-1);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "synthetic private key; never used");
      writeFileSync(`${file}.pub`, key);
    }
    if (program === "tart" && args[0] === "ip") return "192.168.64.3";
    if (program === "tart" && args.at(-1) === "HOME")
      return `/Users/${guestUser}`;
    if (program === "tart" && args.at(-1) === "/usr/bin/whoami")
      return guestUser;
    if (program === "tart" && args.at(-1).includes("/etc/ssh/ssh_host"))
      return key;
    if (program === "/usr/bin/ssh") {
      if (failSsh) throw new Error("SSH verification failed");
      return `v${pins.node}`;
    }
    return "";
  };
  return {
    home,
    run,
    calls,
    config: join(home, ".config/situate/native-test-vm.json"),
  };
}

test("configuration is enabled only after guest toolchain and strict SSH verification", (t) => {
  const f = fixture(t);
  const config = setupNativeVm({ vm: "test" }, f.run, f.home);
  assert.equal(
    JSON.parse(readFileSync(f.config)).node,
    "/Users/admin/.volta/bin/node",
  );
  const ssh = f.calls.find((call) => call.program === "/usr/bin/ssh");
  assert.ok(ssh.args.includes("StrictHostKeyChecking=yes"));
  assert.ok(ssh.args.includes("ForwardAgent=no"));
  assert.ok(ssh.args.includes("HostKeyAlias=situate-native-vm-test"));
  assert.ok(ssh.args.includes(`UserKnownHostsFile="${config.knownHostsFile}"`));
  assert.equal(config.vm, "test");
  const generated = f.calls.filter(
    (call) => call.program === "ssh-keygen",
  ).length;
  setupNativeVm({ vm: "test" }, f.run, f.home);
  assert.equal(
    f.calls.filter((call) => call.program === "ssh-keygen").length,
    generated,
  );
});

test("unsupported guest usernames fail before key or guest configuration changes", (t) => {
  const f = fixture(t, { guestUser: "TestUser" });
  assert.throws(
    () => setupNativeVm({ vm: "test" }, f.run, f.home),
    /Unexpected guest account/,
  );
  assert.equal(f.calls.length, 2);
  assert.equal(existsSync(f.config), false);
});

test("setup rejects linked configuration files before modifying them", (t) => {
  const f = fixture(t);
  mkdirSync(dirname(f.config), { recursive: true });
  const unrelated = join(f.home, "unrelated.json");
  writeFileSync(unrelated, "preserve this file");
  symlinkSync(unrelated, f.config);
  assert.throws(
    () => setupNativeVm({ vm: "test" }, f.run, f.home),
    /owned ordinary/,
  );
  assert.equal(readFileSync(unrelated, "utf8"), "preserve this file");
  assert.equal(f.calls.length, 0);
});

test("failed SSH does not enable routing or replace a different configuration", (t) => {
  const f = fixture(t, { failSsh: true });
  assert.throws(
    () => setupNativeVm({ vm: "test" }, f.run, f.home),
    /SSH verification failed/,
  );
  assert.equal(existsSync(f.config), false);
  writeFileSync(f.config, JSON.stringify({ version: 1, vm: "another" }));
  assert.throws(
    () => setupNativeVm({ vm: "test" }, f.run, f.home),
    /configuration differs/,
  );
  assert.deepEqual(JSON.parse(readFileSync(f.config)), {
    version: 1,
    vm: "another",
  });
});
