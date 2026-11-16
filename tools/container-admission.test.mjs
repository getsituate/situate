import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { withHostBuildAdmission } from "./container-admission.mjs";

async function until(predicate) {
  const deadline = performance.now() + 3000;
  while (!predicate()) {
    assert(performance.now() < deadline, "Protocol did not advance");
    await delay(5);
  }
}

test("queued cancellation waits for withdrawal acknowledgement even when a grant arrives late", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-phase-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const environment = { SITUATE_TOOL_CONTAINER: "1", SITUATE_HOST_ADMISSION: root };
  const controller = new AbortController();
  let started = false;
  const first = withHostBuildAdmission(() => { started = true; }, { environment, signal: controller.signal });
  const rejection = assert.rejects(first, { name: "AbortError" });
  const request = join(root, "request.json");
  const grant = join(root, "grant.json");
  const release = join(root, "release.json");
  const released = join(root, "released.json");
  await until(() => existsSync(request));
  const token = JSON.parse(readFileSync(request, "utf8"));
  controller.abort();
  await until(() => existsSync(release));
  let secondStarted = false;
  const second = withHostBuildAdmission(() => { secondStarted = true; }, { environment });
  // The host completed validation before seeing withdrawal.
  writeFileSync(grant, JSON.stringify(token), { mode: 0o600 });
  await delay(50);
  assert.deepEqual(JSON.parse(readFileSync(request, "utf8")), token);
  assert.equal(started, false);
  assert.equal(secondStarted, false);
  assert(existsSync(join(root, "phase")));
  unlinkSync(grant);
  writeFileSync(released, JSON.stringify(token), { mode: 0o600 });
  await rejection;
  await until(() => existsSync(request) && JSON.parse(readFileSync(request, "utf8")).token !== token.token);
  const next = JSON.parse(readFileSync(request, "utf8"));
  writeFileSync(grant, JSON.stringify(token), { mode: 0o600 });
  await delay(50);
  assert.equal(secondStarted, false);
  writeFileSync(grant, JSON.stringify(next));
  await until(() => existsSync(release));
  assert.equal(secondStarted, true);
  unlinkSync(grant);
  writeFileSync(released, JSON.stringify(next), { mode: 0o600 });
  await second;
  assert(!existsSync(join(root, "phase")));
});

test("admitted work can nest without a second request and timing cannot release it early", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-phase-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const environment = { SITUATE_TOOL_CONTAINER: "1", SITUATE_HOST_ADMISSION: root };
  const timings = [];
  const running = withHostBuildAdmission(async (admitted) => {
    assert.equal(admitted.SITUATE_HOST_ADMITTED, "1");
    assert.equal(await withHostBuildAdmission(() => 7, { environment: admitted }), 7);
    assert(!existsSync(join(root, "release.json")));
    return 42;
  }, { environment, onTiming(event) { timings.push(event); throw new Error("telemetry"); } });
  const token = JSON.parse(readFileSync(join(root, "request.json"), "utf8"));
  writeFileSync(join(root, "grant.json"), JSON.stringify(token), { mode: 0o600 });
  await until(() => existsSync(join(root, "release.json")));
  unlinkSync(join(root, "grant.json"));
  writeFileSync(join(root, "released.json"), JSON.stringify(token), { mode: 0o600 });
  assert.equal(await running, 42);
  assert.deepEqual(timings.map(({ phase }) => phase), ["acquired", "released"]);
});
