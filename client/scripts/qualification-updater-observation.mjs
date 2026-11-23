import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";

const stages = new Set([
  "setup",
  "check_started",
  "check_finished",
  "download_started",
  "download_finished",
  "cache_restore_started",
  "cache_restore_finished",
  "cache_pending_restore",
  "cache_verify",
  "install_requested",
  "prepare_started",
  "prepare_actions",
  "prepare_windows",
  "prepare_window",
  "prepare_finished",
  "install_validate",
  "install_replace",
  "install_started",
  "install_finished",
  "install_restart",
  "recovery",
]);
const errors = new Set([
  "busy",
  "bundle_changed",
  "bundle_io",
  "cache",
  "cancelled",
  "changed",
  "configuration",
  "connect",
  "conversation_save",
  "dictation_active",
  "files_pending",
  "http",
  "install",
  "invalid_response",
  "internal",
  "interrupted",
  "network",
  "panic",
  "preparation",
  "relaunch",
  "signature",
  "timeout",
  "window_error",
  "window_missing",
  "window_rejected",
]);

export function isUpdaterObservation(code) {
  if (
    [
      "bundle_predecessor",
      "bundle_candidate",
      "bundle_unverified",
      "updater_unavailable",
    ].includes(code)
  )
    return true;
  const [stage, error, extra] = code.split(":");
  return (
    extra === undefined &&
    stages.has(stage) &&
    (error === undefined || error === "unknown" || errors.has(error))
  );
}

export function observeUpdater({ home, uid, identifier, version, since }) {
  try {
    if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(identifier)) return [];
    let directory = realpathSync(home);
    for (const name of ["Library", "Logs", identifier, "diagnostics"]) {
      directory = join(directory, name);
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.uid !== uid) return [];
    }
    const names = [];
    const entries = opendirSync(directory);
    try {
      for (let count = 0; ; count++) {
        const entry = entries.readSync();
        if (!entry) break;
        if (count >= 66) return [];
        if (/^segment-\d{20}\.jsonl$/.test(entry.name)) names.push(entry.name);
      }
    } finally {
      entries.closeSync();
    }

    const events = [];
    for (const name of names
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(-2)) {
      const fd = openSync(
        join(directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let bytes;
      try {
        const stat = fstatSync(fd);
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.uid !== uid ||
          stat.size > 4 * 1024 * 1024
        )
          return [];
        bytes = Buffer.alloc(stat.size);
        const size = readSync(fd, bytes, 0, bytes.length, 0);
        if (size !== bytes.length) return [];
      } finally {
        closeSync(fd);
      }
      const lines = bytes.toString("utf8").split("\n");
      // The collector can still be writing the final record.
      lines.pop();
      for (const line of lines) {
        if (line.length > 32_768) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        const { stage, error_code: error } = entry?.attributes ?? {};
        if (
          entry?.event !== "update.progress" ||
          entry.origin !== "native" ||
          entry.app_version !== version ||
          !Number.isSafeInteger(entry.timestamp_ms) ||
          entry.timestamp_ms < since ||
          !stages.has(stage)
        )
          continue;
        events.push(
          error === undefined
            ? stage
            : `${stage}:${errors.has(error) ? error : "unknown"}`,
        );
      }
    }
    return events.slice(-24);
  } catch {
    return [];
  }
}
