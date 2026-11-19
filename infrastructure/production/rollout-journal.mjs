import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";

const id = /^[1-9][0-9]{0,14}$/;
const sha = /^[a-f0-9]{40}$/;
const name = /^[a-z][a-z0-9-]{0,19}$/;
const steps = ["stage", "detach", "attach", "traffic", "unprotect", "retire"];
const gates = {
  detach: ["replacementReady", "publishersSettled", "oldHostFenced"],
  attach: ["volumeDetached"],
  traffic: ["volumeVerified", "candidateHttpsVerified"],
  unprotect: ["publicEndpointsVerified", "publisherTargetVerified"],
  retire: ["publicEndpointsVerified", "publisherTargetVerified"],
};

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function syncDirectory(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function privateDirectory(path) {
  require(typeof path === "string" &&
    isAbsolute(
      path,
    ), "Set SITUATE_ROLLOUT_DIRECTORY to the absolute durable production journal directory.");
  const info = lstatSync(path);
  require(info.isDirectory() &&
    info.uid === process.getuid() &&
    (info.mode & 0o077) ===
      0, "The rollout directory must be a private directory owned by the operator.");
}

function write(path, record) {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(record)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function beginRollout(root, target, proposal, migration = false) {
  privateDirectory(root);
  require(target.stateVersion &&
    target.workspaceId, "Expected an adopted HCP workspace.");
  require(sha.test(proposal?.sourceRevision) &&
    name.test(proposal?.previous) &&
    name.test(proposal?.candidate) &&
    !["legacy", "production"].includes(proposal.candidate) &&
    proposal.previous !== proposal.candidate &&
    typeof proposal.previousId === "string" &&
    id.test(proposal.previousId) &&
    typeof proposal.volumeId === "string" &&
    id.test(proposal.volumeId) &&
    typeof proposal.imageId === "string" &&
    id.test(
      proposal.imageId,
    ), "Expected the exact previous and candidate generations, volume, image and source revision.");
  require(migration === (proposal.previous === "legacy") &&
    (!migration ||
      (typeof proposal.candidateId === "string" &&
        id.test(proposal.candidateId) &&
        proposal.candidateId !==
          proposal.previousId)), "Legacy retirement requires the accepted candidate and an explicit migration journal.");
  const active = join(root, "active");
  // The directory is also the writer exclusion marker. A crash before the
  // record is written leaves an unresolved operation, not an available lock.
  mkdirSync(active, { mode: 0o700 });
  syncDirectory(root);
  const { sourceRevision, previous, candidate, previousId, volumeId, imageId } =
    proposal;
  const operation = {
    sourceRevision,
    previous,
    candidate,
    previousId,
    volumeId,
    imageId,
    workspaceId: target.workspaceId,
    migration,
    ...(migration ? { candidateId: proposal.candidateId } : {}),
    completed: [],
    stateVersion: target.stateVersion,
    id: randomUUID(),
  };
  write(join(active, "operation.json"), operation);
  syncDirectory(active);
  return operation;
}

export function pendingRollout(root, target, phase) {
  require(steps.includes(phase), "Unknown rollout phase.");
  privateDirectory(root);
  const active = join(root, "active");
  privateDirectory(active);
  const operation = JSON.parse(
    readFileSync(join(active, "operation.json"), "utf8"),
  );
  require(operation.workspaceId === target.workspaceId &&
    target.stateVersion?.serial === operation.stateVersion?.serial + 1 &&
    target.stateVersion.id !==
      operation.stateVersion
        .id, "Reconciliation requires the single state version immediately after the attempted phase.");
  const pending = JSON.parse(
    readFileSync(join(active, `${phase}.pending.json`), "utf8"),
  );
  require(pending.phase === phase &&
    /^[a-f0-9]{64}$/.test(
      pending.planSha256,
    ), "Invalid pending rollout phase.");
  return {
    before: { ...target, stateVersion: operation.stateVersion },
    ...pending,
  };
}

export function readRollout(root, target, phase, evidence) {
  privateDirectory(root);
  const active = join(root, "active");
  privateDirectory(active);
  const path = join(active, "operation.json");
  const operation = JSON.parse(readFileSync(path, "utf8"));
  require(operation.workspaceId === target.workspaceId &&
    operation.stateVersion?.id === target.stateVersion?.id &&
    operation.stateVersion?.serial ===
      target.stateVersion
        ?.serial, "The journal does not match the current HCP state version. Reconcile before continuing.");
  const sequence = operation.migration ? ["unprotect", "retire"] : steps;
  require(Array.isArray(operation.completed) &&
    operation.completed.every((step, index) => step === sequence[index]) &&
    sequence[operation.completed.length] ===
      phase, "This phase is out of order for the current rollout.");
  require(phase === "stage" ||
    (evidence?.operationId === operation.id &&
      typeof evidence.candidateId === "string" &&
      id.test(evidence.candidateId) &&
      evidence.candidateId !== operation.previousId &&
      (!operation.candidateId ||
        operation.candidateId === evidence.candidateId) &&
      gates[phase].every(
        (gate) => evidence[gate] === true,
      )), "This phase requires matching rollout observations.");
  let pending = false;
  return {
    ...operation,
    candidateId: operation.candidateId ?? evidence?.candidateId,
    beginApply(planSha256) {
      const live = JSON.parse(readFileSync(path, "utf8"));
      require(live.id === operation.id &&
        live.stateVersion.id ===
          operation.stateVersion.id, "The rollout changed before apply.");
      require(/^[a-f0-9]{64}$/.test(
        planSha256,
      ), "Expected a saved plan digest.");
      write(join(active, `${phase}.pending.json`), {
        phase,
        planSha256,
        evidence,
      });
      syncDirectory(active);
      pending = true;
    },
    acknowledge(planSha256, after) {
      const current = pendingRollout(root, after, phase);
      require(current.planSha256 === planSha256 &&
        current.before.stateVersion.id ===
          operation.stateVersion
            .id, "Reconciliation does not match the pending plan.");
      pending = true;
      this.complete(after);
    },
    complete(after) {
      require(pending, "Record the pending apply before marking it complete.");
      require(after.workspaceId === operation.workspaceId &&
        after.stateVersion?.serial >
          operation.stateVersion
            .serial, "The completed phase needs a new authoritative state version.");
      const candidateId = operation.candidateId ?? evidence?.candidateId;
      const updated = {
        ...operation,
        candidateId,
        completed: [...operation.completed, phase],
        stateVersion: after.stateVersion,
      };
      const next = join(active, `${phase}.complete.json`);
      write(next, updated);
      renameSync(next, path);
      syncDirectory(active);
      if (phase === "retire") {
        renameSync(active, join(root, operation.id));
        syncDirectory(root);
      }
    },
  };
}
