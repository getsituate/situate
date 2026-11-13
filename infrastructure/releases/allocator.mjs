import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { sshArguments } from "./transport.mjs";

export function allocatorProgram() {
  return `${readFileSync(new URL("./remote.py", import.meta.url), "utf8").replace("if __name__ == '__main__':", "if False:")}\n${readFileSync(new URL("./allocator.py", import.meta.url), "utf8")}\nallocator_main()\n`;
}

/** start() must open one verified host connection running allocatorProgram().
 * A lost connection invalidates the lease; it does not erase durable intent.
 */
export function createAllocatorLock({ start, timeoutMs = 30000 }) {
  return async (operation) => {
    const child = start();
    const lines = createInterface({ input: child.stdout })[
      Symbol.asyncIterator
    ]();
    let alive = true;
    const closed = new Promise((resolve) => {
      child.once("error", () => {
        alive = false;
        resolve(-1);
      });
      child.once("close", (code) => {
        alive = false;
        resolve(code);
      });
    });
    child.stdin.on("error", () => {
      alive = false;
    });
    // Neither host stderr nor ambient credentials belong in workflow results.
    child.stderr?.resume();
    const receive = async () => {
      let timer;
      try {
        return await Promise.race([
          lines.next().then(({ value, done }) => {
            assert(
              !done && alive,
              "Allocator connection lost; inspect durable intent",
            );
            return JSON.parse(value);
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Allocator response timed out; inspect durable intent",
                  ),
                ),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const exchange = async (request) => {
      assert(alive, "Allocator lease is no longer held");
      child.stdin.write(`${JSON.stringify(request)}\n`);
      return receive();
    };
    try {
      assert(
        (await receive()).ready === true,
        "Allocator did not acquire the host lock",
      );
      return await operation({
        pending: async () => (await exchange({ action: "pending" })).pending,
        inventory: () => exchange({ action: "inventory" }),
        saveIntent: async (value) =>
          assert((await exchange({ action: "save", value })).saved === true),
        clearIntent: async (value) =>
          assert((await exchange({ action: "clear", value })).cleared === true),
        assertHeld: async () =>
          assert((await exchange({ action: "assert-held" })).held === true),
        journal: (action, value) => exchange({ action, ...value }),
      });
    } finally {
      child.stdin.end();
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export function createHostAllocatorLock(
  config,
  { environment = process.env } = {},
) {
  const code = Buffer.from(allocatorProgram()).toString("base64");
  const command = `python3 -u -c 'import base64;exec(base64.b64decode("${code}"))'`;
  const args = [...sshArguments(config), command];
  const env = Object.fromEntries(
    ["PATH", "HOME", "SSH_AUTH_SOCK", "LANG"]
      .filter((name) => Object.hasOwn(environment, name))
      .map((name) => [name, environment[name]]),
  );
  return createAllocatorLock({
    start: () => spawn("ssh", args, { env, stdio: ["pipe", "pipe", "pipe"] }),
  });
}

export function createHostNotaryJournal(
  config,
  { operationId, withAllocatorLock = createHostAllocatorLock(config) } = {},
) {
  assert(
    typeof operationId === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(operationId),
    "Invalid notary operation ID",
  );
  const append = (entry, complete) =>
    withAllocatorLock(async (lease) => {
      assert(
        entry && typeof entry === "object" && !Array.isArray(entry),
        "Invalid notary journal entry",
      );
      return lease.journal("journal-append", {
        operationId,
        entry: complete ? { ...entry, phase: "completion" } : entry,
      });
    });
  return {
    operationId,
    persist: (entry) => append(entry, false),
    complete: (entry) => append(entry, true),
    inspect: () =>
      withAllocatorLock((lease) =>
        lease.journal("journal-inspect", { operationId }),
      ),
  };
}

/** Each payload has a durable child operation; builder acknowledgements retain
 * the parent operation ID. Inspection reads the whole family from host storage.
 */
export function createBuilderNotaryJournal(
  config,
  { operationId, withAllocatorLock = createHostAllocatorLock(config) } = {},
) {
  assert(
    typeof operationId === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,94}$/u.test(operationId),
    "Invalid builder notary operation ID",
  );
  const outcomes = {
    Accepted: "success",
    Invalid: "failed",
    Rejected: "failed",
    "In Progress": "unknown",
    unknown: "unknown",
  };
  const append = async (entry, complete) => {
    assert(
      entry?.operationId === operationId,
      "Builder notary operation differs",
    );
    assert(
      typeof entry.file === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(entry.file),
      "Invalid notary payload name",
    );
    assert(
      /^[a-f0-9]{64}$/u.test(entry.sha256 ?? ""),
      "Invalid notary payload digest",
    );
    const outcome = Object.hasOwn(outcomes, entry.status)
      ? outcomes[entry.status]
      : undefined;
    assert(
      outcome ||
        (!complete && ["submitting", "submitted"].includes(entry.status)),
      "Invalid builder notary status",
    );
    if (
      entry.status === "submitted" ||
      entry.status === "Accepted" ||
      entry.status === "Invalid" ||
      entry.status === "Rejected" ||
      entry.id !== undefined
    ) {
      assert(
        typeof entry.id === "string" &&
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(entry.id),
        "Invalid notary submission ID",
      );
    }
    const childId = `${operationId}-${entry.sha256.slice(0, 32)}`;
    const journal = createHostNotaryJournal(config, {
      operationId: childId,
      withAllocatorLock,
    });
    const record = {
      parentOperationId: operationId,
      file: entry.file,
      sha256: entry.sha256,
      status: entry.status,
      ...(entry.id ? { submissionId: entry.id } : {}),
      ...(outcome
        ? { phase: "completion", outcome }
        : { phase: entry.status === "submitting" ? "intent" : "submission" }),
    };
    const result = outcome
      ? await journal.complete(record)
      : await journal.persist(record);
    assert(
      result?.durable === true && result.operationId === childId,
      "Notary child journal did not acknowledge this payload",
    );
    return { durable: true, operationId };
  };
  return {
    operationId,
    persist: (entry) => append(entry, false),
    complete: (entry) => append(entry, true),
    inspect: () =>
      withAllocatorLock((lease) =>
        lease.journal("journal-inspect-family", { operationId }),
      ),
  };
}

/** The durable claim spans workflow stages, not an SSH process lifetime.
 * Reopening an existing claim requires inspection and explicit resume.
 */
export function createHostReleaseCoordinator(
  config,
  {
    operationId,
    planDigest,
    sourceRevision,
    withAllocatorLock = createHostAllocatorLock(config),
  } = {},
) {
  assert(
    typeof operationId === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(operationId),
    "Invalid release operation ID",
  );
  assert(
    /^[a-f0-9]{64}$/u.test(planDigest ?? "") &&
      /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(sourceRevision ?? ""),
    "Invalid release operation binding",
  );
  const identity = { operationId, planDigest, sourceRevision };
  let inspectionDigest;
  const invoke = (action, extra = {}) =>
    withAllocatorLock((lease) =>
      lease.journal(action, { ...identity, ...extra }),
    );
  return {
    operationId,
    claim: async ({ resume = false } = {}) => {
      if (resume)
        assert(
          inspectionDigest,
          "Release resumption requires inspection first",
        );
      const snapshot = inspectionDigest;
      inspectionDigest = undefined;
      return invoke(
        "release-claim",
        resume ? { inspectionDigest: snapshot } : {},
      );
    },
    complete: () => invoke("release-complete"),
    inspect: async () => {
      const result = await invoke("release-inspect");
      inspectionDigest = result.inspectionDigest;
      return result;
    },
  };
}
