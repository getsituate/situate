import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { observeUpdater } from "./qualification-updater-observation.mjs";

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "situate-update-log-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const identifier = "com.example.app";
  const folder = join(home, "Library", "Logs", identifier, "diagnostics");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const segment = join(folder, "segment-00000000000000000001.jsonl");
  const account = {
    home,
    identifier,
    uid: process.getuid(),
    version: "0.1.6",
    since: 10,
  };
  return { account, segment, folder };
}

test("selects only current predecessor native updater stages and approved error codes", (t) => {
  const { account, segment } = fixture(t);
  const event = {
    origin: "native",
    app_version: "0.1.6",
    event: "update.progress",
    timestamp_ms: 10,
    attributes: { stage: "prepare_window", error_code: "files_pending" },
  };
  const entries = [
    { ...event, timestamp_ms: 9 },
    { ...event, app_version: "2026.11.7" },
    { ...event, origin: "renderer" },
    { ...event, event: "app.started" },
    { ...event, attributes: { stage: "private" } },
    {
      ...event,
      attributes: {
        stage: "check_finished",
        error_code: "http",
        detail: "private path",
      },
    },
    { ...event, attributes: { stage: "download_finished" } },
    event,
    {
      ...event,
      attributes: { stage: "install_replace", error_code: "private data" },
    },
    { ...event, attributes: { stage: "install_finished" } },
  ];
  writeFileSync(
    segment,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + '\n{"partial":',
  );
  assert.deepEqual(observeUpdater(account), [
    "check_finished:http",
    "download_finished",
    "prepare_window:files_pending",
    "install_replace:unknown",
    "install_finished",
  ]);
});

test("does not read linked or oversized diagnostics", (t) => {
  const { account, segment, folder } = fixture(t);
  symlinkSync(join(folder, "outside"), segment);
  assert.deepEqual(observeUpdater(account), []);
  rmSync(segment);
  writeFileSync(segment, Buffer.alloc(4 * 1024 * 1024 + 1));
  assert.deepEqual(observeUpdater(account), []);
});
