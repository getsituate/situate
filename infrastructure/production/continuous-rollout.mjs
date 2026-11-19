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

export async function rollOut(files, driver, gate) {
  await driver.preflight();
  const run = { completed: {} };
  for (const step of rolloutSteps) {
    try {
      if (step === "stage") await gate.begin();
      const evidence = await driver.perform(step, run, files);
      if (evidence == null) throw new Error("Missing verification result.");
      run.completed[step] = evidence;
    } catch (error) {
      throw new Error(`Deployment stopped at ${step}: ${error.message}`, {
        cause: error,
      });
    }
  }
  await driver.finish(run, files);
  await gate.succeed();
}
