import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { restoredRuntimeFixture } from "./release-checkpoint-fixtures.mjs";
import { prepareRestoredQualificationRuntime } from "./release-runtime-recovery.mjs";
import { validateQualificationRuntimeAuthorization } from "./release-runtime-authorization.mjs";

function fixture(t) {
  const f = restoredRuntimeFixture(t);
  const calls = [];
  const nonce = "qualification-fresh";
  const environment = {
    WEBSITE_SSH_IDENTITY: "/synthetic/identity",
    WEBSITE_SSH_KNOWN_HOSTS: "/synthetic/known-hosts",
  };
  const host = {
    inspectFamily: async (input) => {
      calls.push(["family", input]);
      return { operations: [] };
    },
    prepare: async (input) => {
      calls.push(["prepare", input]);
      return {
        ...f.runtime.qualificationResources.facts,
        operationId: f.plan.operation,
        operationNonce: nonce,
      };
    },
    cleanup: async (input) => calls.push(["cleanup", input]),
  };
  const input = {
    ...f,
    environment,
    adapters: {
      platform: "darwin",
      account: { uid: 501, username: "runner", homedir: "/Users/runner" },
      captureDeviceState: (input) => {
        calls.push(["namespace", input]);
      },
      inspection: { inspect: async () => f.inspection.remote },
      routeNonce: () => nonce,
      createHost: () => host,
      prepareRuntime: async (root, record, options) => {
        assert.equal(root, f.root);
        assert.equal(record.configuration.qualificationResources, undefined);
        assert.equal(options.operation, nonce);
        const predecessor = join(
          f.root,
          ".release-operations",
          nonce,
          "predecessor",
        );
        assert.equal(
          readFileSync(join(predecessor, "Situate.dmg"), "utf8"),
          "dmg",
        );
        const controller = options.createHost({
          publicFeedSha256:
            f.configuration.qualificationResources.publicFeedSha256,
        });
        const facts = await controller.prepare({
          operationId: nonce,
          operationNonce: nonce,
        });
        return {
          configuration: {
            qualification: {
              ...f.runtime.qualification,
              predecessor: {
                ...f.runtime.qualification.predecessor,
                directory: predecessor,
              },
              account: {
                mode: "ephemeral-host",
                uid: 501,
                name: "runner",
                home: "/Users/runner",
              },
            },
            qualificationResources: { facts },
          },
        };
      },
    },
  };
  return { f, input, calls, host, nonce };
}

test("fresh runtime preparation retains original bytes, predecessor and reserved operation identity", async (t) => {
  const { f, input, calls, nonce } = fixture(t);
  const before = readFileSync(join(f.directory, "configuration.json"));
  const result = await prepareRestoredQualificationRuntime(f.root, input);
  assert.equal(result.runtimeAuthorization.routeNonce, nonce);
  assert.equal(
    result.qualificationRuntime.qualification.routing.operationId,
    f.plan.operation,
  );
  assert.deepEqual(
    result.qualificationRuntime.qualification.account,
    f.configuration.qualification.account,
  );
  assert.deepEqual(calls.find(([name]) => name === "prepare")[1], {
    operationId: f.plan.operation,
    operationNonce: nonce,
  });
  assert.deepEqual(
    validateQualificationRuntimeAuthorization(result.runtimeAuthorization, {
      ...input,
      configuration: f.configuration,
      configurationBytes: before,
    }),
    result.qualificationRuntime,
  );
  assert.deepEqual(
    readFileSync(join(f.directory, "configuration.json")),
    before,
  );
  assert.equal(
    calls.some(([name]) => name === "cleanup"),
    false,
  );
});

test("cleaned host-family members use optional-false uncertainty while active ownership stays blocking", async (t) => {
  const f = fixture(t);
  f.host.inspectFamily = async () => ({
    operations: [
      {
        operationId: f.f.plan.operation,
        operationNonce: "prior",
        status: "cleaned-retained",
        containerRunning: false,
      },
    ],
  });
  assert.equal(
    (await prepareRestoredQualificationRuntime(f.f.root, f.input))
      .runtimeAuthorization.routeNonce,
    f.nonce,
  );
  for (const member of [
    { status: "cleaned-retained", uncertain: true, containerRunning: false },
    { status: "serving", containerRunning: true },
    { status: "cleaned", containerRunning: true },
    { status: "cleaned" },
  ]) {
    const other = fixture(t);
    other.host.inspectFamily = async () => ({
      operations: [
        {
          operationId: other.f.plan.operation,
          operationNonce: "prior",
          ...member,
        },
      ],
    });
    await assert.rejects(
      prepareRestoredQualificationRuntime(other.f.root, other.input),
    );
    assert.equal(
      other.calls.some(([name]) => name === "prepare"),
      false,
    );
  }
});

test("unknown prior ownership and changed remote state block new preparation", async (t) => {
  const { f, input, host, calls } = fixture(t);
  host.inspectFamily = async () => ({
    operations: [
      {
        operationId: f.plan.operation,
        operationNonce: "prior",
        status: "prepare-pending",
        uncertain: true,
        containerRunning: false,
      },
    ],
  });
  await assert.rejects(
    prepareRestoredQualificationRuntime(f.root, input),
    (error) => /Prior qualification ownership/.test(error.cause.message),
  );
  assert.equal(
    calls.some(([name]) => name === "prepare"),
    false,
  );
  const other = fixture(t);
  other.input.adapters.inspection.inspect = async () => ({ changed: true });
  await assert.rejects(
    prepareRestoredQualificationRuntime(other.f.root, other.input),
    (error) => /External state changed/.test(error.cause.message),
  );
  assert.equal(
    other.calls.some(([name]) => name === "prepare"),
    false,
  );
});

test("post-preparation rejection cleans only the acknowledged fresh owner and retains both failures", async (t) => {
  const { f, input, calls, host, nonce } = fixture(t);
  host.prepare = async () => ({
    ...f.runtime.qualificationResources.facts,
    operationNonce: nonce,
    operationId: f.plan.operation,
    identitySha256: f.configuration.qualification.routing.identitySha256,
  });
  await assert.rejects(prepareRestoredQualificationRuntime(f.root, input));
  assert.deepEqual(calls.find(([name]) => name === "cleanup")[1], {
    operationId: f.plan.operation,
    operationNonce: nonce,
    retainArtifacts: true,
  });
  const other = fixture(t);
  other.host.prepare = async () => {
    const error = new Error("Synthetic unknown prepare");
    error.uncertain = true;
    throw error;
  };
  await assert.rejects(
    prepareRestoredQualificationRuntime(other.f.root, other.input),
    (error) => error.uncertain === true,
  );
  assert.equal(
    other.calls.some(([name]) => name === "cleanup"),
    false,
  );
});

test("personal accounts and replayed hosted attempts fail before namespace or route preparation", async (t) => {
  const { f, input, calls } = fixture(t);
  input.adapters.account.username = "personal";
  await assert.rejects(prepareRestoredQualificationRuntime(f.root, input));
  assert.equal(calls.length, 0);
  const other = fixture(t);
  Object.assign(other.input.environment, {
    CI: "true",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "self-hosted",
  });
  await assert.rejects(
    prepareRestoredQualificationRuntime(other.f.root, other.input),
  );
  assert.equal(other.calls.length, 0);
});
