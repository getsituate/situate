import { spawnSync } from "node:child_process";

export function nativeDesktopIssue({
  platform = process.platform,
  probe = spawnSync,
} = {}) {
  if (platform !== "darwin") return null;
  const result = probe("/usr/sbin/ioreg", ["-l", "-n", "Root", "-d", "1"], {
    encoding: "utf8",
    env: {},
    timeout: 2000,
    maxBuffer: 262144,
  });
  if (result.error || result.status !== 0) return "desktop-session-unavailable";
  const locked = result.stdout.match(
    /^\s*"IOConsoleLocked"\s*=\s*(Yes|No)\s*$/m,
  )?.[1];
  if (!locked) return "desktop-session-unavailable";
  return locked === "Yes" ? "desktop-session-locked" : null;
}

export function requireNativeDesktop(desktopIssue = nativeDesktopIssue) {
  const issue = desktopIssue();
  if (issue)
    throw new Error(
      `Native tests blocked: ${issue}. An unlocked macOS desktop is required.`,
    );
}
