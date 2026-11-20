import assert from "node:assert/strict";
import { isAbsolute, normalize } from "node:path";
import { checkpointPackages } from "./release-checkpoint.mjs";
import { digest, validatePlan } from "./pipeline-state.mjs";

const exactKeys = (value, keys, message) =>
  assert.deepEqual(
    Object.keys(value ?? {}).sort(),
    keys.slice().sort(),
    message,
  );
const ownedPath = (value) =>
  assert(
    typeof value === "string" &&
      isAbsolute(value) &&
      normalize(value) === value &&
      value !== "/",
    "Runtime requires an explicit normalized owned path",
  );
function validateRuntime(configuration, runtime, operation) {
  exactKeys(
    runtime,
    ["qualification", "qualificationResources"],
    "Only qualification runtime fields may change",
  );
  const original = configuration.qualification;
  const next = runtime.qualification;
  exactKeys(next, Object.keys(original), "Qualification fields differ");
  const runtimeFields = new Set([
    "account",
    "runnerImage",
    "predecessor",
    "routing",
  ]);
  for (const key of Object.keys(original))
    if (!runtimeFields.has(key))
      assert.deepEqual(
        next[key],
        original[key],
        `Qualification field changed: ${key}`,
      );
  exactKeys(next.account, ["mode", "uid", "name", "home"]);
  assert.equal(original.account.mode, "ephemeral-host");
  assert.equal(next.account.mode, "ephemeral-host");
  assert(
    Number.isSafeInteger(next.account.uid) &&
      next.account.uid > 500 &&
      /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(next.account.name),
    "Invalid disposable account identity",
  );
  ownedPath(next.account.home);
  assert(
    typeof next.runnerImage === "string" &&
      next.runnerImage.length > 0 &&
      next.runnerImage.length <= 256,
    "Missing runner image identity",
  );
  exactKeys(next.predecessor, Object.keys(original.predecessor));
  assert.deepEqual(
    next.predecessor.manifest,
    original.predecessor.manifest,
    "Predecessor baseline changed",
  );
  ownedPath(next.predecessor.directory);
  const routing = next.routing;
  exactKeys(routing, Object.keys(original.routing));
  const allowed = new Set(["identityPath", "identitySha256", "publicAddress"]);
  for (const key of Object.keys(original.routing))
    if (!allowed.has(key))
      assert.deepEqual(
        routing[key],
        original.routing[key],
        `Runtime routing field changed: ${key}`,
      );
  assert.equal(
    routing.operationId,
    operation,
    "Routing must retain original operation identity",
  );
  ownedPath(routing.identityPath);
  assert.notEqual(routing.identityPath, original.routing.identityPath);
  assert(
    /^[a-f0-9]{64}$/.test(routing.identitySha256 ?? "") &&
      routing.identitySha256 !== original.routing.identitySha256,
    "Qualification requires fresh route identity",
  );
  assert(
    typeof routing.publicAddress === "string" &&
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(routing.publicAddress) &&
      routing.publicAddress.split(".").every((part) => Number(part) <= 255),
    "Invalid runtime public address",
  );
  const resources = runtime.qualificationResources;
  const previous = configuration.qualificationResources;
  exactKeys(
    resources,
    Object.keys(previous),
    "Controller resource fields differ",
  );
  assert(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,94}$/.test(resources.operation ?? "") &&
      resources.operation !== operation &&
      resources.operation !== previous.operation,
    "Qualification requires a fresh route nonce",
  );
  for (const key of Object.keys(previous))
    if (!["operation", "facts"].includes(key))
      assert.deepEqual(
        resources[key],
        previous[key],
        `Controller field changed: ${key}`,
      );
  assert(
    resources.facts &&
      typeof resources.facts === "object" &&
      !Array.isArray(resources.facts),
    "Missing fresh controller facts",
  );
  const bindingKeys = ["imageId", "certificateVolume", "listenerProfile"];
  function listenerKeys(facts) {
    if (facts.listenerProfile === "immutable-loopback-v1")
      return ["listenerProfile"];
    assert(
      facts.listenerProfile === undefined,
      "Unknown controller listener profile",
    );
    return bindingKeys.slice(0, 2).filter((key) => Object.hasOwn(facts, key));
  }
  const previousBinding = listenerKeys(previous.facts);
  const currentBinding = listenerKeys(resources.facts);
  if (currentBinding.includes("listenerProfile")) {
    assert(
      previousBinding.length === 2 ||
        previousBinding.includes("listenerProfile"),
      "Missing original controller binding",
    );
  } else {
    assert.deepEqual(
      currentBinding,
      previousBinding,
      "Controller binding differs",
    );
  }
  exactKeys(
    resources.facts,
    Object.keys(previous.facts)
      .filter((key) => !bindingKeys.includes(key))
      .concat(currentBinding),
    "Controller facts fields differ",
  );
  const freshFacts = new Set([
    "operationId",
    "operationNonce",
    "identityPath",
    "identitySha256",
    ...bindingKeys,
    "containerName",
  ]);
  for (const key of Object.keys(previous.facts))
    if (!freshFacts.has(key))
      assert.deepEqual(
        resources.facts[key],
        previous.facts[key],
        `Controller fact changed: ${key}`,
      );
  assert.equal(resources.facts.operationNonce, resources.operation);
  assert.equal(resources.facts.operationId, operation);
  assert.equal(resources.facts.identityPath, routing.identityPath);
  assert.equal(resources.facts.identitySha256, routing.identitySha256);
  for (const key of ["privateAddress", "interface"])
    assert.equal(
      resources.facts[key],
      routing[key],
      "Controller route differs",
    );
  return structuredClone(runtime);
}
function bindings({
  plan,
  configuration,
  configurationBytes,
  manifestBytes,
  inspection,
  recoveryAuthorization,
}) {
  validatePlan(plan);
  assert.equal(
    digest(configurationBytes),
    plan.configurationDigest,
    "Original configuration bytes differ",
  );
  assert.deepEqual(
    JSON.parse(configurationBytes),
    configuration,
    "Original configuration object differs",
  );
  const { reconciliationDigest, ...observation } = inspection ?? {};
  assert.equal(
    reconciliationDigest,
    digest(observation),
    "Inspection digest differs",
  );
  assert(
    inspection?.reconciliationDigest &&
      recoveryAuthorization?.inspectionDigest ===
        inspection.reconciliationDigest,
    "Runtime requires explicit inspected restore authorization",
  );
  assert.equal(recoveryAuthorization.operationId, plan.operation);
  assert.equal(recoveryAuthorization.planDigest, plan.authorizationDigest);
  assert.equal(inspection.operationId, plan.operation);
  assert.equal(inspection.planDigest, plan.authorizationDigest);
  const checkpoint = recoveryAuthorization.descriptor;
  assert(
    checkpoint?.kind === "build" &&
      checkpoint.checkpointId === recoveryAuthorization.checkpointId,
    "Missing inspected build checkpoint",
  );
  const state = inspection.remote?.checkpoints;
  assert(
    /^[a-f0-9]{64}$/.test(state?.inspectionDigest ?? ""),
    "Missing host inspection digest",
  );
  assert(
    state?.terminalNotary === true &&
      state.publication === null &&
      state.unresolvedPublication === false,
    "Inspection contains unresolved external work",
  );
  assert.deepEqual(
    state.coordination?.active,
    {
      operationId: plan.operation,
      planDigest: plan.authorizationDigest,
      sourceRevision: plan.source,
    },
    "Inspection has no exact active claim",
  );
  assert(
    state.checkpoints?.some((value) => digest(value) === digest(checkpoint)),
    "Restore checkpoint differs from inspection",
  );
  assert.equal(
    checkpoint.files.find((item) => item.name === "manifest.json")?.sha256,
    digest(manifestBytes),
  );
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.revision, plan.source);
  assert.equal(recoveryAuthorization.manifestSha256, digest(manifestBytes));
  assert(
    configuration.qualification?.predecessor?.manifest,
    "Missing original predecessor baseline",
  );
  return {
    operationId: plan.operation,
    planDigest: plan.authorizationDigest,
    configurationDigest: plan.configurationDigest,
    manifestSha256: digest(manifestBytes),
    packages: checkpointPackages(manifest),
    inspectionDigest: inspection.reconciliationDigest,
    hostInspectionDigest: state.inspectionDigest,
    recoveryAuthorizationDigest: digest(recoveryAuthorization),
    predecessorManifestDigest: digest(
      configuration.qualification.predecessor.manifest,
    ),
    predecessorManifestSha256: checkpoint.files.find(
      (item) => item.name === "predecessor-manifest.json",
    )?.sha256,
    baseline: plan.baseline,
  };
}
export function createQualificationRuntimeAuthorization(input) {
  const runtime = validateRuntime(
    input.configuration,
    input.runtime,
    input.plan.operation,
  );
  const authorization = {
    schemaVersion: 1,
    kind: "qualification-runtime",
    ...bindings(input),
    routeNonce: runtime.qualificationResources.operation,
    runtime,
  };
  return { ...authorization, authorizationDigest: digest(authorization) };
}
export function validateQualificationRuntimeAuthorization(
  authorization,
  input,
) {
  const { authorizationDigest, ...unsigned } = authorization;
  assert.equal(
    authorizationDigest,
    digest(unsigned),
    "Runtime authorization digest differs",
  );
  const expected = createQualificationRuntimeAuthorization({
    ...input,
    runtime: authorization.runtime,
  });
  assert.deepEqual(
    authorization,
    expected,
    "Runtime authorization bindings differ",
  );
  return validateRuntime(
    input.configuration,
    authorization.runtime,
    input.plan.operation,
  );
}
