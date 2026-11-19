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

export const rolloutSteps = [
  "qualify",
  "stage",
  "prepare",
  "fence",
  "detach",
  "attach",
  "verifyCandidate",
  "route",
  "verifyPublic",
  "resume",
  "unprotect",
  "retire",
];

function syncDirectory(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function write(directory, record) {
  const temporary = join(directory, `${randomUUID()}.json`);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(record)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, join(directory, "journal.json"));
  syncDirectory(directory);
}

export function directoryAccess(root) {
  if (!isAbsolute(root))
    throw new Error(
      "Use an absolute rollout directory on durable private storage.",
    );
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || stat.mode & 0o077)
    throw new Error(
      "The rollout directory must be owned by the runner and inaccessible to other users.",
    );
}

// Live callers hold the durable runner's exclusive OS lock for the entire run.
// Every mutation is preceded by a durable intent; recovery never repeats one.
export async function rollOut(root, request, driver) {
  directoryAccess(root);
  if (
    !/^[a-f0-9]{40}$/.test(request.revision) ||
    !/^[a-f0-9]{64}$/.test(request.digest) ||
    !["production", "sandbox", "simulation"].includes(request.target)
  )
    throw new Error("Invalid rollout identity.");
  const active = join(root, "operation");
  let journal;
  try {
    journal = JSON.parse(readFileSync(join(active, "journal.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await driver.preflight(request);
    mkdirSync(active, { mode: 0o700 });
    syncDirectory(root);
    journal = {
      schema: 1,
      ...request,
      id: randomUUID(),
      completed: {},
      pending: null,
    };
    write(active, journal);
  }
  if (
    journal.schema !== 1 ||
    journal.target !== request.target ||
    journal.digest !== request.digest ||
    journal.revision !== request.revision
  )
    throw new Error(
      "An unresolved rollout belongs to another target or revision. Reconcile it before deploying again.",
    );
  const complete = Object.keys(journal.completed);
  if (
    !complete.every((step, index) => step === rolloutSteps[index]) ||
    (journal.pending && journal.pending !== rolloutSteps[complete.length])
  )
    throw new Error("Invalid rollout journal sequence.");
  for (const step of rolloutSteps.slice(complete.length)) {
    let evidence;
    if (journal.pending) {
      evidence = await driver.observe(step, journal, active);
      if (evidence == null)
        throw new Error(
          `Cannot confirm ${step}; the journal was retained. The operation was not repeated.`,
        );
    } else {
      journal.pending = step;
      write(active, journal);
      evidence = await driver.perform(step, journal, active);
      if (evidence == null)
        throw new Error(`Missing verified result for ${step}.`);
    }
    journal.completed[step] = evidence;
    journal.pending = null;
    write(active, journal);
  }
  await driver.finish(journal, active);
  renameSync(active, join(root, journal.id));
  syncDirectory(root);
  return journal;
}
