import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";

const installed = new WeakSet();

export function applePosixFixture(t, host = process.platform) {
  if (host !== "win32" || installed.has(t)) return;
  installed.add(t);
  const original = { ...fs };
  const modes = new Map();
  const links = new Map();
  const uid = 1000;
  const getuid = Object.getOwnPropertyDescriptor(process, "getuid");
  Object.defineProperty(process, "getuid", {
    configurable: true,
    value: () => uid,
  });
  const identity = (stat) => `${stat.dev}:${stat.ino}`;
  const metadata = (method, path, options) => {
    const stat = original[method](path, options);
    if (stat === undefined) return undefined;
    const exact =
      typeof stat.ino === "bigint"
        ? stat
        : original[method](path, { bigint: true });
    const mode = modes.get(identity(exact));
    if (typeof stat.mode === "bigint") {
      if (mode !== undefined)
        stat.mode = (stat.mode & ~0o7777n) | (BigInt(mode) & 0o7777n);
      stat.uid = BigInt(uid);
    } else {
      if (mode !== undefined)
        stat.mode = (stat.mode & ~0o7777) | (mode & 0o7777);
      stat.uid = uid;
    }
    return stat;
  };
  t.mock.method(fs, "writeFileSync", (path, data, options) => {
    const existed = typeof path === "number" || original.existsSync(path);
    original.writeFileSync(path, data, options);
    if (!existed)
      modes.set(
        identity(original.statSync(path, { bigint: true })),
        options?.mode ?? 0o666,
      );
  });
  t.mock.method(fs, "chmodSync", (path, mode) => {
    original.chmodSync(path, mode);
    modes.set(identity(original.statSync(path, { bigint: true })), mode);
  });
  t.mock.method(fs, "lstatSync", (path, options) =>
    metadata("lstatSync", path, options),
  );
  t.mock.method(fs, "fstatSync", (handle, options) =>
    metadata("fstatSync", handle, options),
  );
  t.mock.method(fs, "symlinkSync", (target, path, ...args) => {
    if (target !== "/usr/bin/rsync" && target !== "/Applications")
      return original.symlinkSync(target, path, ...args);
    original.writeFileSync(path, "", { flag: "wx" });
    links.set(resolve(path), target);
  });
  t.mock.method(
    fs,
    "readlinkSync",
    (path, ...args) =>
      links.get(resolve(path)) ?? original.readlinkSync(path, ...args),
  );
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (getuid) Object.defineProperty(process, "getuid", getuid);
    else delete process.getuid;
  });
}
