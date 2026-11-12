import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeDesktopIssue,
  requireNativeDesktop,
} from "./native-desktop-session.mjs";

test("non-macOS native tests do not query the macOS desktop", () => {
  for (const platform of ["linux", "win32"])
    assert.equal(
      nativeDesktopIssue({
        platform,
        probe: () => {
          throw new Error("unexpected platform probe");
        },
      }),
      null,
    );
});

test("an unlocked macOS desktop permits native tests without forwarding environment secrets", () => {
  assert.equal(
    nativeDesktopIssue({
      platform: "darwin",
      probe: (command, args, options) => {
        assert.equal(command, "/usr/sbin/ioreg");
        assert.deepEqual(args, ["-l", "-n", "Root", "-d", "1"]);
        assert.deepEqual(options.env, {});
        assert.equal(options.timeout, 2000);
        return { status: 0, stdout: '  "IOConsoleLocked" = No\n' };
      },
    }),
    null,
  );
});

test("a locked desktop blocks native tests without returning registry contents", () => {
  const issue = nativeDesktopIssue({
    platform: "darwin",
    probe: () => ({
      status: 0,
      stdout:
        '  "IOConsoleLocked" = Yes\n  "PrivateValue" = "synthetic-private-value"\n',
    }),
  });
  assert.equal(issue, "desktop-session-locked");
  assert.throws(() => requireNativeDesktop(() => issue), {
    message:
      "Native tests blocked: desktop-session-locked. An unlocked macOS desktop is required.",
  });
});

test("failed, timed-out, or unrecognized desktop probes block rather than assume readiness", () => {
  for (const result of [
    { status: 1, stdout: '"IOConsoleLocked" = No' },
    { status: null, error: new Error("synthetic probe timeout") },
    { status: 0, stdout: "" },
    { status: 0, stdout: '"IOConsoleLocked" = Unknown' },
  ])
    assert.equal(
      nativeDesktopIssue({ platform: "darwin", probe: () => result }),
      "desktop-session-unavailable",
    );
});
